#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Default-disabled, local orchestration contract for approved private iOS inputs.

The command never runs for pull-request events and never reads a private
manifest until an explicit local approval-context gate is satisfied. It creates
an ephemeral checkout at one reviewed public SHA, injects only manifest-listed
files, runs the real provider XCTest and format-specific authentication test,
builds an unsigned device app, validates the final payload, and writes only a
sanitized local report. All Xcode output remains in the ephemeral private
directory and is removed with it.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
import pathlib
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid
from typing import Any


EXPECTED_KEYS = ["lxxxi-back"] + [f"lxxxi-{index:02d}" for index in range(1, 82)]
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CONTEXT_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
SWIFT_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*\.swift$")
PRIVATE_PROVIDER_SOURCE_RE = re.compile(r"^provider/[A-Za-z][A-Za-z0-9_]*\.swift$")
PRIVATE_TEST_SOURCE_RE = re.compile(r"^tests/[A-Za-z][A-Za-z0-9_]*\.swift$")
PRIVATE_RECORD_RE = re.compile(
    r"^records/lxxxi-(?:back|(?:0[1-9]|[1-7][0-9]|8[01]))\.qv$"
)
AUTH_TEST_RE = re.compile(
    r"^QuareiaTests/([A-Za-z][A-Za-z0-9_]*)/(test[A-Za-z0-9_]+)$"
)
PROVIDER_TEST_IDENTIFIER = (
    "QuareiaTests/PrivateProviderAcceptanceTests/"
    "testIntegratedProviderDecodesExactRecordSet"
)
MAX_PRIVATE_INPUT_BYTES = 100 * 1024 * 1024
SIMULATOR_UDID_RE = re.compile(
    r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
)


class PrivateIntegrationError(RuntimeError):
    """The private integration runner failed closed with sanitized detail."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise PrivateIntegrationError(message)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative(value: Any, pattern: re.Pattern[str], label: str) -> str:
    require(type(value) is str and pattern.fullmatch(value) is not None, f"Invalid {label} path")
    require("\\" not in value and all(part not in {"", ".", ".."} for part in value.split("/")), f"Unsafe {label} path")
    return value


def resolve_manifest_input(base: pathlib.Path, relative: str) -> pathlib.Path:
    target = (base / pathlib.PurePosixPath(relative)).resolve(strict=True)
    require(os.path.commonpath([str(base), str(target)]) == str(base), "Private input escaped manifest directory")
    require(target.is_file() and not target.is_symlink(), "Private input must be a regular non-symlink file")
    if os.name != "nt":
        mode = stat.S_IMODE(target.stat().st_mode)
        require(mode & 0o077 == 0 and mode & stat.S_IRUSR, "Private input permissions must be owner-read only")
    return target


def _validate_file_entry(
    value: Any,
    *,
    base: pathlib.Path,
    source_pattern: re.Pattern[str],
    require_destination: bool,
) -> dict[str, Any]:
    expected = {"source", "sha256", "bytes"}
    if require_destination:
        expected.add("destination")
    require(type(value) is dict and set(value) == expected, "Private input entry fields do not match schema")
    source = safe_relative(value["source"], source_pattern, "private input")
    target = resolve_manifest_input(base, source)
    require(type(value["bytes"]) is int and 0 < value["bytes"] <= MAX_PRIVATE_INPUT_BYTES, "Invalid private input byte count")
    require(type(value["sha256"]) is str and SHA256_RE.fullmatch(value["sha256"]), "Invalid private input hash")
    require(target.stat().st_size == value["bytes"], "Private input size mismatch")
    require(sha256_file(target) == value["sha256"], "Private input hash mismatch")
    result = dict(value)
    result["_absolute"] = target
    if require_destination:
        require(type(value["destination"]) is str and SWIFT_NAME_RE.fullmatch(value["destination"]), "Invalid private Swift destination")
    return result


def load_and_validate_manifest(
    manifest_path: pathlib.Path,
    *,
    expected_manifest_sha256: str,
    expected_source_sha: str,
    expected_approval_context: str,
) -> dict[str, Any]:
    require(SHA256_RE.fullmatch(expected_manifest_sha256) is not None, "Approved manifest hash must be lowercase 64-hex")
    require(SHA40_RE.fullmatch(expected_source_sha) is not None, "Reviewed public source SHA must be full lowercase hex")
    manifest_path = manifest_path.resolve(strict=True)
    require(manifest_path.is_file() and not manifest_path.is_symlink(), "Private manifest must be a regular non-symlink file")
    if os.name != "nt":
        mode = stat.S_IMODE(manifest_path.stat().st_mode)
        require(mode & 0o077 == 0 and mode & stat.S_IRUSR, "Private manifest permissions must be owner-read only")
    require(sha256_file(manifest_path) == expected_manifest_sha256, "Private manifest hash does not match approved hash")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (UnicodeError, json.JSONDecodeError) as cause:
        raise PrivateIntegrationError("Private manifest is not valid UTF-8 JSON") from cause
    require(type(manifest) is dict, "Private manifest must be an object")
    require(
        set(manifest)
        == {
            "schemaVersion",
            "reviewedPublicSourceSHA",
            "approvalContext",
            "providerSources",
            "authenticationTestSources",
            "authenticationTestIdentifier",
            "encryptedRecords",
        },
        "Private manifest fields do not match schema",
    )
    require(manifest["schemaVersion"] == 1, "Unsupported private manifest schema")
    require(manifest["reviewedPublicSourceSHA"] == expected_source_sha, "Private manifest reviewed source SHA mismatch")
    require(manifest["approvalContext"] == expected_approval_context, "Private manifest approval context mismatch")
    auth_match = AUTH_TEST_RE.fullmatch(manifest["authenticationTestIdentifier"] or "")
    require(auth_match is not None, "Invalid private authentication test identifier")

    base = manifest_path.parent.resolve(strict=True)
    provider_values = manifest["providerSources"]
    test_values = manifest["authenticationTestSources"]
    require(type(provider_values) is list and 1 <= len(provider_values) <= 16, "Provider source count is out of range")
    require(type(test_values) is list and 1 <= len(test_values) <= 16, "Authentication test source count is out of range")
    providers = [
        _validate_file_entry(
            value,
            base=base,
            source_pattern=PRIVATE_PROVIDER_SOURCE_RE,
            require_destination=True,
        )
        for value in provider_values
    ]
    tests = [
        _validate_file_entry(
            value,
            base=base,
            source_pattern=PRIVATE_TEST_SOURCE_RE,
            require_destination=True,
        )
        for value in test_values
    ]
    provider_destinations = [value["destination"] for value in providers]
    test_destinations = [value["destination"] for value in tests]
    require(len(provider_destinations) == len(set(provider_destinations)), "Duplicate provider destination")
    require(len(test_destinations) == len(set(test_destinations)), "Duplicate authentication test destination")
    require("IntegratedLxxxiProvider.swift" in provider_destinations, "IntegratedLxxxiProvider.swift is required")
    require(f"{auth_match.group(1)}.swift" in test_destinations, "Authentication test class source is not listed")

    record_values = manifest["encryptedRecords"]
    require(type(record_values) is list and len(record_values) == 82, "Private manifest must list exactly 82 encrypted records")
    records = []
    total_record_bytes = 0
    for index, value in enumerate(record_values):
        require(type(value) is dict and set(value) == {"logicalKey", "source", "sha256", "bytes"}, "Encrypted record fields do not match schema")
        require(
            value["logicalKey"] == EXPECTED_KEYS[index],
            "Encrypted record logical keys/order must be lxxxi-back then lxxxi-01 through lxxxi-81",
        )
        expected_source = f"records/{value['logicalKey']}.qv"
        require(value["source"] == expected_source, "Encrypted record source path does not match logical key")
        file_value = {key: value[key] for key in ["source", "sha256", "bytes"]}
        entry = _validate_file_entry(
            file_value,
            base=base,
            source_pattern=PRIVATE_RECORD_RE,
            require_destination=False,
        )
        entry["logicalKey"] = value["logicalKey"]
        records.append(entry)
        total_record_bytes += value["bytes"]
    require(total_record_bytes <= MAX_PRIVATE_INPUT_BYTES, "Encrypted record set exceeds 100 MiB")

    copied_sources = [value["source"] for value in providers + tests + records]
    require(len(copied_sources) == len(set(copied_sources)), "Duplicate private input source")
    result = dict(manifest)
    result["providerSources"] = providers
    result["authenticationTestSources"] = tests
    result["encryptedRecords"] = records
    result["_manifestSHA256"] = expected_manifest_sha256
    return result


def _xcode_id(kind: str, path: str) -> str:
    return hashlib.sha256(f"quareia-private-v1:{kind}:{path}".encode("utf-8")).hexdigest()[:24].upper()


def _insert_after_once(text: str, marker: str, insertion: str) -> str:
    require(text.count(marker) == 1, "Xcode project insertion marker is missing or ambiguous")
    return text.replace(marker, marker + "\n" + insertion, 1)


def _add_build_files_to_phase(text: str, phase_id: str, label: str, lines: list[str]) -> str:
    pattern = re.compile(
        rf"(\t\t{re.escape(phase_id)} /\* {re.escape(label)} \*/ = \{{[^\n]*?files = \()([^)]*)(\);[^\n]*\}};)",
    )
    match = pattern.search(text)
    require(match is not None, f"Xcode {label} phase is missing")
    replacement = match.group(1) + " ".join(lines) + " " + match.group(2) + match.group(3)
    return text[: match.start()] + replacement + text[match.end() :]


def patch_xcode_project(
    project_text: str,
    provider_destinations: list[str],
    test_destinations: list[str],
) -> str:
    all_paths = [f"PrivateInputs/{name}" for name in provider_destinations]
    all_paths += [f"PrivateInputs/Tests/{name}" for name in test_destinations]
    all_paths.append("PrivateInputs/PrivateAssets")
    for path in all_paths:
        require(path not in project_text, "Xcode project already contains a private integration reference")

    build_lines = []
    reference_lines = []
    app_phase_lines = []
    test_phase_lines = []
    for destination in provider_destinations:
        relative = f"PrivateInputs/{destination}"
        ref_id = _xcode_id("ref", relative)
        build_id = _xcode_id("build", relative)
        require(ref_id not in project_text and build_id not in project_text, "Generated Xcode ID collision")
        reference_lines.append(
            f"\t\t{ref_id} /* {destination} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {relative}; sourceTree = SOURCE_ROOT; }};"
        )
        build_lines.append(
            f"\t\t{build_id} /* {destination} in Sources */ = {{isa = PBXBuildFile; fileRef = {ref_id} /* {destination} */; }};"
        )
        app_phase_lines.append(f"{build_id} /* {destination} in Sources */,")
    for destination in test_destinations:
        relative = f"PrivateInputs/Tests/{destination}"
        ref_id = _xcode_id("ref", relative)
        build_id = _xcode_id("build", relative)
        require(ref_id not in project_text and build_id not in project_text, "Generated Xcode ID collision")
        reference_lines.append(
            f"\t\t{ref_id} /* {destination} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {relative}; sourceTree = SOURCE_ROOT; }};"
        )
        build_lines.append(
            f"\t\t{build_id} /* {destination} in Sources */ = {{isa = PBXBuildFile; fileRef = {ref_id} /* {destination} */; }};"
        )
        test_phase_lines.append(f"{build_id} /* {destination} in Sources */,")

    resource_relative = "PrivateInputs/PrivateAssets"
    resource_ref = _xcode_id("ref", resource_relative)
    resource_build = _xcode_id("build", resource_relative)
    reference_lines.append(
        f"\t\t{resource_ref} /* PrivateAssets */ = {{isa = PBXFileReference; lastKnownFileType = folder; path = {resource_relative}; sourceTree = SOURCE_ROOT; }};"
    )
    build_lines.append(
        f"\t\t{resource_build} /* PrivateAssets in Resources */ = {{isa = PBXBuildFile; fileRef = {resource_ref} /* PrivateAssets */; }};"
    )

    patched = _insert_after_once(
        project_text,
        "/* Begin PBXBuildFile section */",
        "\n".join(build_lines),
    )
    patched = _insert_after_once(
        patched,
        "/* Begin PBXFileReference section */",
        "\n".join(reference_lines),
    )
    patched = _add_build_files_to_phase(
        patched,
        "060000000000000000000001",
        "Sources",
        app_phase_lines,
    )
    patched = _add_build_files_to_phase(
        patched,
        "060000000000000000000002",
        "Sources",
        test_phase_lines,
    )
    patched = _add_build_files_to_phase(
        patched,
        "070000000000000000000001",
        "Resources",
        [f"{resource_build} /* PrivateAssets in Resources */,"],
    )
    return patched


def validate_test_evidence(log_text: str, authentication_test_identifier: str) -> dict[str, Any]:
    decode_keys = re.findall(
        r"(?m)^.*?PRIVATE_PROVIDER_DECODE_OK:(lxxxi-(?:back|(?:0[1-9]|[1-7][0-9]|8[01])))\s*$",
        log_text,
    )
    require(decode_keys == EXPECTED_KEYS, "Provider test did not emit the exact ordered 82-record decode evidence")
    require(log_text.count("PRIVATE_PROVIDER_82_DECODE_PASS") == 1, "Provider aggregate decode marker is missing or duplicated")
    require(log_text.count("PRIVATE_PROVIDER_AUTHENTICATION_NEGATIVE_PASS") == 1, "Format-specific authentication negative marker is missing or duplicated")
    auth_match = AUTH_TEST_RE.fullmatch(authentication_test_identifier)
    require(auth_match is not None, "Invalid authentication test identifier")

    def has_passed_line(class_name: str, method_name: str) -> bool:
        return any(
            "Test Case" in line
            and class_name in line
            and method_name in line
            and " passed " in f" {line} "
            for line in log_text.splitlines()
        )

    require(
        has_passed_line(
            "PrivateProviderAcceptanceTests",
            "testIntegratedProviderDecodesExactRecordSet",
        ),
        "Provider acceptance XCTest did not report passed",
    )
    require(
        has_passed_line(auth_match.group(1), auth_match.group(2)),
        "Format-specific authentication XCTest did not report passed",
    )
    require(
        re.search(r"Executed 2 tests?, with 0 failures", log_text) is not None,
        "Private XCTest summary does not prove two passing tests",
    )
    return {
        "providerTestIdentifier": PROVIDER_TEST_IDENTIFIER,
        "authenticationTestIdentifier": authentication_test_identifier,
        "decodedLogicalKeys": decode_keys,
        "recordCount": len(decode_keys),
        "authenticationNegativePassed": True,
    }


def _load_public_inspector():
    path = pathlib.Path(__file__).with_name("inspect-app.py")
    spec = importlib.util.spec_from_file_location("quareia_public_inspector", path)
    require(spec is not None and spec.loader is not None, "Cannot load public app inspector")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def inspect_private_device_app(
    app: pathlib.Path,
    manifest: dict[str, Any],
    *,
    source_sha: str,
    expected_version: str,
    expected_build: int,
) -> dict[str, Any]:
    inspector = _load_public_inspector()
    require(app.name == "Quareia.app" and app.is_dir() and not app.is_symlink(), "Missing private candidate Quareia.app")
    if os.name != "nt":
        inspector.validate_posix_permissions(
            stat.S_IMODE(app.stat().st_mode), ".", directory=True
        )
    files: list[dict[str, Any]] = []
    directories: list[dict[str, Any]] = []
    for root, dir_names, file_names in os.walk(app, followlinks=False):
        base = pathlib.Path(root)
        for name in sorted(dir_names):
            item = base / name
            relative = item.relative_to(app).as_posix()
            require(not item.is_symlink(), "Final private app contains a symlink")
            mode = stat.S_IMODE(item.stat().st_mode)
            if os.name != "nt":
                inspector.validate_posix_permissions(mode, relative, directory=True)
            directories.append({"path": relative, "mode": f"{mode:04o}"})
        for name in sorted(file_names):
            item = base / name
            relative = item.relative_to(app).as_posix()
            require(not item.is_symlink() and item.is_file(), "Final private app contains a non-regular file")
            require(item.suffix.lower() not in {".swift", ".key", ".pem", ".p12", ".mobileprovision"}, "Final private app contains a source/key sidecar")
            require(".private" not in {part.casefold() for part in pathlib.PurePosixPath(relative).parts}, "Final private app contains a private metadata directory")
            require(
                "privateinputs"
                not in {part.casefold() for part in pathlib.PurePosixPath(relative).parts},
                "Final private app contains the ephemeral private input directory",
            )
            data = item.read_bytes()
            mode = stat.S_IMODE(item.stat().st_mode)
            is_macho = data[:4] in inspector.MACHO_MAGICS
            if os.name != "nt":
                inspector.validate_posix_permissions(mode, relative, directory=False, macho=is_macho)
            files.append(
                {
                    "path": relative,
                    "mode": f"{mode:04o}",
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "isMachO": is_macho,
                    "_data": data,
                    "_absolute": item,
                }
            )
    by_path = {entry["path"]: entry for entry in files}
    require("Info.plist" in by_path, "Private candidate has no Info.plist")
    try:
        info = plistlib.loads(by_path["Info.plist"]["_data"])
    except plistlib.InvalidFileException as cause:
        raise PrivateIntegrationError("Private candidate Info.plist is invalid") from cause
    require(info.get("QuareiaBuildFlavor") == "private-candidate", "Private candidate flavor marker is missing")
    require(info.get("CFBundleDisplayName") == "Quareia", "Private candidate display name is incorrect")
    require(info.get("CFBundleIdentifier") == "com.hedanbaomi.quareia.ios", "Private candidate bundle identifier is incorrect")
    require(info.get("CFBundleShortVersionString") == expected_version, "Private candidate version mismatch")
    require(info.get("CFBundleVersion") == str(expected_build), "Private candidate build mismatch")
    require(info.get("CFBundleSupportedPlatforms") == ["iPhoneOS"], "Private candidate is not iPhoneOS")

    expected_records = {
        f"PrivateAssets/lxxxi/{entry['logicalKey']}.qv": entry for entry in manifest["encryptedRecords"]
    }
    actual_qv = {entry["path"] for entry in files if pathlib.PurePosixPath(entry["path"]).suffix.lower() == ".qv"}
    require(actual_qv == set(expected_records), "Final private app encrypted record set is missing or has extras")
    actual_private_assets = {
        entry["path"] for entry in files if entry["path"].startswith("PrivateAssets/")
    }
    require(
        actual_private_assets == set(expected_records),
        "Final PrivateAssets payload contains an unreviewed extra file",
    )
    for path, expected in expected_records.items():
        require(by_path[path]["bytes"] == expected["bytes"], "Final encrypted record size mismatch")
        require(by_path[path]["sha256"] == expected["sha256"], "Final encrypted record hash mismatch")

    provenance = inspector._validate_public_resources(app, files, source_sha)
    executable = info.get("CFBundleExecutable")
    require(type(executable) is str, "Private candidate executable is missing")
    machos = inspector._inspect_machos(files, "IOS", executable)
    entitlements = inspector._validate_entitlements(app, "IOS", files)
    tree = hashlib.sha256()
    total_bytes = 0
    clean_files = []
    for entry in sorted(files, key=lambda value: value["path"]):
        clean = {key: entry[key] for key in ["path", "mode", "bytes", "sha256", "isMachO"]}
        clean_files.append(clean)
        total_bytes += entry["bytes"]
        tree.update(f"F\0{entry['path']}\0{entry['mode']}\0{entry['bytes']}\0{entry['sha256']}\n".encode())
    for entry in sorted(directories, key=lambda value: value["path"]):
        tree.update(f"D\0{entry['path']}\0{entry['mode']}\n".encode())
    return {
        "status": "PRIVATE_CANDIDATE",
        "releaseComplete": False,
        "platform": "IOS",
        "version": expected_version,
        "build": expected_build,
        "reviewedSourceSHA": source_sha,
        "bundleBytes": total_bytes,
        "bundleTreeSHA256": tree.hexdigest(),
        "files": clean_files,
        "directories": sorted(directories, key=lambda value: value["path"]),
        "machOBinaries": machos,
        "entitlementKeys": entitlements,
        "provenance": provenance,
        "encryptedRecordCount": len(actual_qv),
        "sourceOrKeySidecars": 0,
    }


def authorize_real_run(args: argparse.Namespace, environment: dict[str, str]) -> None:
    require(sys.platform == "darwin", "PRIVATE_BUILD_BLOCKED: real private integration requires macOS/Xcode")
    require(args.approved_private_context, "PRIVATE_BUILD_BLOCKED: explicit --approved-private-context is required")
    require(CONTEXT_RE.fullmatch(args.approval_context or "") is not None, "Invalid approval context identifier")
    require(
        environment.get("QUAREIA_PRIVATE_CI_APPROVED_CONTEXT") == args.approval_context,
        "PRIVATE_BUILD_BLOCKED: approval-context environment gate does not match",
    )
    event = environment.get("GITHUB_EVENT_NAME", "")
    require("pull_request" not in event and not environment.get("GITHUB_HEAD_REF"), "Private integration is forbidden for pull-request events")
    if event:
        require(event == "workflow_dispatch", "Private CI must be manually dispatched")
    github_sha = environment.get("GITHUB_SHA")
    if github_sha:
        require(github_sha == args.source_sha, "GITHUB_SHA does not match reviewed public source SHA")


def _safe_command_environment(environment: dict[str, str]) -> dict[str, str]:
    allowed = {"PATH", "HOME", "DEVELOPER_DIR", "LANG", "LC_ALL", "SYSTEMROOT"}
    return {key: value for key, value in environment.items() if key in allowed}


def _run_logged(command: list[str], *, cwd: pathlib.Path, log: pathlib.Path, environment: dict[str, str]) -> None:
    with log.open("ab") as stream:
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=environment,
            stdout=stream,
            stderr=subprocess.STDOUT,
            check=False,
        )
    require(completed.returncode == 0, "A private build/test command failed; details remain in ephemeral private logs")


def _path_is_within(path: pathlib.Path, directory: pathlib.Path) -> bool:
    return os.path.commonpath([str(path), str(directory)]) == str(directory)


def _paths_overlap(left: pathlib.Path, right: pathlib.Path) -> bool:
    return _path_is_within(left, right) or _path_is_within(right, left)


def _require_owner_private_directory(path: pathlib.Path, label: str) -> None:
    require(path.is_dir() and not path.is_symlink(), f"{label} must be a non-symlink directory")
    if os.name != "nt":
        status = path.stat()
        require(status.st_uid == os.geteuid(), f"{label} must be owned by the current user")
        require(stat.S_IMODE(status.st_mode) & 0o077 == 0, f"{label} permissions must be owner-only")


def _simulator_profile(
    reference_udid: str,
    *,
    cwd: pathlib.Path,
    environment: dict[str, str],
) -> tuple[str, str]:
    require(SIMULATOR_UDID_RE.fullmatch(reference_udid) is not None, "Invalid reference simulator UDID")
    raw = subprocess.check_output(
        ["xcrun", "simctl", "list", "devices", "available", "--json"],
        cwd=cwd,
        env=environment,
        text=True,
    )
    try:
        listing = json.loads(raw)
    except json.JSONDecodeError as cause:
        raise PrivateIntegrationError("simctl returned invalid device JSON") from cause
    devices = listing.get("devices") if type(listing) is dict else None
    require(type(devices) is dict, "simctl device JSON has no devices map")
    matches = []
    for runtime_identifier, runtime_devices in devices.items():
        if type(runtime_identifier) is not str or type(runtime_devices) is not list:
            continue
        for device in runtime_devices:
            if type(device) is dict and device.get("udid") == reference_udid:
                matches.append((runtime_identifier, device.get("deviceTypeIdentifier")))
    require(len(matches) == 1, "Reference simulator is unavailable or ambiguous")
    runtime_identifier, device_type_identifier = matches[0]
    require(
        runtime_identifier.startswith("com.apple.CoreSimulator.SimRuntime.iOS-"),
        "Reference simulator is not an iOS runtime",
    )
    require(
        type(device_type_identifier) is str
        and device_type_identifier.startswith("com.apple.CoreSimulator.SimDeviceType.iPhone-"),
        "Reference simulator is not an iPhone device type",
    )
    return runtime_identifier, device_type_identifier


def _create_ephemeral_simulator(
    reference_udid: str,
    *,
    cwd: pathlib.Path,
    environment: dict[str, str],
) -> str:
    runtime_identifier, device_type_identifier = _simulator_profile(
        reference_udid,
        cwd=cwd,
        environment=environment,
    )
    name = f"Quareia-Private-{uuid.uuid4().hex[:12]}"
    created = subprocess.check_output(
        ["xcrun", "simctl", "create", name, device_type_identifier, runtime_identifier],
        cwd=cwd,
        env=environment,
        text=True,
    ).strip()
    require(SIMULATOR_UDID_RE.fullmatch(created) is not None, "simctl did not return a simulator UDID")
    return created


def _delete_ephemeral_simulator(
    simulator_udid: str,
    *,
    cwd: pathlib.Path,
    log: pathlib.Path,
    environment: dict[str, str],
) -> None:
    with log.open("ab") as stream:
        subprocess.run(
            ["xcrun", "simctl", "shutdown", simulator_udid],
            cwd=cwd,
            env=environment,
            stdout=stream,
            stderr=subprocess.STDOUT,
            check=False,
        )
        deleted = subprocess.run(
            ["xcrun", "simctl", "delete", simulator_udid],
            cwd=cwd,
            env=environment,
            stdout=stream,
            stderr=subprocess.STDOUT,
            check=False,
        )
    require(deleted.returncode == 0, "Ephemeral private simulator deletion failed")
    raw = subprocess.check_output(
        ["xcrun", "simctl", "list", "devices", "--json"],
        cwd=cwd,
        env=environment,
        text=True,
    )
    try:
        listing = json.loads(raw)
    except json.JSONDecodeError as cause:
        raise PrivateIntegrationError("simctl returned invalid cleanup verification JSON") from cause
    devices = listing.get("devices") if type(listing) is dict else None
    require(type(devices) is dict, "simctl cleanup verification has no devices map")
    still_present = any(
        type(device) is dict and device.get("udid") == simulator_udid
        for runtime_devices in devices.values()
        if type(runtime_devices) is list
        for device in runtime_devices
    )
    require(not still_present, "Ephemeral private simulator still exists after deletion")


@contextlib.contextmanager
def _ephemeral_simulator(
    reference_udid: str,
    *,
    cwd: pathlib.Path,
    log: pathlib.Path,
    environment: dict[str, str],
):
    simulator_udid = _create_ephemeral_simulator(
        reference_udid,
        cwd=cwd,
        environment=environment,
    )
    try:
        yield simulator_udid
    except BaseException:
        try:
            _delete_ephemeral_simulator(
                simulator_udid,
                cwd=cwd,
                log=log,
                environment=environment,
            )
        except Exception as cleanup_cause:
            raise PrivateIntegrationError(
                "Private test failed and ephemeral simulator cleanup also failed"
            ) from cleanup_cause
        raise
    else:
        _delete_ephemeral_simulator(
            simulator_udid,
            cwd=cwd,
            log=log,
            environment=environment,
        )


def _copy_manifest_inputs(checkout: pathlib.Path, manifest: dict[str, Any]) -> None:
    private_root = checkout / "ios-app" / "PrivateInputs"
    (private_root / "Tests").mkdir(parents=True, mode=0o700)
    assets = private_root / "PrivateAssets" / "lxxxi"
    assets.mkdir(parents=True, mode=0o700)
    def copy_verified(entry: dict[str, Any], destination: pathlib.Path) -> None:
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(entry["_absolute"], flags)
        try:
            source_status = os.fstat(descriptor)
            require(
                stat.S_ISREG(source_status.st_mode),
                "Private input changed to a non-regular file while being copied",
            )
            with os.fdopen(descriptor, "rb", closefd=False) as source, destination.open("xb") as target:
                shutil.copyfileobj(source, target, length=1024 * 1024)
        finally:
            os.close(descriptor)
        require(
            destination.stat().st_size == entry["bytes"]
            and sha256_file(destination) == entry["sha256"],
            "Private input changed while being copied",
        )
        destination.chmod(0o600)

    for entry in manifest["providerSources"]:
        destination = private_root / entry["destination"]
        copy_verified(entry, destination)
    for entry in manifest["authenticationTestSources"]:
        destination = private_root / "Tests" / entry["destination"]
        copy_verified(entry, destination)
    for entry in manifest["encryptedRecords"]:
        destination = assets / f"{entry['logicalKey']}.qv"
        copy_verified(entry, destination)
    project = checkout / "ios-app" / "Quareia.xcodeproj" / "project.pbxproj"
    patched = patch_xcode_project(
        project.read_text(encoding="utf-8"),
        [entry["destination"] for entry in manifest["providerSources"]],
        [entry["destination"] for entry in manifest["authenticationTestSources"]],
    )
    project.write_text(patched, encoding="utf-8", newline="\n")


def run_private_integration(args: argparse.Namespace, environment: dict[str, str] | None = None) -> dict[str, Any]:
    environment = dict(os.environ if environment is None else environment)
    authorize_real_run(args, environment)
    repo = pathlib.Path(args.repo).resolve(strict=True)
    require((repo / ".git").exists(), "Repository root is not a Git checkout")
    manifest_path = pathlib.Path(args.manifest).resolve(strict=True)
    require(not _path_is_within(manifest_path, repo), "Private manifest must remain outside the public repository")
    candidate_output = pathlib.Path(args.candidate_app_output).resolve(strict=False)
    report_path = pathlib.Path(args.report).resolve(strict=False)
    private_temp_root = pathlib.Path(args.private_temp_root).resolve(strict=True)
    for output in [candidate_output, report_path]:
        require(not _path_is_within(output, repo), "Private outputs must remain outside the public repository")
        require(not output.exists(), "Refusing to overwrite a private output")
    require(
        not _path_is_within(report_path, candidate_output),
        "Private report must not be inside the candidate app",
    )
    require(candidate_output.name == "Quareia.app", "Private candidate output must be named Quareia.app")
    _require_owner_private_directory(private_temp_root, "Private temp root")
    manifest_directory = manifest_path.parent.resolve(strict=True)
    require(
        not _path_is_within(private_temp_root, repo)
        and not _paths_overlap(private_temp_root, manifest_directory)
        and not _paths_overlap(private_temp_root, candidate_output)
        and not _paths_overlap(private_temp_root, report_path),
        "Private temp root must be isolated from the repository, manifest, and outputs",
    )
    for parent, label in [
        (candidate_output.parent, "Private candidate parent"),
        (report_path.parent, "Private report parent"),
    ]:
        parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        _require_owner_private_directory(parent, label)
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    require(head == args.source_sha, "Current checkout HEAD does not match reviewed public source SHA")
    manifest = load_and_validate_manifest(
        manifest_path,
        expected_manifest_sha256=args.manifest_sha256,
        expected_source_sha=args.source_sha,
        expected_approval_context=args.approval_context,
    )
    safe_env = _safe_command_environment(environment)

    with tempfile.TemporaryDirectory(
        prefix="quareia-private-",
        dir=private_temp_root,
    ) as temporary_value:
        temporary = pathlib.Path(temporary_value)
        temporary.chmod(0o700)
        command_tmp = temporary / "tmp"
        command_tmp.mkdir(mode=0o700)
        safe_env["TMPDIR"] = str(command_tmp)
        checkout = temporary / "checkout"
        orchestration_log = temporary / "orchestration.log"
        _run_logged(
            ["git", "clone", "--quiet", "--shared", "--no-checkout", str(repo), str(checkout)],
            cwd=repo,
            log=orchestration_log,
            environment=safe_env,
        )
        _run_logged(
            ["git", "checkout", "--quiet", "--detach", args.source_sha],
            cwd=checkout,
            log=orchestration_log,
            environment=safe_env,
        )
        _copy_manifest_inputs(checkout, manifest)
        _run_logged(
            ["node", "ios-app/tools/sync-web-assets.mjs"],
            cwd=checkout,
            log=orchestration_log,
            environment=safe_env,
        )
        _run_logged(
            ["node", "ios-app/tools/sync-web-assets.mjs", "--check"],
            cwd=checkout,
            log=orchestration_log,
            environment=safe_env,
        )

        test_log = temporary / "private-xctest.log"
        result_bundle = temporary / "private-tests.xcresult"
        common_settings = [
            "SWIFT_ACTIVE_COMPILATION_CONDITIONS=PRIVATE_LXXXI_PROVIDER DISTRIBUTION",
            "QUAREIA_BUILD_FLAVOR=private-candidate",
            "QUAREIA_DISPLAY_NAME=Quareia",
        ]
        with _ephemeral_simulator(
            args.simulator_id,
            cwd=checkout,
            log=test_log,
            environment=safe_env,
        ) as ephemeral_simulator:
            _run_logged(
                [
                    "xcodebuild",
                    "-project",
                    "ios-app/Quareia.xcodeproj",
                    "-scheme",
                    "QuareiaPublic",
                    "-configuration",
                    "PublicTesting",
                    "-sdk",
                    "iphonesimulator",
                    "-destination",
                    f"platform=iOS Simulator,id={ephemeral_simulator}",
                    "-derivedDataPath",
                    str(temporary / "derived-simulator"),
                    "-resultBundlePath",
                    str(result_bundle),
                    "-parallel-testing-enabled",
                    "NO",
                    f"-only-testing:{PROVIDER_TEST_IDENTIFIER}",
                    f"-only-testing:{manifest['authenticationTestIdentifier']}",
                    *common_settings,
                    "test",
                ],
                cwd=checkout,
                log=test_log,
                environment=safe_env,
            )
            require(result_bundle.is_dir(), "Private XCTest result bundle is missing")
            evidence = validate_test_evidence(
                test_log.read_text(encoding="utf-8", errors="replace"),
                manifest["authenticationTestIdentifier"],
            )

        device_log = temporary / "private-device-build.log"
        device_derived = temporary / "derived-device"
        _run_logged(
            [
                "xcodebuild",
                "-project",
                "ios-app/Quareia.xcodeproj",
                "-scheme",
                "QuareiaPublic",
                "-configuration",
                "PublicTesting",
                "-sdk",
                "iphoneos",
                "-destination",
                "generic/platform=iOS",
                "-derivedDataPath",
                str(device_derived),
                "CODE_SIGNING_ALLOWED=NO",
                *common_settings,
                "build",
            ],
            cwd=checkout,
            log=device_log,
            environment=safe_env,
        )
        app = device_derived / "Build" / "Products" / "PublicTesting-iphoneos" / "Quareia.app"
        app_report = inspect_private_device_app(
            app,
            manifest,
            source_sha=args.source_sha,
            expected_version=args.expected_version,
            expected_build=args.expected_build,
        )
        with tempfile.TemporaryDirectory(
            prefix=".quareia-private-candidate-", dir=candidate_output.parent
        ) as candidate_stage_value:
            pathlib.Path(candidate_stage_value).chmod(0o700)
            staged_candidate = pathlib.Path(candidate_stage_value) / "Quareia.app"
            shutil.copytree(app, staged_candidate, symlinks=False)
            copied_report = inspect_private_device_app(
                staged_candidate,
                manifest,
                source_sha=args.source_sha,
                expected_version=args.expected_version,
                expected_build=args.expected_build,
            )
            require(
                copied_report["bundleTreeSHA256"] == app_report["bundleTreeSHA256"],
                "Copied private candidate app hash mismatch",
            )
            os.rename(staged_candidate, candidate_output)

    sanitized = {
        "schemaVersion": 1,
        "status": "PRIVATE_PROVIDER_RUNTIME_VERIFIED",
        "candidateStatus": "PRIVATE_CANDIDATE",
        "deviceAcceptance": "DEVICE_ACCEPTANCE_PENDING",
        "releaseComplete": False,
        "uploadPerformed": False,
        "reviewedPublicSourceSHA": args.source_sha,
        "approvedManifestSHA256": args.manifest_sha256,
        "providerRuntimeEvidence": evidence,
        "finalApp": copied_report,
    }
    with report_path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(sanitized, stream, indent=2, sort_keys=True)
        stream.write("\n")
    return sanitized


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status")
    run = commands.add_parser("run")
    run.add_argument("--repo", required=True)
    run.add_argument("--manifest", required=True)
    run.add_argument("--manifest-sha256", required=True)
    run.add_argument("--source-sha", required=True)
    run.add_argument("--approval-context", required=True)
    run.add_argument("--approved-private-context", action="store_true")
    run.add_argument("--simulator-id", required=True)
    run.add_argument("--private-temp-root", required=True)
    run.add_argument("--expected-version", required=True)
    run.add_argument("--expected-build", required=True, type=int)
    run.add_argument("--candidate-app-output", required=True)
    run.add_argument("--report", required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "status":
        print("PRIVATE_BUILD_BLOCKED")
        return 3
    try:
        result = run_private_integration(args)
    except (PrivateIntegrationError, OSError, subprocess.SubprocessError, ValueError) as cause:
        print(f"PRIVATE_BUILD_BLOCKED: {cause}", file=sys.stderr)
        return 3
    print(
        json.dumps(
            {
                "status": result["status"],
                "candidateStatus": result["candidateStatus"],
                "deviceAcceptance": result["deviceAcceptance"],
                "releaseComplete": result["releaseComplete"],
                "recordCount": result["providerRuntimeEvidence"]["recordCount"],
                "finalAppBundleTreeSHA256": result["finalApp"]["bundleTreeSHA256"],
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
