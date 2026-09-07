# SPDX-License-Identifier: MPL-2.0
"""Adversarial tests for the synthetic-only private integration boundary."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import pathlib
import stat
import tempfile
import unittest


TOOL_PATH = pathlib.Path(__file__).with_name("private-integration-gate.py")
SPEC = importlib.util.spec_from_file_location("private_integration_gate", TOOL_PATH)
assert SPEC and SPEC.loader
TOOL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOL)
SOURCE_SHA = "a" * 40
APP_HASH = "b" * 64


class PrivateIntegrationGateTests(unittest.TestCase):
    def fixture(self, root: pathlib.Path):
        fixture = root / "fixture"
        TOOL.create_synthetic_fixture(fixture, SOURCE_SHA)
        app_report = root / "app-report.json"
        app_report.write_text(
            json.dumps(
                {
                    "status": "SYNTHETIC_TEST_PRODUCT",
                    "releaseComplete": False,
                    "bundleTreeSHA256": APP_HASH,
                    "provenance": {"reviewedBuildSourceSHA": SOURCE_SHA},
                }
            ),
            encoding="utf-8",
        )
        return fixture, app_report

    def mutate_contract(self, fixture: pathlib.Path, callback):
        path = fixture / "contract.json"
        contract = json.loads(path.read_text(encoding="utf-8"))
        callback(contract)
        path.write_text(json.dumps(contract), encoding="utf-8")

    def verify(self, fixture: pathlib.Path, app_report: pathlib.Path, source_sha: str = SOURCE_SHA):
        return TOOL.verify_synthetic_fixture(fixture, app_report, source_sha)

    def test_exactly_82_synthetic_records_bind_to_final_app_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture, app_report = self.fixture(pathlib.Path(directory))
            report = self.verify(fixture, app_report)
        self.assertEqual(report["recordCount"], 82)
        self.assertEqual(report["finalAppBundleTreeSHA256"], APP_HASH)
        self.assertFalse(report["actualProviderRuntimeExecuted"])
        self.assertFalse(report["actualDecodeEvidence"])
        self.assertEqual(report["privateBuildStatus"], "PRIVATE_BUILD_BLOCKED")

    def test_missing_and_extra_records_are_rejected(self):
        for mutation in [
            lambda value: value["records"].pop(),
            lambda value: value["records"].append(dict(value["records"][-1])),
        ]:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                fixture, app_report = self.fixture(pathlib.Path(directory))
                self.mutate_contract(fixture, mutation)
                with self.assertRaisesRegex(TOOL.GateError, "exactly 82"):
                    self.verify(fixture, app_report)

    def test_corrupt_source_and_decoded_output_are_rejected(self):
        for relative in ["sources/000.synthetic", "decoded/000.synthetic"]:
            with self.subTest(path=relative), tempfile.TemporaryDirectory() as directory:
                fixture, app_report = self.fixture(pathlib.Path(directory))
                (fixture / pathlib.PurePosixPath(relative)).write_bytes(b"corrupt")
                with self.assertRaisesRegex(TOOL.GateError, "(size|hash) mismatch"):
                    self.verify(fixture, app_report)

    def test_missing_and_extra_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture, app_report = self.fixture(pathlib.Path(directory))
            (fixture / "sources" / "001.synthetic").unlink()
            with self.assertRaisesRegex(TOOL.GateError, "Missing regular fixture file"):
                self.verify(fixture, app_report)
        with tempfile.TemporaryDirectory() as directory:
            fixture, app_report = self.fixture(pathlib.Path(directory))
            (fixture / "extra.synthetic").write_text("extra", encoding="utf-8")
            with self.assertRaisesRegex(TOOL.GateError, "missing or extra paths"):
                self.verify(fixture, app_report)

    def test_unsafe_contract_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture, app_report = self.fixture(pathlib.Path(directory))
            self.mutate_contract(
                fixture, lambda value: value["records"][0].__setitem__("source", "../escape")
            )
            with self.assertRaisesRegex(TOOL.GateError, "Invalid synthetic source path"):
                self.verify(fixture, app_report)

    def test_symlink_mode_is_rejected_even_when_host_cannot_create_symlinks(self):
        with self.assertRaisesRegex(TOOL.GateError, "symlink"):
            TOOL.reject_unsupported_mode(stat.S_IFLNK | 0o777, "sources/000.synthetic")

    def test_source_sha_contract_and_final_app_binding_are_rejected_on_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture, app_report = self.fixture(pathlib.Path(directory))
            with self.assertRaisesRegex(TOOL.GateError, "fixture source SHA mismatch"):
                self.verify(fixture, app_report, "c" * 40)
        with tempfile.TemporaryDirectory() as directory:
            fixture, app_report = self.fixture(pathlib.Path(directory))
            app_report.write_text(
                json.dumps(
                    {
                        "status": "SYNTHETIC_TEST_PRODUCT",
                        "releaseComplete": False,
                        "bundleTreeSHA256": APP_HASH,
                        "provenance": {"reviewedBuildSourceSHA": "c" * 40},
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(TOOL.GateError, "App report reviewed source SHA"):
                self.verify(fixture, app_report)

    def test_key_marker_missing_corrupt_or_repointed_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture, app_report = self.fixture(pathlib.Path(directory))
            (fixture / TOOL.SYNTHETIC_KEY_PATH).unlink()
            with self.assertRaisesRegex(TOOL.GateError, "Missing regular fixture file"):
                self.verify(fixture, app_report)
        with tempfile.TemporaryDirectory() as directory:
            fixture, app_report = self.fixture(pathlib.Path(directory))
            (fixture / TOOL.SYNTHETIC_KEY_PATH).write_text("not the marker", encoding="utf-8")
            with self.assertRaisesRegex(TOOL.GateError, "(size|hash) mismatch"):
                self.verify(fixture, app_report)
        with tempfile.TemporaryDirectory() as directory:
            fixture, app_report = self.fixture(pathlib.Path(directory))
            self.mutate_contract(
                fixture, lambda value: value["keyMarker"].__setitem__("path", "sources/000.synthetic")
            )
            with self.assertRaisesRegex(TOOL.GateError, "Unexpected synthetic key marker path"):
                self.verify(fixture, app_report)

    def test_real_mode_is_unconditionally_blocked_and_reads_no_evidence(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code = TOOL.main(["real"])
        self.assertEqual(code, 3)
        self.assertIn("PRIVATE_BUILD_BLOCKED", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
