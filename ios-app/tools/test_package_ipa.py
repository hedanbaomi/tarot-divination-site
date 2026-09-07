# SPDX-License-Identifier: MPL-2.0
"""Adversarial local IPA packaging tests; no upload or signing occurs."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import pathlib
import stat
import tempfile
import unittest
import zipfile
from unittest.mock import patch


TOOL_PATH = pathlib.Path(__file__).with_name("package-ipa.py")
SPEC = importlib.util.spec_from_file_location("package_ipa_cli", TOOL_PATH)
assert SPEC and SPEC.loader
TOOL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOL)
SOURCE_SHA = "a" * 40


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class PackageIpaTests(unittest.TestCase):
    def make_app_and_report(self, root: pathlib.Path, *, platform: str = "IOS"):
        app = root / "Quareia.app"
        (app / "www").mkdir(parents=True)
        contents = {
            "Info.plist": b"synthetic plist",
            "Quareia": b"synthetic macho",
            "www/index.html": b"<p>synthetic</p>",
        }
        for name, data in contents.items():
            target = app / pathlib.PurePosixPath(name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        os.chmod(app / "Quareia", 0o755)
        file_entries = []
        for name, data in sorted(contents.items()):
            mode = 0o755 if name == "Quareia" else 0o644
            file_entries.append(
                {
                    "path": name,
                    "mode": f"{mode:04o}",
                    "bytes": len(data),
                    "sha256": digest(data),
                    "isMachO": name == "Quareia",
                }
            )
        report = {
            "schemaVersion": 1,
            "status": "SYNTHETIC_TEST_PRODUCT",
            "releaseComplete": False,
            "platform": platform,
            "version": "1.0.0",
            "build": "1",
            "bundleBytes": sum(len(data) for data in contents.values()),
            "bundleTreeSHA256": "b" * 64,
            "files": file_entries,
            "directories": [{"path": "www", "mode": "0755"}],
            "provenance": {"reviewedBuildSourceSHA": SOURCE_SHA},
        }
        return app, report

    def package(self, root: pathlib.Path, app: pathlib.Path, report: dict):
        output = root / "Quareia-1.0.0-1.ipa"
        package_report = root / "Quareia-1.0.0-1.package.json"
        with patch.object(TOOL, "run_inspector", return_value=report):
            result = TOOL.package_ipa(
                app,
                output,
                package_report,
                source_sha=SOURCE_SHA,
                expected_version="1.0.0",
                expected_build=1,
                synthetic_test_product=True,
            )
        return output, package_report, result

    def test_writes_only_payload_quareia_app_and_reopens_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app, report = self.make_app_and_report(root)
            output, package_report, result = self.package(root, app, report)
            with zipfile.ZipFile(output) as archive:
                names = archive.namelist()
            persisted = json.loads(package_report.read_text(encoding="utf-8"))
            artifact_sha = digest(output.read_bytes())
        self.assertEqual(
            set(names),
            {
                "Payload/",
                "Payload/Quareia.app/",
                "Payload/Quareia.app/www/",
                "Payload/Quareia.app/Info.plist",
                "Payload/Quareia.app/Quareia",
                "Payload/Quareia.app/www/index.html",
            },
        )
        self.assertEqual(result["status"], "SYNTHETIC_TEST_PRODUCT")
        self.assertFalse(result["releaseComplete"])
        self.assertFalse(result["uploadPerformed"])
        self.assertEqual(persisted["ipa"]["sha256"], artifact_sha)
        self.assertEqual(result["ipa"]["sha256"], artifact_sha)

    def test_packaging_requires_explicit_synthetic_flag(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app, _report = self.make_app_and_report(root)
            with self.assertRaisesRegex(TOOL.PackageError, "--synthetic-test-product"):
                TOOL.package_ipa(
                    app,
                    root / "Quareia-1.0.0-1.ipa",
                    root / "report.json",
                    source_sha=SOURCE_SHA,
                    expected_version="1.0.0",
                    expected_build=1,
                    synthetic_test_product=False,
                )

    def test_simulator_inspection_report_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app, report = self.make_app_and_report(root, platform="IOSSIMULATOR")
            with patch.object(TOOL, "run_inspector", return_value=report), self.assertRaisesRegex(
                TOOL.PackageError, "iPhoneOS"
            ):
                TOOL.package_ipa(
                    app,
                    root / "Quareia-1.0.0-1.ipa",
                    root / "report.json",
                    source_sha=SOURCE_SHA,
                    expected_version="1.0.0",
                    expected_build=1,
                    synthetic_test_product=True,
                )

    def test_source_hash_and_size_changes_after_inspection_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app, report = self.make_app_and_report(root)
            (app / "Info.plist").write_bytes(b"same size different")
            with patch.object(TOOL, "run_inspector", return_value=report), self.assertRaisesRegex(
                TOOL.PackageError, "Source (size|hash) changed"
            ):
                TOOL.package_ipa(
                    app,
                    root / "Quareia-1.0.0-1.ipa",
                    root / "report.json",
                    source_sha=SOURCE_SHA,
                    expected_version="1.0.0",
                    expected_build=1,
                    synthetic_test_product=True,
                )

    def test_extra_source_path_after_inspection_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app, report = self.make_app_and_report(root)
            (app / "unexpected.txt").write_text("x", encoding="utf-8")
            with patch.object(TOOL, "run_inspector", return_value=report), self.assertRaisesRegex(
                TOOL.PackageError, "Source paths changed"
            ):
                TOOL.package_ipa(
                    app,
                    root / "Quareia-1.0.0-1.ipa",
                    root / "report.json",
                    source_sha=SOURCE_SHA,
                    expected_version="1.0.0",
                    expected_build=1,
                    synthetic_test_product=True,
                )

    def test_candidate_zip_extra_path_traversal_and_symlink_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app, report = self.make_app_and_report(root)
            files, directories = TOOL._manifest_maps(report)
            candidate = root / "candidate.ipa"
            TOOL.write_candidate(candidate, app, files, directories)
            with zipfile.ZipFile(candidate, "a") as archive:
                archive.writestr("Payload/Quareia.app/../escape", b"x")
            with self.assertRaisesRegex(TOOL.PackageError, "paths do not match"):
                TOOL.validate_candidate(candidate, files, directories)

            symlink_candidate = root / "symlink.ipa"
            with zipfile.ZipFile(symlink_candidate, "w") as archive:
                archive.writestr(TOOL._zip_info("Payload", mode=0o755, directory=True), b"")
                archive.writestr(
                    TOOL._zip_info("Payload/Quareia.app", mode=0o755, directory=True), b""
                )
                info = zipfile.ZipInfo("Payload/Quareia.app/link")
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, b"Info.plist")
            symlink_files = {
                "link": {
                    "path": "link",
                    "mode": "0777",
                    "bytes": len(b"Info.plist"),
                    "sha256": digest(b"Info.plist"),
                    "isMachO": False,
                }
            }
            with self.assertRaisesRegex(TOOL.PackageError, "symlink"):
                TOOL.validate_candidate(symlink_candidate, symlink_files, {})

    def test_candidate_payload_hash_and_size_mismatch_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app, report = self.make_app_and_report(root)
            files, directories = TOOL._manifest_maps(report)
            candidate = root / "candidate.ipa"
            TOOL.write_candidate(candidate, app, files, directories)
            bad_hash = {name: dict(entry) for name, entry in files.items()}
            bad_hash["Info.plist"]["sha256"] = "0" * 64
            with self.assertRaisesRegex(TOOL.PackageError, "hash mismatch"):
                TOOL.validate_candidate(candidate, bad_hash, directories)
            bad_size = {name: dict(entry) for name, entry in files.items()}
            bad_size["Info.plist"]["bytes"] += 1
            with self.assertRaisesRegex(TOOL.PackageError, "size mismatch"):
                TOOL.validate_candidate(candidate, bad_size, directories)

    def test_candidate_refuses_existing_output_and_noncanonical_name(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app, report = self.make_app_and_report(root)
            output = root / "Quareia-1.0.0-1.ipa"
            output.write_bytes(b"existing")
            with patch.object(TOOL, "run_inspector", return_value=report), self.assertRaisesRegex(
                TOOL.PackageError, "overwrite"
            ):
                TOOL.package_ipa(
                    app,
                    output,
                    root / "report.json",
                    source_sha=SOURCE_SHA,
                    expected_version="1.0.0",
                    expected_build=1,
                    synthetic_test_product=True,
                )
            with self.assertRaisesRegex(TOOL.PackageError, "canonical"):
                TOOL.package_ipa(
                    app,
                    root / "candidate.ipa",
                    root / "report.json",
                    source_sha=SOURCE_SHA,
                    expected_version="1.0.0",
                    expected_build=1,
                    synthetic_test_product=True,
                )


if __name__ == "__main__":
    unittest.main()
