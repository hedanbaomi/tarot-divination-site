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
import plistlib
import tempfile
import unittest
import zipfile
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
                            "isAvailable": True,
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

    def test_simulator_profile_preserves_exact_iphone_or_ipad_reference(self):
        reference = "11111111-1111-1111-1111-111111111111"
        runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-2"
        for model in ["iPhone-17", "iPad-Pro-13-inch-M4-16GB"]:
            device_type = "com.apple.CoreSimulator.SimDeviceType." + model
            listing = {"devices": {runtime: [{"udid": reference, "isAvailable": True,
                                              "deviceTypeIdentifier": device_type}]}}
            with self.subTest(model=model), patch.object(TOOL.subprocess, "check_output", return_value=json.dumps(listing)):
                self.assertEqual(TOOL._simulator_profile(reference, cwd=pathlib.Path.cwd(), environment={}),
                                 (runtime, device_type))

    def test_simulator_profile_rejects_non_ios_non_phone_tablet_and_unavailable(self):
        reference = "11111111-1111-1111-1111-111111111111"
        for runtime, model, available in [
            ("watchOS-26-0", "iPhone-17", True),
            ("tvOS-26-0", "Apple-TV-4K", True),
            ("iOS-26-2", "Apple-Watch-Series-11-46mm", True),
            ("iOS-26-2", "Apple-TV-4K", True),
            ("iOS-26-2", "iPad-Pro-13-inch-M4-16GB", False),
            ("iOS-26-2", "iPhone-17", None),
        ]:
            listing = {"devices": {"com.apple.CoreSimulator.SimRuntime." + runtime: [
                {"udid": reference, "isAvailable": available,
                 "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType." + model}]}}
            with self.subTest(runtime=runtime, model=model, available=available), patch.object(
                TOOL.subprocess, "check_output", return_value=json.dumps(listing)
            ), self.assertRaises(TOOL.PrivateIntegrationError):
                TOOL._simulator_profile(reference, cwd=pathlib.Path.cwd(), environment={})

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
        self.assertTrue(result["actualDecodeEvidence"])
        self.assertTrue(result["actualProviderRuntimeExecuted"])

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

    def test_full_runtime_discovery_covers_public_ui_native_and_private_acceptance(self):
        authentication = "QuareiaTests/PrivateProviderAuthenticationNegativeTests/testRejectsCorruptSourceAndWrongKey"
        expected = TOOL.expected_runtime_tests(TOOL_PATH.parents[2], authentication)
        self.assertIn(TOOL.PROVIDER_TEST_IDENTIFIER, expected)
        self.assertIn(authentication, expected)
        self.assertTrue(set(TOOL.CRITICAL_UI_TESTS) <= set(expected))
        self.assertIn("QuareiaTests/AppRouteTests/testProtectedRouteRejectsWrongTokenKeysSuffixesQueryAndFragment", expected)
        self.assertIn("QuareiaUITests/QuareiaUITests/testCustomSpreadQSPRoundTripUsesTheRealStudio", expected)
        self.assertGreater(len(expected), 80)

    def test_full_runtime_requires_each_test_once_not_only_a_success_summary(self):
        expected = ["QuareiaTests/FirstTests/testFirst", "QuareiaTests/SecondTests/testSecond"]
        first = "Test Case '-[QuareiaTests.FirstTests testFirst]' passed (0.1 seconds)."
        second = "Test Case '-[QuareiaTests.SecondTests testSecond]' passed (0.1 seconds)."
        summary = "Executed 2 tests, with 0 failures (0 unexpected) in 0.2 seconds"
        valid = "\n".join([first, second, summary])
        self.assertEqual(TOOL.validate_runtime_group(valid, expected)["testCount"], 2)
        for candidate in [
            "\n".join([first, summary]),
            "\n".join([first, first, second, summary]),
            valid.replace("testSecond]' passed", "testSecond]' skipped"),
            valid.replace("0 failures", "1 failure"),
        ]:
            with self.subTest(candidate=candidate), self.assertRaises(TOOL.PrivateIntegrationError):
                TOOL.validate_runtime_group(candidate, expected)

    def test_distribution_settings_keep_real_provider_and_strip_device_test_flags(self):
        self.assertIn("SWIFT_ACTIVE_COMPILATION_CONDITIONS=PRIVATE_LXXXI_PROVIDER DISTRIBUTION PUBLIC_TESTING",
                      TOOL.simulator_settings(True))
        self.assertIn("SWIFT_ACTIVE_COMPILATION_CONDITIONS=PRIVATE_LXXXI_PROVIDER DISTRIBUTION",
                      TOOL.simulator_settings(False))
        device = TOOL.device_settings()
        self.assertIn("SWIFT_ACTIVE_COMPILATION_CONDITIONS=PRIVATE_LXXXI_PROVIDER DISTRIBUTION", device)
        self.assertIn("SWIFT_OPTIMIZATION_LEVEL=-O", device)
        self.assertIn("ENABLE_TESTABILITY=NO", device)
        self.assertIn("CODE_SIGNING_ALLOWED=NO", device)
        conditions = next(setting for setting in device if setting.startswith("SWIFT_ACTIVE_COMPILATION_CONDITIONS="))
        self.assertNotIn("PUBLIC_TESTING", conditions)
        self.assertNotIn("DEBUG", conditions)
        self.assertIn("ENABLE_DEBUG_DYLIB=NO", device)
        self.assertEqual(TOOL.bounded_xcode_command(600, ["test"])[1:],
                         ["ios-app/tools/run-bounded.py", "600", "xcodebuild", "test"])

    def test_cli_full_runtime_and_ipa_are_explicit_opt_ins(self):
        with tempfile.TemporaryDirectory() as directory:
            values = self.run_args(pathlib.Path(directory))
        cli = ["run"]
        for key, value in vars(values).items():
            if value is True:
                cli.append("--" + key.replace("_", "-"))
            else:
                cli.extend(["--" + key.replace("_", "-"), str(value)])
        args = TOOL.parse_args(cli)
        self.assertFalse(args.full_runtime)
        self.assertIsNone(args.ipa_output)
        args = TOOL.parse_args([*cli, "--full-runtime", "--ipa-output", "candidate.ipa"])
        self.assertTrue(args.full_runtime)
        self.assertEqual(args.ipa_output, "candidate.ipa")

    def test_full_orchestration_orders_gates_groups_release_and_verified_ipa(self):
        # External tools/inspection are mocked. Real local ZIP/hash checks still run;
        # this test is not evidence of Xcode compilation or provider decoding.
        authentication = "QuareiaTests/PrivateProviderAuthenticationNegativeTests/testRejectsCorruptSourceAndWrongKey"
        native = [TOOL.PROVIDER_TEST_IDENTIFIER, authentication, "QuareiaTests/AppRouteTests/testNonce"]
        remaining = ["QuareiaUITests/QuareiaUITests/testCustomSpreadQSPRoundTripUsesTheRealStudio"]
        expected = [*native, *TOOL.CRITICAL_UI_TESTS, *remaining]
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.make_path_fixture(root)
            args = self.run_args(root, full_runtime=True,
                                 ipa_output=str(root / "ipa" / "Quareia-1.0.0-1.ipa"))
            commands, events = [], []
            inspection = {}

            @contextlib.contextmanager
            def simulator(*unused, **kwargs):
                yield args.simulator_id

            def check_output(command, **kwargs):
                if command[1] == "rev-parse":
                    return SOURCE_SHA
                self.assertEqual(command[1:4], ["ls-tree", "-r", "-z"])
                events.append("public-tree-gate")
                return f"100644 blob {SOURCE_SHA}\tios-app/Quareia/AppRoute.swift\0"

            def execute(command, *, cwd, log, environment):
                commands.append(command)
                if command[:2] == ["git", "clone"]:
                    pathlib.Path(command[-1]).mkdir()
                if "test-without-building" in command:
                    if "-only-testing:QuareiaTests" in command:
                        group = native
                    elif "-only-testing:QuareiaUITests" in command:
                        group = remaining
                    else:
                        group = TOOL.CRITICAL_UI_TESTS
                    lines = []
                    if group == native:
                        lines = [f"PRIVATE_PROVIDER_DECODE_OK:{key}" for key in TOOL.EXPECTED_KEYS]
                        lines += ["PRIVATE_PROVIDER_82_DECODE_PASS", "PRIVATE_PROVIDER_AUTHENTICATION_NEGATIVE_PASS"]
                    for identifier in group:
                        target, name, method = identifier.split("/")
                        lines.append(f"Test Case '-[{target}.{name} {method}]' passed (0.1 seconds).")
                    lines.append(f"Executed {len(group)} tests, with 0 failures (0 unexpected)")
                    log.write_text("\n".join(lines), encoding="utf-8")
                    pathlib.Path(command[command.index("-resultBundlePath") + 1]).mkdir()
                if "Release" in command:
                    product = pathlib.Path(command[command.index("-derivedDataPath") + 1]) / "Build" / "Products" / "Release-iphoneos"
                    product.mkdir(parents=True)
                    _, report = PrivateCandidatePackagingTests().fixture(product)
                    inspection.update(report)

            with patch.object(TOOL.sys, "platform", "darwin"), patch.object(
                TOOL.subprocess, "check_output", side_effect=check_output
            ), patch.object(TOOL, "load_and_validate_manifest", return_value={"authenticationTestIdentifier": authentication}), patch.object(
                TOOL, "_copy_manifest_inputs", side_effect=lambda *unused: events.append("overlay-copy")
            ), patch.object(TOOL, "expected_runtime_tests", return_value=expected), patch.object(
                TOOL, "_ephemeral_simulator", side_effect=simulator
            ), patch.object(TOOL, "_run_logged", side_effect=execute), patch.object(
                TOOL, "inspect_private_device_app", side_effect=lambda *unused, **kwargs: dict(inspection)
            ):
                result = TOOL.run_private_integration(args, {"QUAREIA_PRIVATE_CI_APPROVED_CONTEXT": APPROVAL_CONTEXT})
            self.assertEqual(events, ["public-tree-gate", "overlay-copy"])
            groups = [command for command in commands if "test-without-building" in command]
            self.assertEqual([command[2] for command in groups], ["600", "600", "1200"])
            self.assertIn("-only-testing:QuareiaTests", groups[0])
            self.assertTrue(all(f"-only-testing:{test}" in groups[1] for test in TOOL.CRITICAL_UI_TESTS))
            self.assertTrue(all(f"-skip-testing:{test}" in groups[2] for test in TOOL.CRITICAL_UI_TESTS))
            release = next(command for command in commands if "Release" in command)
            self.assertTrue(set(TOOL.device_settings()) <= set(release))
            self.assertEqual(result["runtimeSuite"]["testCount"], len(expected))
            self.assertEqual(result["providerRuntimeEvidence"]["recordCount"], 82)
            self.assertTrue(result["providerRuntimeEvidence"]["authenticationNegativePassed"])
            self.assertEqual(result["deviceAcceptance"], "DEVICE_ACCEPTANCE_PENDING")
            self.assertFalse(result["releaseComplete"])
            self.assertEqual(result["ipa"]["sha256"], TOOL.sha256_file(pathlib.Path(args.ipa_output)))
            self.assertEqual(result["ipa"]["appBundleTreeSHA256"], result["finalApp"]["bundleTreeSHA256"])

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


class PrivateCandidatePackagingTests(unittest.TestCase):
    def fixture(self, root: pathlib.Path):
        app = root / "Quareia.app"
        app.mkdir(mode=0o755)
        data = b"PUBLIC SYNTHETIC TEST BYTES - NOT A PRIVATE PROVIDER OR REAL APP\n"
        file = app / "test-fixture.txt"
        file.write_bytes(data)
        file.chmod(0o644)
        report = {
            "status": "PRIVATE_CANDIDATE", "releaseComplete": False, "platform": "IOS",
            "reviewedSourceSHA": SOURCE_SHA,
            "bundleTreeSHA256": digest(("\0".join(["F", file.name, "0644", str(len(data)), digest(data)]) + "\n").encode()),
            "files": [{"path": file.name, "mode": "0644", "bytes": len(data),
                       "sha256": digest(data), "isMachO": False}], "directories": [],
        }
        return app, report

    def package(self, app, output, report):
        return TOOL.package_private_candidate(app, output, report,
            source_sha=SOURCE_SHA, manifest_sha256="b" * 64)

    def test_private_archive_is_reopened_and_binds_source_manifest_app_and_ipa(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app, report = self.fixture(root)
            output = root / "Quareia-1.0.0-1.ipa"
            result = self.package(app, output, report)
            self.assertEqual(result["sha256"], TOOL.sha256_file(output))
            self.assertEqual(result["bytes"], output.stat().st_size)
            self.assertEqual(result["appBundleTreeSHA256"], report["bundleTreeSHA256"])
            self.assertEqual(result["reviewedPublicSourceSHA"], SOURCE_SHA)
            self.assertEqual(result["approvedManifestSHA256"], "b" * 64)
            self.assertFalse(result["signed"])
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(set(archive.namelist()),
                                 {"Payload/", "Payload/Quareia.app/", "Payload/Quareia.app/test-fixture.txt"})
            if os.name != "nt":
                self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_changed_app_and_wrong_source_cannot_produce_private_ipa(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app, report = self.fixture(root)
            output = root / "Quareia-1.0.0-1.ipa"
            report["reviewedSourceSHA"] = "d" * 40
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "source binding"):
                self.package(app, output, report)
            report["reviewedSourceSHA"] = SOURCE_SHA
            original_tree = report["bundleTreeSHA256"]
            report["bundleTreeSHA256"] = "c" * 64
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "tree binding"):
                self.package(app, output, report)
            report["bundleTreeSHA256"] = original_tree
            (app / "test-fixture.txt").write_bytes(b"changed")
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "bundle/ZIP"):
                self.package(app, output, report)
            self.assertFalse(output.exists())

    def test_extra_zip_payload_is_rejected_before_output_and_existing_output_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app, report = self.fixture(root)
            output = root / "Quareia-1.0.0-1.ipa"
            packager = TOOL._load_public_packager()
            original = packager.write_candidate

            def inject(destination, *args):
                original(destination, *args)
                with zipfile.ZipFile(destination, "a") as archive:
                    archive.writestr("unreviewed.txt", b"synthetic extra")

            with patch.object(TOOL, "_load_public_packager", return_value=packager), patch.object(
                packager, "write_candidate", side_effect=inject
            ), self.assertRaisesRegex(TOOL.PrivateIntegrationError, "bundle/ZIP"):
                self.package(app, output, report)
            self.assertFalse(output.exists())
            output.write_bytes(b"existing")
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "overwrite"):
                self.package(app, output, report)
            self.assertEqual(output.read_bytes(), b"existing")


class PrivateDeploymentTargetTests(unittest.TestCase):
    def test_macho_target_checks_main_and_each_runtime_minimum(self):
        files = [{"path": "Quareia", "_absolute": pathlib.Path("Quareia")},
                 {"path": "Frameworks/libswiftCore.dylib", "_absolute": pathlib.Path("libswiftCore.dylib")}]
        machos = [{"path": entry["path"], "architectures": ["arm64"]} for entry in files]
        with patch.object(TOOL.subprocess, "check_output", side_effect=["platform IOS\n minos 16.0\n", "platform IOS\n minos 15.0\n"]):
            result = TOOL.validate_macho_deployment_targets(machos, files, "Quareia")
        self.assertEqual([entry["minimumOSVersion"] for entry in result], ["16.0", "15.0"])
        for outputs in [
            ["minos 17.0\n", "minos 15.0\n"],
            ["minos 15.0\n", "minos 15.0\n"],
            ["minos 16.0\n", "minos 16.1\n"],
            ["sdk 26.2\n", "minos 15.0\n"],
            ["minos 16.0\nminos 16.0\n", "minos 15.0\n"],
        ]:
            with self.subTest(outputs=outputs), patch.object(TOOL.subprocess, "check_output", side_effect=outputs), self.assertRaises(TOOL.PrivateIntegrationError):
                TOOL.validate_macho_deployment_targets(machos, files, "Quareia")
        with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "arm64"):
            TOOL.validate_macho_deployment_targets([{"path": "Quareia", "architectures": ["x86_64"]}], files, "Quareia")

    def test_private_info_target_and_final_deployment_report(self):
        # Only platform tool/provenance answers are mocked; this is not Apple build evidence.
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app = root / "Quareia.app"
            app.mkdir()
            binary = app / "Quareia"
            binary.write_bytes(b"\xcf\xfa\xed\xfe" + b"public synthetic unit fixture")
            binary.chmod(0o755)
            info = {"QuareiaBuildFlavor": "private-candidate", "CFBundleDisplayName": "Quareia",
                    "CFBundleIdentifier": "com.hedanbaomi.quareia.ios", "CFBundleShortVersionString": "1.0.0",
                    "CFBundleVersion": "1", "CFBundleSupportedPlatforms": ["iPhoneOS"],
                    "CFBundleExecutable": "Quareia", "MinimumOSVersion": "16.0"}
            inspector = TOOL._load_public_inspector()
            with patch.object(TOOL, "_load_public_inspector", return_value=inspector), patch.object(
                inspector, "_validate_public_resources", return_value={"reviewedBuildSourceSHA": SOURCE_SHA}
            ), patch.object(inspector, "_inspect_machos", return_value=[{"path": "Quareia", "architectures": ["arm64"]}]), patch.object(
                inspector, "_validate_entitlements", return_value=[]
            ), patch.object(TOOL.subprocess, "check_output", return_value="platform IOS\nminos 16.0\n") as vtool:
                for minimum in [None, "15.0", "17.0", "16.0"]:
                    if minimum is None:
                        info.pop("MinimumOSVersion", None)
                    else:
                        info["MinimumOSVersion"] = minimum
                    (app / "Info.plist").write_bytes(plistlib.dumps(info))
                    arguments = {"source_sha": SOURCE_SHA, "expected_version": "1.0.0", "expected_build": 1,
                                 "public_checkout": root}
                    if minimum != "16.0":
                        with self.subTest(minimum=minimum), self.assertRaisesRegex(TOOL.PrivateIntegrationError, "minimum iOS"):
                            TOOL.inspect_private_device_app(app, {"encryptedRecords": []}, **arguments)
                        vtool.assert_not_called()
                    else:
                        report = TOOL.inspect_private_device_app(app, {"encryptedRecords": []}, **arguments)
                        self.assertEqual(report["deploymentTarget"], "16.0")
                        self.assertEqual(report["architectures"], ["arm64"])
                        self.assertEqual((report["platform"], report["version"], report["build"]), ("IOS", "1.0.0", 1))
                        self.assertEqual(report["machOBinaries"][0]["minimumOSVersion"], "16.0")


class PrivatePayloadPrivacyTests(unittest.TestCase):
    def test_failure_diagnostic_never_returns_compiler_literals_or_full_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            log = pathlib.Path(directory) / "synthetic.log"
            log.write_text("/private/temporary/PrivateInputs/IntegratedLxxxiProvider.swift:42:9: error: cannot convert value 'SYNTHETIC_SENSITIVE_LITERAL'\n"
                           " 42 | let opaque = [12, 34, 56, 78]\n", encoding="utf-8")
            diagnostic = TOOL.sanitized_command_failure(log)
            self.assertEqual(diagnostic, {"category": "swift-compile", "errors": [
                {"category": "swift-type-check", "file": "IntegratedLxxxiProvider.swift", "line": 42}]})
            encoded = json.dumps(diagnostic)
            self.assertNotIn("SYNTHETIC_SENSITIVE_LITERAL", encoded)
            self.assertNotIn("12, 34", encoded)
            self.assertNotIn("/private/", encoded)
            log.write_text("Test Case '-[QuareiaTests.ProviderTests testTamper]' failed (0.1 seconds).\n", encoding="utf-8")
            self.assertEqual(TOOL.sanitized_command_failure(log),
                             {"category": "xctest-failed", "tests": ["ProviderTests/testTamper"]})
            log.write_text("/private/temporary/PrivateInputs/ProviderTests.swift:52: error: -[QuareiaTests.ProviderTests testTamper] : XCTAssertEqual failed: SYNTHETIC_SENSITIVE_LITERAL\n"
                           "Test Case '-[QuareiaTests.ProviderTests testTamper]' failed (0.1 seconds).\n", encoding="utf-8")
            self.assertEqual(TOOL.sanitized_command_failure(log), {
                "category": "xctest-failed", "tests": ["ProviderTests/testTamper"],
                "errors": [{"category": "xctest-failed", "file": "ProviderTests.swift", "line": 52}]})
            self.assertNotIn("SYNTHETIC_SENSITIVE_LITERAL", json.dumps(TOOL.sanitized_command_failure(log)))
            self.assertNotIn("/private/", json.dumps(TOOL.sanitized_command_failure(log)))
            log.write_text("COMMAND_TIMEOUT after 600s: xcodebuild\n", encoding="utf-8")
            self.assertEqual(TOOL.sanitized_command_failure(log), {"category": "command-timeout"})

    def test_cli_gate_failure_reports_only_public_source_coordinate(self):
        import contextlib
        import io
        import types
        from unittest import mock
        error = io.StringIO()
        with mock.patch.object(TOOL, "parse_args", return_value=types.SimpleNamespace(command="run")), \
             mock.patch.object(TOOL, "run_private_integration", side_effect=ValueError("SYNTHETIC_SENSITIVE_LITERAL /private/material")), \
             contextlib.redirect_stderr(error):
            self.assertEqual(TOOL.main([]), 3)
        prefix = "PRIVATE_BUILD_BLOCKED: Private command failed: "
        self.assertTrue(error.getvalue().startswith(prefix))
        value = json.loads(error.getvalue()[len(prefix):])
        self.assertEqual(set(value), {"category", "gateLine"})
        self.assertEqual(value["category"], "gate-failed")
        self.assertTrue(1 <= value["gateLine"] <= 1_000_000)
        self.assertNotIn("SYNTHETIC_SENSITIVE_LITERAL", error.getvalue())
        self.assertNotIn("/private/", error.getvalue())

    def test_timeout_context_is_finite_and_contains_no_test_values(self):
        with tempfile.TemporaryDirectory() as directory:
            log = pathlib.Path(directory) / "private-critical-ui.log"
            log.write_text(
                "Test Case '-[QuareiaUITests.QuareiaUITests testFirst]' started.\n"
                "Test Case '-[QuareiaUITests.QuareiaUITests testFirst]' passed (1 seconds).\n"
                "Test Case '-[QuareiaUITests.QuareiaUITests testShare]' started.\n"
                "SYNTHETIC_SENSITIVE_LITERAL /private/temporary/value\n"
                "COMMAND_TIMEOUT after 600s: xcodebuild\n", encoding="utf-8")
            self.assertEqual(TOOL.sanitized_command_failure(log), {
                "category": "command-timeout", "phase": "critical-ui",
                "progress": {"passed": 1, "failed": 0, "skipped": 0, "lastTest": "QuareiaUITests/testShare"}})
            encoded = json.dumps(TOOL.sanitized_command_failure(log))
            self.assertNotIn("SYNTHETIC_SENSITIVE_LITERAL", encoded)
            self.assertNotIn("/private/", encoded)

    def test_public_source_tree_rejects_private_material_before_overlay(self):
        def listing(path, mode="100644"):
            return f"{mode} blob {'a' * 40}\t{path}\0"

        TOOL.validate_public_source_tree(listing("ios-app/Quareia/AppRoute.swift"))
        TOOL.validate_public_source_tree(listing("backend/.env.example"))
        TOOL.validate_public_source_tree(listing("android-demo/app/src/main/java/example/LxxxiAssetProvider.kt"))
        for path in [".private/handoff.md", "ios-app/PrivateInputs/Provider.swift",
                     "records/lxxxi-01.qv", "config/.env.production", ".env.example", "secret.key",
                     "android-demo/app/src/main/java/example/VaultMaterial.kt",
                     "android-demo/app/src/main/java/example/LxxxiVault.kt",
                     "android-demo/app/src/main/java/example/PrivateLxxxiAssetProvider.kt",
                     "ios-app/Quareia/IntegratedLxxxiProvider.swift",
                     "ios-app/Quareia/IntegratedVaultMaterial.swift",
                     "android-demo/app/src/main/assets/qv/opaque.dat",
                     "android-demo/app/src/main/assets/QV/opaque.dat"]:
            with self.subTest(path=path), self.assertRaises(TOOL.PrivateIntegrationError):
                TOOL.validate_public_source_tree(listing(path))
        with self.assertRaises(TOOL.PrivateIntegrationError):
            TOOL.validate_public_source_tree(listing("linked-source", "120000"))

    def test_private_payload_rejects_sidecars_raw_directories_and_arbitrary_files(self):
        def entry(path, data=b"public synthetic fixture", macho=False):
            return {"path": path, "_data": data, "isMachO": macho, "sha256": digest(data)}

        base = [entry("Quareia", macho=True), entry("Info.plist"), entry("PkgInfo", b"APPL????")]
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            TOOL.validate_private_runtime_payload(base, [], "Quareia", root)
            for path in ["Provider.swift", "Provider.kt", "Provider.java", ".env", ".env.production", ".env.example",
                         "private.key", "settings.env", "notes.txt", "raw-scans/card.png", "plaintext/image.png"]:
                with self.subTest(path=path), self.assertRaises(TOOL.PrivateIntegrationError):
                    TOOL.validate_private_runtime_payload([*base, entry(path)], [], "Quareia", root)
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "directory"):
                TOOL.validate_private_runtime_payload(base, [{"path": "raw-scans"}], "Quareia", root)

    def test_probe_bytes_must_match_reviewed_source_and_frameworks_must_be_compiled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / "ios-app" / "Quareia" / "Resources" / "probe" / "index.html"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"public probe")
            probe = {"path": "probe/index.html", "_data": b"public probe",
                     "sha256": digest(b"public probe"), "isMachO": False}
            TOOL.validate_private_runtime_payload([probe], [{"path": "probe"}], "Quareia", root)
            probe["sha256"] = "0" * 64
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "reviewed public source"):
                TOOL.validate_private_runtime_payload([probe], [{"path": "probe"}], "Quareia", root)
            library = {"path": "Frameworks/libswiftCore.dylib", "_data": b"not a compiled binary",
                       "sha256": "a" * 64, "isMachO": False}
            with self.assertRaisesRegex(TOOL.PrivateIntegrationError, "not Mach-O"):
                TOOL.validate_private_runtime_payload([library], [{"path": "Frameworks"}], "Quareia", root)


if __name__ == "__main__":
    unittest.main()
