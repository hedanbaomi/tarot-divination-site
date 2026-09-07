# SPDX-License-Identifier: MPL-2.0
"""Adversarial tests; mocked Mach-O tools are not actual Xcode evidence."""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch


INSPECTOR_PATH = pathlib.Path(__file__).with_name("inspect-app.py")
SPEC = importlib.util.spec_from_file_location("inspect_app_cli", INSPECTOR_PATH)
assert SPEC and SPEC.loader
INSPECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSPECTOR)
SOURCE_SHA = "a" * 40


class PayloadGateTests(unittest.TestCase):
    def make_app(
        self,
        root: pathlib.Path,
        *,
        platform: str = "IOS",
        flavor: str = "public-prototype",
        display_name: str = "Quareia Prototype",
        build_source_sha: str = SOURCE_SHA,
    ) -> pathlib.Path:
        app = root / "Quareia.app"
        www = app / "www"
        www.mkdir(parents=True)
        supported = ["iPhoneOS"] if platform == "IOS" else ["iPhoneSimulator"]
        sdk = "iphoneos26.0" if platform == "IOS" else "iphonesimulator26.0"
        (app / "Info.plist").write_bytes(
            plistlib.dumps(
                {
                    "QuareiaBuildFlavor": flavor,
                    "CFBundleDisplayName": display_name,
                    "CFBundleShortVersionString": "1.0.0",
                    "CFBundleVersion": "1",
                    "CFBundlePackageType": "APPL",
                    "MinimumOSVersion": "16.0",
                    "UIDeviceFamily": [1, 2],
                    "LSRequiresIPhoneOS": True,
                    "CFBundleExecutable": "Quareia",
                    "CFBundleIdentifier": "com.hedanbaomi.quareia.ios",
                    "CFBundleSupportedPlatforms": supported,
                    "DTPlatformName": sdk.split("26")[0],
                    "DTSDKName": sdk,
                }
            )
        )
        (app / "Quareia").write_bytes(b"\xcf\xfa\xed\xfe" + b"synthetic executable")
        (app / "Linked.dylib").write_bytes(b"\xcf\xfa\xed\xfe" + b"synthetic library")
        os.chmod(app / "Quareia", 0o755)
        os.chmod(app / "Linked.dylib", 0o755)
        runtime = {"index.html": b"<p>synthetic</p>", "js/app.js": b"synthetic();\n"}
        runtime.update(
            {
                path: b"synthetic-public-jpeg:" + path.encode("ascii")
                for path in INSPECTOR.PUBLIC_CARD_PATHS
            }
        )
        runtime.update(
            {
                path: b"synthetic-public-png:" + path.encode("ascii")
                for path in INSPECTOR.PUBLIC_ICON_PATHS
            }
        )
        for name, data in runtime.items():
            path = www / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        (www / "public-resources.json").write_text(
            json.dumps(list(runtime), indent=2) + "\n", encoding="utf-8"
        )
        provenance_files = []
        for name, data in runtime.items():
            provenance_files.append(
                {
                    "path": name,
                    "source": f"android-demo/app/src/main/assets/www/{name}",
                    "sourceSha256": hashlib.sha256(
                        data if name in INSPECTOR.EXPECTED_PUBLIC_BINARY_PATHS else b"source:" + data
                    ).hexdigest(),
                    "outputSha256": hashlib.sha256(data).hexdigest(),
                }
            )
        (www / "provenance.json").write_text(
            json.dumps(
                {
                    "schema": 2,
                    "mode": "public-ios-port",
                    "sourceCommit": INSPECTOR.FROZEN_ANDROID_SOURCE_SHA,
                    "buildSourceCommit": build_source_sha,
                    "transformations": [
                        {
                            "path": name,
                            "steps": (
                                ["exact binary copy"]
                                if name in INSPECTOR.EXPECTED_PUBLIC_BINARY_PATHS
                                else ["synthetic fixture"]
                            ),
                        }
                        for name in runtime
                    ],
                    "files": provenance_files,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return app

    def inspect(
        self,
        app: pathlib.Path,
        *,
        requested_platform: str = "IOS",
        executable_platform: str | None = None,
        library_platform: str | None = None,
        source_sha: str = SOURCE_SHA,
        synthetic: bool = True,
        arches: str = "arm64",
    ) -> dict:
        executable_platform = executable_platform or requested_platform
        library_platform = library_platform or requested_platform

        def output(command, **_kwargs):
            if command[0] == "lipo":
                return arches + "\n"
            kind = library_platform if command[-1].endswith("Linked.dylib") else executable_platform
            return f"Load command 1\n  platform {kind}\n"

        completed = subprocess.CompletedProcess([], 1, b"", b"unsigned")
        with patch.object(subprocess, "check_output", side_effect=output), patch.object(
            subprocess, "run", return_value=completed
        ):
            return INSPECTOR.inspect_app(
                app,
                platform=requested_platform,
                source_sha=source_sha,
                expected_version="1.0.0",
                expected_build=1,
                synthetic_test_product=synthetic,
            )

    def test_public_device_shape_records_every_macho_and_payload_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            report = self.inspect(self.make_app(pathlib.Path(directory)))
        self.assertEqual(report["status"], "SYNTHETIC_TEST_PRODUCT")
        self.assertFalse(report["releaseComplete"])
        self.assertEqual(report["platform"], "IOS")
        self.assertEqual(report["provenance"]["reviewedBuildSourceSHA"], SOURCE_SHA)
        self.assertEqual(
            {item["path"] for item in report["machOBinaries"]},
            {"Quareia", "Linked.dylib"},
        )
        self.assertTrue(
            all(len(item["sha256"]) == 64 and item["bytes"] > 0 for item in report["files"])
        )

    def test_simulator_bundle_is_accepted_only_as_simulator(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory), platform="IOSSIMULATOR")
            report = self.inspect(app, requested_platform="IOSSIMULATOR", arches="arm64 x86_64")
        self.assertEqual(report["platform"], "IOSSIMULATOR")

    def test_simulator_executable_rejected_even_when_arm64(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory))
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "Incorrect Mach-O platform"):
                self.inspect(app, executable_platform="IOSSIMULATOR")

    def test_simulator_library_rejected_even_with_device_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory))
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "Incorrect Mach-O platform"):
                self.inspect(app, library_platform="IOSSIMULATOR")

    def test_source_sha_must_be_full_and_match_build_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory))
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "40 lowercase hex"):
                self.inspect(app, source_sha="a" * 7)
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "Build source SHA"):
                self.inspect(app, source_sha="c" * 40)

    def test_synthetic_flag_and_marker_are_both_required(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app = self.make_app(root)
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "PRIVATE_BUILD_BLOCKED"):
                self.inspect(app, synthetic=False)
            bad = self.make_app(root / "other", flavor="", display_name="Quareia")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "synthetic test-product marker"):
                self.inspect(bad)

    def test_transitional_public_synthetic_marker_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(
                pathlib.Path(directory), flavor="public-synthetic", display_name="Quareia Test"
            )
            report = self.inspect(app)
        self.assertEqual(report["flavor"], "public-synthetic")

    def test_public_overlay_source_maps_to_serveable_js_output(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory))
            provenance_path = app / "www" / "provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            provenance["files"][1]["source"] = "ios-app/web/app.js"
            provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
            report = self.inspect(app)
            self.assertEqual(
                report["provenance"]["runtimeFiles"],
                2
                + len(INSPECTOR.PUBLIC_CARD_PATHS)
                + len(INSPECTOR.PUBLIC_ICON_PATHS),
            )

    def test_public_card_manifest_requires_exact_complete_path_set(self):
        self.assertEqual(len(INSPECTOR.PUBLIC_CARD_PATHS), 157)
        self.assertEqual(len(INSPECTOR.EXPECTED_PUBLIC_CARD_PATHS), 157)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app = self.make_app(root)
            allowlist_path = app / "www" / "public-resources.json"
            allowlist = json.loads(allowlist_path.read_text(encoding="utf-8"))
            allowlist.remove("assets/cards/major-00.jpeg")
            allowlist_path.write_text(json.dumps(allowlist), encoding="utf-8")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "exact 157-file set"):
                self.inspect(app)

            app = self.make_app(root / "second")
            allowlist_path = app / "www" / "public-resources.json"
            allowlist = json.loads(allowlist_path.read_text(encoding="utf-8"))
            allowlist.append("assets/cards/lxxxi-01.jpeg")
            allowlist_path.write_text(json.dumps(allowlist), encoding="utf-8")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "Unsafe public resource"):
                self.inspect(app)

    def test_public_card_provenance_requires_exact_source_hash_and_binary_step(self):
        card_path = "assets/cards/m/m-back.jpeg"
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app = self.make_app(root)
            provenance_path = app / "www" / "provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            entry = next(value for value in provenance["files"] if value["path"] == card_path)
            entry["sourceSha256"] = "0" * 64
            provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "byte-for-byte"):
                self.inspect(app)

            app = self.make_app(root / "second")
            provenance_path = app / "www" / "provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            transformation = next(
                value for value in provenance["transformations"] if value["path"] == card_path
            )
            transformation["steps"] = ["LF normalization"]
            provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "exact binary copy"):
                self.inspect(app)

    def test_public_theme_icons_require_exact_set_and_binary_hash(self):
        icon_path = "assets/icons/parchment-sun.png"
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app = self.make_app(root)
            allowlist_path = app / "www" / "public-resources.json"
            allowlist = json.loads(allowlist_path.read_text(encoding="utf-8"))
            allowlist.remove(icon_path)
            allowlist_path.write_text(json.dumps(allowlist), encoding="utf-8")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "exact 5-file set"):
                self.inspect(app)

            app = self.make_app(root / "second")
            provenance_path = app / "www" / "provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            entry = next(value for value in provenance["files"] if value["path"] == icon_path)
            entry["sourceSha256"] = "0" * 64
            provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "byte-for-byte"):
                self.inspect(app)

    def test_forbidden_resource_is_rejected_by_name(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory))
            (app / "material.key").write_text("synthetic forbidden file", encoding="utf-8")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "Forbidden public payload"):
                self.inspect(app)

    def test_missing_or_extra_runtime_output_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory))
            (app / "www" / "extra.js").write_text("x", encoding="utf-8")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "output allowlist"):
                self.inspect(app)
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory))
            (app / "www" / "index.html").unlink()
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "output allowlist"):
                self.inspect(app)

    def test_unsafe_allowlist_path_and_output_hash_mismatch_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory))
            allowlist = app / "www" / "public-resources.json"
            allowlist.write_text('["../Info.plist"]\n', encoding="utf-8")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "Unsafe public resource"):
                self.inspect(app)
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory))
            (app / "www" / "index.html").write_text("corrupt", encoding="utf-8")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "output hash mismatch"):
                self.inspect(app)

    def test_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory))
            link = app / "linked-resource"
            try:
                link.symlink_to(app / "Info.plist")
            except OSError as cause:
                self.skipTest(f"symlinks unavailable: {cause}")
            with self.assertRaisesRegex(INSPECTOR.InspectionError, "symlink"):
                self.inspect(app)

    def test_posix_permissions_reject_writable_or_wrong_execute_bits(self):
        with self.assertRaisesRegex(INSPECTOR.InspectionError, "writable"):
            INSPECTOR.validate_posix_permissions(0o666, "Info.plist", directory=False)
        with self.assertRaisesRegex(INSPECTOR.InspectionError, "non-Mach-O"):
            INSPECTOR.validate_posix_permissions(0o755, "script", directory=False)
        with self.assertRaisesRegex(INSPECTOR.InspectionError, "owner-executable"):
            INSPECTOR.validate_posix_permissions(0o644, "Quareia", directory=False, macho=True)

    def test_cli_failure_is_nonzero_and_does_not_emit_success_json(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(pathlib.Path(directory))
            stderr = io.StringIO()
            stdout = io.StringIO()
            with contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(stdout):
                code = INSPECTOR.main(
                    [
                        str(app),
                        "--platform",
                        "IOS",
                        "--source-sha",
                        "bad",
                        "--expected-version",
                        "1.0.0",
                        "--expected-build",
                        "1",
                        "--synthetic-test-product",
                    ]
                )
        self.assertEqual(code, 2)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("INSPECTION_FAILED", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
