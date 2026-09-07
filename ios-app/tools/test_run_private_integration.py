# SPDX-License-Identifier: MPL-2.0
"""Public synthetic tests for the default-disabled private orchestration contract."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch


TOOL_PATH = pathlib.Path(__file__).with_name("run-private-integration.py")
SPEC = importlib.util.spec_from_file_location("run_private_integration", TOOL_PATH)
assert SPEC and SPEC.loader
TOOL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOL)
SOURCE_SHA = "a" * 40
APPROVAL_CONTEXT = "review-2026-09-07"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class PrivateManifestTests(unittest.TestCase):
    def make_manifest(self, root: pathlib.Path):
        (root / "provider").mkdir()
        (root / "tests").mkdir()
        (root / "records").mkdir()
        provider = b"// synthetic contract fixture; no real provider or key\n"
        auth_test = b"// synthetic format-negative test fixture\n"
        (root / "provider" / "IntegratedLxxxiProvider.swift").write_bytes(provider)
        (root / "provider" / "IntegratedLxxxiProvider.swift").chmod(0o600)
        (root / "tests" / "PrivateProviderAuthenticationNegativeTests.swift").write_bytes(
            auth_test
        )
        (root / "tests" / "PrivateProviderAuthenticationNegativeTests.swift").chmod(0o600)
        records = []
        for key in TOOL.EXPECTED_KEYS:
            data = f"synthetic-qv/{key}\n".encode("ascii")
            relative = f"records/{key}.qv"
            (root / pathlib.PurePosixPath(relative)).write_bytes(data)
            (root / pathlib.PurePosixPath(relative)).chmod(0o600)
            records.append(
                {
                    "logicalKey": key,
                    "source": relative,
                    "bytes": len(data),
                    "sha256": digest(data),
                }
            )
        manifest = {
            "schemaVersion": 1,
            "reviewedPublicSourceSHA": SOURCE_SHA,
            "approvalContext": APPROVAL_CONTEXT,
            "providerSources": [
                {
                    "source": "provider/IntegratedLxxxiProvider.swift",
                    "destination": "IntegratedLxxxiProvider.swift",
                    "bytes": len(provider),
                    "sha256": digest(provider),
                }
            ],
            "authenticationTestSources": [
                {
                    "source": "tests/PrivateProviderAuthenticationNegativeTests.swift",
                    "destination": "PrivateProviderAuthenticationNegativeTests.swift",
                    "bytes": len(auth_test),
                    "sha256": digest(auth_test),
                }
            ],
            "authenticationTestIdentifier": (
                "QuareiaTests/PrivateProviderAuthenticationNegativeTests/"
                "testRejectsCorruptSourceAndWrongKey"
            ),
            "encryptedRecords": records,
        }
        manifest_path = root / "manifest.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        manifest_path.chmod(0o600)
        return manifest_path, manifest

    def load(self, manifest_path: pathlib.Path):
        return TOOL.load_and_validate_manifest(
            manifest_path,
            expected_manifest_sha256=TOOL.sha256_file(manifest_path),
            expected_source_sha=SOURCE_SHA,
            expected_approval_context=APPROVAL_CONTEXT,
        )

    def rewrite(self, path: pathlib.Path, value):
        path.write_text(json.dumps(value), encoding="utf-8")

    @unittest.skipUnless(os.name != "nt", "POSIX permission contract")
    def test_group_or_other_readable_private_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            manifest_path, _ = self.make_manifest(root)
            provider = root / "provider" / "IntegratedLxxxiProvider.swift"
            provider.chmod(0o644)
            with self.assertRaisesRegex(
                TOOL.PrivateIntegrationError,
                "owner-read only",
            ):
                self.load(manifest_path)

    def test_manifest_accepts_only_exact_reviewed_provider_tests_and_82_records(self):
        with tempfile.TemporaryDirectory() as directory:
            path, _ = self.make_manifest(pathlib.Path(directory))
            manifest = self.load(path)
        self.assertEqual(manifest["reviewedPublicSourceSHA"], SOURCE_SHA)
        self.assertEqual(len(manifest["encryptedRecords"]), 82)
        self.assertEqual(
            [entry["logicalKey"] for entry in manifest["encryptedRecords"]],
            TOOL.EXPECTED_KEYS,
        )

    def test_unapproved_manifest_hash_and_source_sha_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path, _ = self.make_manifest(pathlib.Path(directory))
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "approved hash"):
                TOOL.load_and_validate_manifest(
                    path,
                    expected_manifest_sha256="0" * 64,
                    expected_source_sha=SOURCE_SHA,
                    expected_approval_context=APPROVAL_CONTEXT,
                )
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "source SHA mismatch"):
                TOOL.load_and_validate_manifest(
                    path,
                    expected_manifest_sha256=TOOL.sha256_file(path),
                    expected_source_sha="b" * 40,
                    expected_approval_context=APPROVAL_CONTEXT,
                )

    def test_unknown_key_sidecar_field_and_unsafe_input_path_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path, manifest = self.make_manifest(pathlib.Path(directory))
            manifest["keyFile"] = "keys/private.key"
            self.rewrite(path, manifest)
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "fields do not match"):
                self.load(path)
        with tempfile.TemporaryDirectory() as directory:
            path, manifest = self.make_manifest(pathlib.Path(directory))
            manifest["providerSources"][0]["source"] = "../IntegratedLxxxiProvider.swift"
            self.rewrite(path, manifest)
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "Invalid private input path"):
                self.load(path)

    def test_missing_extra_reordered_and_corrupt_records_are_rejected(self):
        mutations = [
            (lambda value: value["encryptedRecords"].pop(), "exactly 82"),
            (
                lambda value: value["encryptedRecords"].append(
                    dict(value["encryptedRecords"][-1])
                ),
                "exactly 82",
            ),
            (
                lambda value: value["encryptedRecords"].__setitem__(
                    slice(0, 2), list(reversed(value["encryptedRecords"][:2]))
                ),
                "logical keys/order",
            ),
        ]
        for mutation, message in mutations:
            with self.subTest(message=message), tempfile.TemporaryDirectory() as directory:
                path, manifest = self.make_manifest(pathlib.Path(directory))
                mutation(manifest)
                self.rewrite(path, manifest)
                with self.assertRaisesRegex(TOOL.PrivateIntegrationError, message):
                    self.load(path)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            path, _ = self.make_manifest(root)
            (root / "records" / "lxxxi-01.qv").write_bytes(b"corrupt")
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "(size|hash) mismatch"):
                self.load(path)

    def test_symlink_inputs_are_rejected_without_needing_host_symlink_privilege(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.make_manifest(root)
            with patch.object(pathlib.Path, "is_symlink", return_value=True), self.assertRaisesRegex(
                TOOL.PrivateIntegrationError, "non-symlink"
            ):
                TOOL.resolve_manifest_input(root.resolve(), "provider/IntegratedLxxxiProvider.swift")


class PrivateOrchestrationContractTests(unittest.TestCase):
    def run_args(self, root: pathlib.Path, **overrides):
        values = {
            "repo": str(root / "repo"),
            "manifest": str(root / "manifest" / "manifest.json"),
            "manifest_sha256": "b" * 64,
            "source_sha": SOURCE_SHA,
            "approval_context": APPROVAL_CONTEXT,
            "approved_private_context": True,
            "simulator_id": "11111111-1111-1111-1111-111111111111",
            "private_temp_root": str(root / "private-temp"),
            "expected_version": "1.0.0",
            "expected_build": 1,
            "candidate_app_output": str(root / "candidate" / "Quareia.app"),
            "report": str(root / "reports" / "report.json"),
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def make_path_fixture(self, root: pathlib.Path):
        (root / "repo" / ".git").mkdir(parents=True)
        (root / "manifest").mkdir(mode=0o700)
        (root / "manifest" / "manifest.json").write_text("{}", encoding="utf-8")
        (root / "manifest" / "manifest.json").chmod(0o600)
        (root / "private-temp").mkdir(mode=0o700)

    def test_ephemeral_project_patch_adds_only_source_root_manifest_references(self):
        project = TOOL_PATH.parents[1] / "Quareia.xcodeproj" / "project.pbxproj"
        source = project.read_text(encoding="utf-8")
        patched = TOOL.patch_xcode_project(
            source,
            ["IntegratedLxxxiProvider.swift", "PrivateDecoder.swift"],
            ["PrivateProviderAuthenticationNegativeTests.swift"],
        )
        self.assertIn("path = PrivateInputs/IntegratedLxxxiProvider.swift; sourceTree = SOURCE_ROOT", patched)
        self.assertIn("path = PrivateInputs/Tests/PrivateProviderAuthenticationNegativeTests.swift; sourceTree = SOURCE_ROOT", patched)
        self.assertIn("path = PrivateInputs/PrivateAssets; sourceTree = SOURCE_ROOT", patched)
        self.assertEqual(source.count("PrivateInputs/"), 0)

    def test_ephemeral_copy_rechecks_hash_before_private_code_can_run(self):
        with tempfile.TemporaryDirectory() as directory:
            temporary = pathlib.Path(directory)
            checkout = temporary / "checkout"
            project = checkout / "ios-app" / "Quareia.xcodeproj"
            project.mkdir(parents=True)
            project_source = TOOL_PATH.parents[1] / "Quareia.xcodeproj" / "project.pbxproj"
            (project / "project.pbxproj").write_text(
                project_source.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            source = temporary / "Provider.swift"
            source.write_bytes(b"changed!")
            entry = {
                "destination": "IntegratedLxxxiProvider.swift",
                "_absolute": source,
                "bytes": len(b"reviewed"),
                "sha256": hashlib.sha256(b"reviewed").hexdigest(),
            }
            manifest = {
                "providerSources": [entry],
                "authenticationTestSources": [],
                "encryptedRecords": [],
            }
            with self.assertRaisesRegex(
                TOOL.PrivateIntegrationError,
                "Private input changed while being copied",
            ):
                TOOL._copy_manifest_inputs(checkout, manifest)

    def test_ephemeral_simulator_is_fresh_and_deleted_after_failure(self):
        reference = "11111111-1111-1111-1111-111111111111"
        created = "22222222-2222-2222-2222-222222222222"
        listing = json.dumps(
            {
                "devices": {
                    "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
                        {
                            "udid": reference,
                            "deviceTypeIdentifier": (
                                "com.apple.CoreSimulator.SimDeviceType.iPhone-15"
                            ),
                        }
                    ]
                }
            }
        )
        deleted_listing = json.dumps(
            {"devices": {"com.apple.CoreSimulator.SimRuntime.iOS-18-0": []}}
        )
        completed = argparse.Namespace(returncode=0)
        with tempfile.TemporaryDirectory() as directory, patch.object(
            TOOL.subprocess,
            "check_output",
            side_effect=[listing, f"{created}\n", deleted_listing],
        ), patch.object(
            TOOL.subprocess,
            "run",
            side_effect=[argparse.Namespace(returncode=1), completed],
        ) as run:
            root = pathlib.Path(directory)
            with self.assertRaisesRegex(RuntimeError, "test failure"):
                with TOOL._ephemeral_simulator(
                    reference,
                    cwd=root,
                    log=root / "private.log",
                    environment={},
                ) as selected:
                    self.assertEqual(selected, created)
                    self.assertNotEqual(selected, reference)
                    raise RuntimeError("test failure")
        self.assertEqual(run.call_count, 2)
        self.assertEqual(
            run.call_args_list[0].args[0],
            ["xcrun", "simctl", "shutdown", created],
        )
        self.assertEqual(
            run.call_args_list[1].args[0],
            ["xcrun", "simctl", "delete", created],
        )

    def test_private_temp_root_is_separate_and_report_cannot_mutate_candidate(self):
        environment = {"QUAREIA_PRIVATE_CI_APPROVED_CONTEXT": APPROVAL_CONTEXT}
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.make_path_fixture(root)
            candidate = root / "candidate" / "Quareia.app"
            with patch.object(TOOL.sys, "platform", "darwin"), self.assertRaisesRegex(
                TOOL.PrivateIntegrationError,
                "report must not be inside",
            ):
                TOOL.run_private_integration(
                    self.run_args(root, report=str(candidate / "report.json")),
                    environment,
                )

            with patch.object(TOOL.sys, "platform", "darwin"), self.assertRaisesRegex(
                TOOL.PrivateIntegrationError,
                "temp root must be isolated",
            ):
                TOOL.run_private_integration(
                    self.run_args(root, private_temp_root=str(root / "manifest")),
                    environment,
                )

    def test_real_xctest_evidence_requires_exact_82_order_both_passed_tests_and_summary(self):
        lines = [f"PRIVATE_PROVIDER_DECODE_OK:{key}" for key in TOOL.EXPECTED_KEYS]
        lines += [
            "PRIVATE_PROVIDER_82_DECODE_PASS",
            "PRIVATE_PROVIDER_AUTHENTICATION_NEGATIVE_PASS",
            "Test Case '-[QuareiaTests.PrivateProviderAcceptanceTests testIntegratedProviderDecodesExactRecordSet]' passed (0.1 seconds).",
            "Test Case '-[QuareiaTests.PrivateProviderAuthenticationNegativeTests testRejectsCorruptSourceAndWrongKey]' passed (0.1 seconds).",
            "Executed 2 tests, with 0 failures (0 unexpected) in 0.2 seconds",
        ]
        result = TOOL.validate_test_evidence(
            "\n".join(lines),
            "QuareiaTests/PrivateProviderAuthenticationNegativeTests/testRejectsCorruptSourceAndWrongKey",
        )
        self.assertEqual(result["recordCount"], 82)
        self.assertTrue(result["authenticationNegativePassed"])

        for mutation in [
            lambda value: value.pop(0),
            lambda value: value.append("PRIVATE_PROVIDER_DECODE_OK:lxxxi-81"),
            lambda value: value.__setitem__(-3, "provider marker only, no passed XCTest"),
            lambda value: value.__setitem__(-1, "Executed 2 tests, with 1 failure"),
        ]:
            candidate = list(lines)
            mutation(candidate)
            with self.assertRaises(TOOL.PrivateIntegrationError):
                TOOL.validate_test_evidence(
                    "\n".join(candidate),
                    "QuareiaTests/PrivateProviderAuthenticationNegativeTests/testRejectsCorruptSourceAndWrongKey",
                )

    def test_status_is_blocked_without_reading_any_private_input(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = TOOL.main(["status"])
        self.assertEqual(code, 3)
        self.assertEqual(stdout.getvalue().strip(), "PRIVATE_BUILD_BLOCKED")

    def test_authorization_rejects_pull_request_or_missing_explicit_gate(self):
        args = argparse.Namespace(
            approved_private_context=False,
            approval_context=APPROVAL_CONTEXT,
            source_sha=SOURCE_SHA,
        )
        with patch.object(TOOL.sys, "platform", "darwin"), self.assertRaisesRegex(
            TOOL.PrivateIntegrationError, "explicit"
        ):
            TOOL.authorize_real_run(args, {"QUAREIA_PRIVATE_CI_APPROVED_CONTEXT": APPROVAL_CONTEXT})
        args.approved_private_context = True
        with patch.object(TOOL.sys, "platform", "darwin"), self.assertRaisesRegex(
            TOOL.PrivateIntegrationError, "pull-request"
        ):
            TOOL.authorize_real_run(
                args,
                {
                    "QUAREIA_PRIVATE_CI_APPROVED_CONTEXT": APPROVAL_CONTEXT,
                    "GITHUB_EVENT_NAME": "pull_request_target",
                    "GITHUB_HEAD_REF": "untrusted-branch",
                },
            )


if __name__ == "__main__":
    unittest.main()
