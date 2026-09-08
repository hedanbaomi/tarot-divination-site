#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Default-disabled, local orchestration contract for approved private iOS inputs.

The command never runs for pull-request events and never reads a private
manifest until an explicit local approval-context gate is satisfied. It creates
an ephemeral checkout at one reviewed public SHA, injects only manifest-listed
files, runs the real provider XCTest and format-specific authentication test
(or the explicitly requested full runtime suite), builds an optimized unsigned
device app, and optionally packages its verified bytes as a private IPA.
All Xcode output remains in the ephemeral private
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
CRITICAL_UI_TESTS = [
    "QuareiaUITests/QuareiaUITests/testFreeBoardGesturesHistoryAndDraftRestore",
    "QuareiaUITests/QuareiaUITests/testLoopbackUpdateDownloadCancelAndHandoff",
    "QuareiaUITests/QuareiaUITests/testNativeFilesImportCanBeCancelled",
]
MAX_PRIVATE_INPUT_BYTES = 100 * 1024 * 1024
PRIVATE_NAMES = {".private", "privateinputs", "vaultmaterial", "agent-handoff", "raw-scans", "raw_scans", "rawscans", "plaintext", "decoded"}
KEY_SUFFIXES = {".key", ".pem", ".p12", ".pfx", ".jks", ".keystore", ".mobileprovision", ".env"}
# Existing reviewed public configuration template; never allowed in the app.
PUBLIC_SOURCE_TEMPLATES = {"backend/.env.example"}
PRIVATE_SOURCE_NAMES = {
    "vaultmaterial.kt", "lxxxivault.kt", "privatelxxxiassetprovider.kt",
    "integratedlxxxiprovider.swift", "integratedvaultmaterial.swift",
}
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


def validate_test_evidence(
    log_text: str,
    authentication_test_identifier: str,
    *,
    expected_test_count: int = 2,
) -> dict[str, Any]:
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
        re.search(rf"Executed {expected_test_count} tests?, with 0 failures", log_text) is not None,
        "Private XCTest summary does not prove the required passing test count",
    )
    return {
        "providerTestIdentifier": PROVIDER_TEST_IDENTIFIER,
        "authenticationTestIdentifier": authentication_test_identifier,
        "decodedLogicalKeys": decode_keys,
        "recordCount": len(decode_keys),
        "authenticationNegativePassed": True,
        "actualDecodeEvidence": True,
        "actualProviderRuntimeExecuted": True,
    }


def expected_runtime_tests(checkout: pathlib.Path, authentication_test_identifier: str) -> list[str]:
    """Enumerate the reviewed public XCTest methods; missing/skipped tests fail closed."""
    identifiers = []
    for folder, target in [("Tests", "QuareiaTests"), ("UITests", "QuareiaUITests")]:
        for path in sorted((checkout / "ios-app" / folder).glob("*.swift")):
            source = path.read_text(encoding="utf-8")
            classes = re.findall(r"\bclass\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*XCTestCase\b", source)
            if not classes:
                continue
            require(len(classes) == 1, "Full-runtime discovery requires one XCTestCase class per public source")
            methods = re.findall(r"^\s*(?:@MainActor\s+)?func\s+(test[A-Z][A-Za-z0-9_]*)\s*\(", source, re.MULTILINE)
            identifiers.extend(f"{target}/{classes[0]}/{method}" for method in methods)
    require(PROVIDER_TEST_IDENTIFIER in identifiers, "Full-runtime provider acceptance source is missing")
    require(all(test in identifiers for test in CRITICAL_UI_TESTS), "Full-runtime critical UI source is missing")
    require(authentication_test_identifier not in identifiers, "Authentication test collides with a public XCTest")
    identifiers.append(authentication_test_identifier)
    require(len(identifiers) == len(set(identifiers)), "Duplicate full-runtime test identifier")
    return identifiers


def validate_runtime_group(log_text: str, expected: list[str]) -> dict[str, Any]:
    require(bool(expected), "Full-runtime test group is empty")
    cases = re.findall(
        r"Test Case '-\[([A-Za-z0-9_.]+) (test[A-Za-z0-9_]+)\]' (passed|failed|skipped)\b",
        log_text,
    )
    require(all(status == "passed" for _, _, status in cases), "Full-runtime XCTest failed or skipped")
    observed = [(class_name.split(".")[-1], method) for class_name, method, _ in cases]
    for identifier in expected:
        _, class_name, method = identifier.split("/")
        require(observed.count((class_name, method)) == 1, "Full-runtime XCTest is missing or duplicated")
    require(len(observed) == len(expected), "Full-runtime XCTest count differs from reviewed source")
    require(
        re.search(rf"Executed {len(expected)} tests?, with 0 failures", log_text) is not None,
        "Full-runtime XCTest summary does not prove the expected passing count",
    )
    return {"status": "PASS", "testCount": len(expected), "testIdentifiers": expected}


def simulator_settings(full_runtime: bool) -> list[str]:
    conditions = "PRIVATE_LXXXI_PROVIDER DISTRIBUTION"
    if full_runtime:
        # Public test hooks/loopback services remain available, but DISTRIBUTION
        # always selects IntegratedLxxxiProvider rather than SyntheticPNGProvider.
        conditions += " PUBLIC_TESTING"
    return [
        f"SWIFT_ACTIVE_COMPILATION_CONDITIONS={conditions}",
        "QUAREIA_BUILD_FLAVOR=private-candidate",
        "QUAREIA_DISPLAY_NAME=Quareia",
    ]


def device_settings() -> list[str]:
    return [
        "CODE_SIGNING_ALLOWED=NO",
        "SWIFT_ACTIVE_COMPILATION_CONDITIONS=PRIVATE_LXXXI_PROVIDER DISTRIBUTION",
        "SWIFT_OPTIMIZATION_LEVEL=-O",
        "SWIFT_COMPILATION_MODE=wholemodule",
        "ENABLE_TESTABILITY=NO",
        "ENABLE_DEBUG_DYLIB=NO",
        "QUAREIA_BUILD_FLAVOR=private-candidate",
        "QUAREIA_DISPLAY_NAME=Quareia",
    ]


def bounded_xcode_command(timeout: int, arguments: list[str]) -> list[str]:
    return [sys.executable, "ios-app/tools/run-bounded.py", str(timeout), "xcodebuild", *arguments]


def validate_public_source_tree(listing: str) -> None:
    """Inspect committed path metadata before overlay injection, never private contents."""
    require(bool(listing), "Reviewed public source tree is empty")
    for record in listing.rstrip("\0").split("\0"):
        header, separator, path = record.partition("\t")
        require(bool(separator), "Invalid public Git tree record")
        fields = header.split()
        require(len(fields) == 3 and fields[0] in {"100644", "100755"} and fields[1] == "blob",
                "Public source tree contains a symlink, submodule, or nonregular entry")
        parts = pathlib.PurePosixPath(path).parts
        require(bool(parts) and not path.startswith("/") and "\\" not in path and all(part not in {".", ".."} for part in parts),
                "Public source tree contains an unsafe path")
        name = parts[-1].casefold()
        require(not any(part.casefold() in PRIVATE_NAMES for part in parts), "Public source tree contains a private material path")
        require(name not in PRIVATE_SOURCE_NAMES and not any(part.casefold() == "qv" for part in parts),
                "Public source tree contains a private implementation or encrypted record directory")
        require(path in PUBLIC_SOURCE_TEMPLATES or
                (pathlib.PurePosixPath(path).suffix.casefold() not in KEY_SUFFIXES | {".qv"}
                 and name != ".env" and not name.startswith(".env.")),
                "Public source tree contains a key, environment, or encrypted input sidecar")


def validate_private_runtime_payload(
    files: list[dict[str, Any]],
    directories: list[dict[str, Any]],
    executable: str,
    public_checkout: pathlib.Path,
) -> None:
    """Close the non-www/non-qv bundle surface to reviewed runtime artifacts only."""
    require(re.fullmatch(r"[A-Za-z0-9_-]+", executable) is not None, "Unsafe private app executable name")
    by_path = {entry["path"]: entry for entry in files}
    for entry in files:
        path = entry["path"]
        parts = pathlib.PurePosixPath(path).parts
        name = parts[-1].casefold()
        require(not any(part.casefold() in PRIVATE_NAMES or part.casefold().endswith((".dsym", ".xcarchive")) for part in parts),
                "Private app contains raw, decoded, handoff, or development material")
        require(pathlib.PurePosixPath(path).suffix.casefold() not in KEY_SUFFIXES | {".swift", ".kt", ".java"}
                and name != ".env" and not name.startswith(".env."), "Private app contains a source, key, or environment sidecar")
        if path.startswith(("www/", "PrivateAssets/")):
            # Exact file sets/hashes are validated by the public and private manifests.
            continue
        if path == executable:
            require(entry["isMachO"], "Private app executable is not Mach-O")
            continue
        if path == "Info.plist":
            continue
        if path == "PkgInfo":
            require(entry["_data"] == b"APPL????", "Unexpected application package metadata")
            continue
        if path in {"probe/index.html", "probe/frame.html"}:
            source = public_checkout / "ios-app" / "Quareia" / "Resources" / path
            require(source.is_file() and not source.is_symlink() and sha256_file(source) == entry["sha256"],
                    "Private app probe resource differs from reviewed public source")
            continue
        if re.fullmatch(r"Frameworks/libswift[A-Za-z0-9_]+\.dylib", path):
            require(entry["isMachO"], "Swift runtime library is not Mach-O")
            continue
        framework = re.fullmatch(r"Frameworks/([A-Za-z][A-Za-z0-9_]*)\.framework/([A-Za-z][A-Za-z0-9_.]*)", path)
        if framework:
            bundle, leaf = framework.groups()
            if leaf == bundle:
                require(entry["isMachO"], "Framework executable is not Mach-O")
                continue
            if leaf == "Info.plist":
                metadata = plistlib.loads(entry["_data"])
                binary = by_path.get(f"Frameworks/{bundle}.framework/{bundle}")
                require(type(metadata) is dict and metadata.get("CFBundleExecutable") == bundle
                        and metadata.get("CFBundlePackageType") == "FMWK" and binary and binary["isMachO"],
                        "Framework metadata is not bound to a compiled runtime")
                continue
        raise PrivateIntegrationError("Private app contains an unreviewed nonpublic runtime file")
    allowed_directories = set()
    for path in by_path:
        allowed_directories.update(parent.as_posix() for parent in pathlib.PurePosixPath(path).parents if parent.as_posix() != ".")
    require({entry["path"] for entry in directories} == allowed_directories,
            "Private app contains an unexpected empty or missing runtime directory")


def _load_public_inspector():
    path = pathlib.Path(__file__).with_name("inspect-app.py")
    spec = importlib.util.spec_from_file_location("quareia_public_inspector", path)
    require(spec is not None and spec.loader is not None, "Cannot load public app inspector")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_public_packager():
    path = pathlib.Path(__file__).with_name("package-ipa.py")
    spec = importlib.util.spec_from_file_location("quareia_public_packager", path)
    require(spec is not None and spec.loader is not None, "Cannot load public IPA helpers")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def package_private_candidate(
    app: pathlib.Path,
    output: pathlib.Path,
    inspection: dict[str, Any],
    *,
    source_sha: str,
    manifest_sha256: str,
) -> dict[str, Any]:
    """Archive only freshly inspected private bytes; never relax the synthetic CLI."""
    require(inspection.get("status") == "PRIVATE_CANDIDATE", "Private IPA requires a private candidate inspection")
    require(inspection.get("releaseComplete") is False and inspection.get("platform") == "IOS", "Private IPA is an unsigned device candidate")
    require(inspection.get("reviewedSourceSHA") == source_sha, "Private IPA source binding mismatch")
    require(SHA256_RE.fullmatch(manifest_sha256) is not None, "Private IPA requires an approved manifest hash")
    require(SHA256_RE.fullmatch(inspection.get("bundleTreeSHA256", "")) is not None, "Private IPA has no app tree binding")
    require(not output.exists(), "Refusing to overwrite a private IPA")
    packager = _load_public_packager()
    try:
        files, directories = packager._manifest_maps(inspection)
        tree = hashlib.sha256()
        for path, entry in sorted(files.items()):
            tree.update(f"F\0{path}\0{entry['mode']}\0{entry['bytes']}\0{entry['sha256']}\n".encode())
        for path, entry in sorted(directories.items()):
            tree.update(f"D\0{path}\0{entry['mode']}\n".encode())
        require(tree.hexdigest() == inspection["bundleTreeSHA256"], "Private IPA app tree binding mismatch")
        packager.validate_source_unchanged(app, files, directories)
        with tempfile.TemporaryDirectory(prefix=".quareia-private-ipa-", dir=output.parent) as directory:
            pathlib.Path(directory).chmod(0o700)
            staged = pathlib.Path(directory) / "candidate.ipa"
            packager.write_candidate(staged, app, files, directories)
            staged.chmod(0o600)
            packager.validate_candidate(staged, files, directories)
            packager.validate_source_unchanged(app, files, directories)
            size = staged.stat().st_size
            digest = sha256_file(staged)
            # Exclusive creation prevents overwriting a concurrent output.
            target_created = False
            try:
                with staged.open("rb") as source, output.open("xb") as target:
                    target_created = True
                    output.chmod(0o600)
                    shutil.copyfileobj(source, target)
            except BaseException:
                if target_created:
                    output.unlink(missing_ok=True)
                raise
            try:
                require(output.stat().st_size == size and sha256_file(output) == digest, "Copied private IPA hash mismatch")
                packager.validate_candidate(output, files, directories)
            except BaseException:
                output.unlink(missing_ok=True)
                raise
    except packager.PackageError as cause:
        raise PrivateIntegrationError("Private IPA failed the inspected bundle/ZIP invariants") from cause
    return {
        "filename": output.name,
        "bytes": size,
        "sha256": digest,
        "appBundleTreeSHA256": inspection["bundleTreeSHA256"],
        "reviewedPublicSourceSHA": source_sha,
        "approvedManifestSHA256": manifest_sha256,
        "signed": False,
    }


def validate_macho_deployment_targets(
    machos: list[dict[str, Any]],
    files: list[dict[str, Any]],
    executable: str,
) -> list[dict[str, Any]]:
    """Prove the app and its linked runtimes can load on the declared iOS 16 target."""
    by_path = {entry["path"]: entry for entry in files}
    checked = []
    for macho in machos:
        require(macho.get("architectures") == ["arm64"], "Private device Mach-O must contain only arm64")
        try:
            build = subprocess.check_output(
                ["xcrun", "vtool", "-show-build", str(by_path[macho["path"]]["_absolute"])],
                text=True,
                stderr=subprocess.PIPE,
            )
        except (OSError, subprocess.CalledProcessError) as cause:
            raise PrivateIntegrationError("Cannot verify private Mach-O deployment target") from cause
        # LC_BUILD_VERSION also lists the linker's `version`. Only `minos`
        # describes deployment there; `version` is the minimum solely in the
        # legacy LC_VERSION_MIN_IPHONEOS command.
        commands = re.findall(r"^\s*cmd\s+(LC_[A-Z0-9_]+)\s*$", build, re.MULTILINE)
        require(len(commands) == 1 and commands[0] in {"LC_BUILD_VERSION", "LC_VERSION_MIN_IPHONEOS"},
                "Private Mach-O has missing or ambiguous iOS build commands")
        if commands[0] == "LC_BUILD_VERSION":
            platforms = re.findall(r"^\s*platform\s+(\S+)\s*$", build, re.MULTILINE)
            require(platforms == ["IOS"], "Private Mach-O build platform must be IOS")
            minimum_field = "minos"
        else:
            minimum_field = "version"
        declared = re.findall(r"^\s*" + minimum_field + r"\s+(\d+(?:\.\d+){0,2})\s*$", build, re.MULTILINE)
        require(len(declared) == 1, "Private Mach-O has missing or ambiguous minimum iOS metadata")
        version = tuple(int(part) for part in declared[0].split("."))
        version += (0,) * (3 - len(version))
        require(version <= (16, 0, 0), "Private Mach-O requires a newer iOS than 16.0")
        if macho["path"] == executable:
            require(version == (16, 0, 0), "Private executable minimum iOS must be 16.0")
        checked.append({**macho, "minimumOSVersion": declared[0]})
    require(any(entry["path"] == executable for entry in checked), "Private deployment evidence has no main executable")
    return checked


def inspect_private_device_app(
    app: pathlib.Path,
    manifest: dict[str, Any],
    *,
    source_sha: str,
    expected_version: str,
    expected_build: int,
    public_checkout: pathlib.Path,
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
    require(info.get("MinimumOSVersion") == "16.0", "Private candidate minimum iOS must be 16.0")

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
    validate_private_runtime_payload(files, directories, executable, public_checkout)
    machos = inspector._inspect_machos(files, "IOS", executable)
    machos = validate_macho_deployment_targets(machos, files, executable)
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
        "deploymentTarget": "16.0",
        "architectures": ["arm64"],
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


def sanitized_command_failure(log: pathlib.Path) -> dict[str, Any]:
    """Return only allowlisted categories, Swift basenames/line numbers and test IDs."""
    try:
        with log.open("rb") as stream:
            stream.seek(0, os.SEEK_END)
            stream.seek(max(0, stream.tell() - 2 * 1024 * 1024))
            content = stream.read().decode("utf-8", errors="replace")
    except OSError:
        return {"category": "command-failed"}
    def with_context(value: dict[str, Any]) -> dict[str, Any]:
        phases = {
            "orchestration.log": "prepare",
            "private-xctest.log": "provider",
            "private-native.log": "native",
            "private-critical-ui.log": "critical-ui",
            "private-remaining-ui.log": "remaining-ui",
            "private-device-build.log": "device-build",
        }
        phase = phases.get(log.name)
        if phase is not None:
            value["phase"] = phase
            cases = re.findall(
                r"Test Case '-\[([A-Za-z0-9_.]+) (test[A-Za-z0-9_]+)\]' (started|passed|failed|skipped)\b", content
            )
            if cases:
                progress = {status: sum(case[2] == status for case in cases) for status in ("passed", "failed", "skipped")}
                if all(count <= 10_000 for count in progress.values()):
                    progress["lastTest"] = f"{cases[-1][0].split('.')[-1]}/{cases[-1][1]}"
                    value["progress"] = progress
        return value

    if "COMMAND_TIMEOUT after " in content:
        return with_context({"category": "command-timeout"})
    tests = re.findall(r"Test Case '-\[([A-Za-z0-9_.]+) (test[A-Za-z0-9_]+)\]' failed\b", content)
    if tests:
        result = {"category": "xctest-failed", "tests": sorted({f"{name.split('.')[-1]}/{method}" for name, method in tests})[:10]}
        # Keep only source coordinates, never assertion values or private paths.
        locations = re.findall(r"(?:^|[/\\])([A-Za-z][A-Za-z0-9_]*\.swift):(\d+):(?:\d+:)? error:", content, re.MULTILINE)
        if locations:
            result["errors"] = [
                {"category": "xctest-failed", "file": filename, "line": int(line)}
                for filename, line in sorted(set(locations))[:10]
                if 1 <= int(line) <= 1_000_000
            ]
        return with_context(result)
    errors = re.findall(r"(?:^|[/\\])([A-Za-z][A-Za-z0-9_]*\.swift):(\d+):\d+: error: ([^\n]*)", content, re.MULTILINE)
    if errors:
        findings = []
        for filename, line, message in errors[:10]:
            lowered = message.casefold()
            category = "swift-compile"
            for terms, label in [
                (("no such module",), "swift-module-missing"),
                (("only available", "unavailable"), "swift-availability"),
                (("cannot find",), "swift-symbol-missing"),
                (("cannot convert", "does not conform", "ambiguous", "generic parameter"), "swift-type-check"),
            ]:
                if any(term in lowered for term in terms):
                    category = label
                    break
            findings.append({"category": category, "file": filename, "line": int(line)})
        return with_context({"category": "swift-compile", "errors": findings})
    if "Undefined symbols" in content or "linker command failed" in content:
        return with_context({"category": "link-failed"})
    return with_context({"category": "command-failed"})


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
    if completed.returncode != 0:
        diagnostic = sanitized_command_failure(log)
        if diagnostic.get("phase") == "prepare" and "build-for-testing" in command:
            diagnostic["phase"] = "simulator-build"
        diagnostic["exitCode"] = completed.returncode
        raise PrivateIntegrationError("Private command failed: " + json.dumps(diagnostic, sort_keys=True, separators=(",", ":")))


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
                matches.append((runtime_identifier, device.get("deviceTypeIdentifier"), device.get("isAvailable")))
    require(len(matches) == 1, "Reference simulator is unavailable or ambiguous")
    runtime_identifier, device_type_identifier, available = matches[0]
    require(available is True, "Reference simulator is unavailable")
    require(
        runtime_identifier.startswith("com.apple.CoreSimulator.SimRuntime.iOS-"),
        "Reference simulator is not an iOS runtime",
    )
    require(
        type(device_type_identifier) is str
        and device_type_identifier.startswith(("com.apple.CoreSimulator.SimDeviceType.iPhone-",
                                                "com.apple.CoreSimulator.SimDeviceType.iPad-")),
        "Reference simulator is not an iPhone or iPad device type",
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
    ipa_output = pathlib.Path(args.ipa_output).resolve(strict=False) if getattr(args, "ipa_output", None) else None
    full_runtime = getattr(args, "full_runtime", False)
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
    if ipa_output is not None:
        require(ipa_output.name == f"Quareia-{args.expected_version}-{args.expected_build}.ipa", "Private IPA must use canonical Quareia-<version>-<build>.ipa name")
        require(not ipa_output.exists(), "Refusing to overwrite a private IPA")
        require(all(not _paths_overlap(ipa_output, path) for path in
                    [repo, manifest_directory, private_temp_root, candidate_output, report_path]),
                "Private IPA output must be isolated from inputs, app, report, and temporary root")
        ipa_output.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        _require_owner_private_directory(ipa_output.parent, "Private IPA parent")
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
        validate_public_source_tree(subprocess.check_output(
            ["git", "ls-tree", "-r", "-z", args.source_sha], cwd=checkout, env=safe_env, text=True))
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
        runtime_report = {"status": "NOT_REQUESTED", "mode": "provider-only"}
        with _ephemeral_simulator(
            args.simulator_id,
            cwd=checkout,
            log=test_log,
            environment=safe_env,
        ) as ephemeral_simulator:
            simulator_arguments = [
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
                    "-parallel-testing-enabled",
                    "NO",
                    "ONLY_ACTIVE_ARCH=YES",
                    *simulator_settings(full_runtime),
            ]
            if full_runtime:
                # The approved workflow owns the reviewed fixture's lifecycle.
                # This verifier only contacts the fixed loopback origin.
                _run_logged(["node", "ios-app/tools/verify-fixture.mjs"], cwd=checkout,
                            log=orchestration_log, environment=safe_env)
                expected = expected_runtime_tests(checkout, manifest["authenticationTestIdentifier"])
                native_tests = [test for test in expected if test.startswith("QuareiaTests/")]
                other_ui_tests = [test for test in expected if test.startswith("QuareiaUITests/") and test not in CRITICAL_UI_TESTS]
                _run_logged(bounded_xcode_command(600, [*simulator_arguments, "build-for-testing"]),
                            cwd=checkout, log=orchestration_log, environment=safe_env)
                groups = [
                    ("native", 600, ["-only-testing:QuareiaTests"], native_tests),
                    ("critical-ui", 600, [f"-only-testing:{test}" for test in CRITICAL_UI_TESTS], CRITICAL_UI_TESTS),
                    ("remaining-ui", 1200, ["-only-testing:QuareiaUITests", *[f"-skip-testing:{test}" for test in CRITICAL_UI_TESTS]], other_ui_tests),
                ]
                results = {}
                for name, timeout, selection, group_tests in groups:
                    group_log = temporary / f"private-{name}.log"
                    group_result = temporary / f"private-{name}.xcresult"
                    _run_logged(bounded_xcode_command(timeout, [*simulator_arguments,
                                "-resultBundlePath", str(group_result), *selection, "test-without-building"]),
                                cwd=checkout, log=group_log, environment=safe_env)
                    require(group_result.is_dir(), "Full-runtime XCTest result bundle is missing")
                    content = group_log.read_text(encoding="utf-8", errors="replace")
                    results[name] = validate_runtime_group(content, group_tests)
                    if name == "native":
                        evidence = validate_test_evidence(content, manifest["authenticationTestIdentifier"],
                                                          expected_test_count=len(native_tests))
                runtime_report = {"status": "PASS", "mode": "full", "testCount": len(expected), "groups": results}
            else:
                _run_logged(bounded_xcode_command(600, [*simulator_arguments,
                            "-resultBundlePath", str(result_bundle),
                            f"-only-testing:{PROVIDER_TEST_IDENTIFIER}",
                            f"-only-testing:{manifest['authenticationTestIdentifier']}", "test"]),
                            cwd=checkout, log=test_log, environment=safe_env)
                require(result_bundle.is_dir(), "Private XCTest result bundle is missing")
                evidence = validate_test_evidence(
                    test_log.read_text(encoding="utf-8", errors="replace"),
                    manifest["authenticationTestIdentifier"],
                )

        device_log = temporary / "private-device-build.log"
        device_derived = temporary / "derived-device"
        _run_logged(
            bounded_xcode_command(600, [
                "-project",
                "ios-app/Quareia.xcodeproj",
                "-scheme",
                "QuareiaPublic",
                "-configuration",
                "Release",
                "-sdk",
                "iphoneos",
                "-destination",
                "generic/platform=iOS",
                "-derivedDataPath",
                str(device_derived),
                *device_settings(),
                "build",
            ]),
            cwd=checkout,
            log=device_log,
            environment=safe_env,
        )
        app = device_derived / "Build" / "Products" / "Release-iphoneos" / "Quareia.app"
        app_report = inspect_private_device_app(
            app,
            manifest,
            source_sha=args.source_sha,
            expected_version=args.expected_version,
            expected_build=args.expected_build,
            public_checkout=checkout,
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
                public_checkout=checkout,
            )
            require(
                copied_report["bundleTreeSHA256"] == app_report["bundleTreeSHA256"],
                "Copied private candidate app hash mismatch",
            )
            os.rename(staged_candidate, candidate_output)

        ipa_report = None
        if ipa_output is not None:
            ipa_report = package_private_candidate(candidate_output, ipa_output, copied_report,
                source_sha=args.source_sha, manifest_sha256=args.manifest_sha256)

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
        "runtimeSuite": runtime_report,
        "deviceBuild": {"configuration": "Release", "swiftConditions": ["PRIVATE_LXXXI_PROVIDER", "DISTRIBUTION"],
                        "optimization": "-O", "signed": False},
        "finalApp": copied_report,
    }
    if ipa_report is not None:
        sanitized["ipa"] = ipa_report
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
    run.add_argument("--full-runtime", action="store_true", help="Run all public Swift/UI tests with the real provider and the externally started loopback fixture")
    run.add_argument("--ipa-output", help="Optional owner-private canonical Quareia-<version>-<build>.ipa output")
    run.add_argument("--report", required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "status":
        print("PRIVATE_BUILD_BLOCKED")
        return 3
    try:
        result = run_private_integration(args)
    except Exception as cause:
        # Imported bundle inspectors have their own exception classes. Keep
        # every ordinary gate failure sanitized while preserving failure exit 3.
        if isinstance(cause, PrivateIntegrationError) and str(cause).startswith("Private command failed: "):
            print(f"PRIVATE_BUILD_BLOCKED: {cause}", file=sys.stderr)
        else:
            # The public runner source coordinate identifies the failed gate
            # without exposing private paths, exception values, or source text.
            gate_line = 1
            trace = cause.__traceback__
            while trace is not None:
                code = trace.tb_frame.f_code
                if os.path.abspath(code.co_filename) == os.path.abspath(__file__) and code.co_name != "require":
                    gate_line = trace.tb_lineno
                trace = trace.tb_next
            diagnostic = {"category": "gate-failed", "gateLine": gate_line}
            print("PRIVATE_BUILD_BLOCKED: Private command failed: " +
                  json.dumps(diagnostic, sort_keys=True, separators=(",", ":")), file=sys.stderr)
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
