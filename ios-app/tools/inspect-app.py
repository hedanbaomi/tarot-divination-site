#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Fail-closed inspection of an Xcode-built Quareia .app bundle.

This gate deliberately supports only the public synthetic test product. A
private distribution build remains blocked until a separately reviewed runtime
provider and its integration evidence exist.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import plistlib
import re
import stat
import subprocess
import sys
from typing import Any


SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
MACHO_MAGICS = {
    b"\xcf\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
    b"\xca\xfe\xba\xbe",
    b"\xbe\xba\xfe\xca",
    b"\xca\xfe\xba\xbf",
    b"\xbf\xba\xfe\xca",
}
SYNTHETIC_IDENTITIES = {
    "public-prototype": "Quareia Prototype",
    "public-synthetic": "Quareia Test",
}
FROZEN_ANDROID_SOURCE_SHA = "c04e86f19eab2a5240b4109e11f18911fd043274"
FORBIDDEN_SUFFIXES = {
    ".swift",
    ".kt",
    ".key",
    ".pem",
    ".p12",
    ".mobileprovision",
    ".qv",
}
FORBIDDEN_NAMES = {
    ".private",
    "PrivateInputs",
    "VaultMaterial",
    "embedded.mobileprovision",
    "PlugIns",
}
FORBIDDEN_NAME_CASEFOLD = {name.casefold() for name in FORBIDDEN_NAMES}
PUBLIC_RUNTIME_PATH_RE = re.compile(
    r"^(?:LICENSE\.md|index\.html|(?:js|css)/[a-z0-9-]+\.(?:js|css))$"
)
PUBLIC_SOURCE_PATH_RE = re.compile(
    r"^(?:android-demo/app/src/main/assets/www/"
    r"(?:LICENSE\.md|index\.html|(?:js|css)/[a-z0-9-]+\.(?:js|css))|"
    r"ios-app/web/[a-z0-9-]+\.(?:js|css))$"
)


class InspectionError(RuntimeError):
    """The bundle failed a release-relevant inspection invariant."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise InspectionError(message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_posix_permissions(mode: int, path: str, *, directory: bool, macho: bool = False) -> None:
    require(mode & 0o022 == 0, f"Group/world-writable bundle item: {path}")
    if directory:
        require(mode & 0o111 != 0, f"Bundle directory is not searchable: {path}")
    elif macho:
        require(mode & stat.S_IXUSR != 0, f"Mach-O file is not owner-executable: {path}")
    else:
        require(mode & 0o111 == 0, f"Unexpected executable non-Mach-O file: {path}")


def load_json_object(path: pathlib.Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as cause:
        raise InspectionError(f"Invalid {label}: {cause}") from cause
    require(type(value) is dict, f"{label} must be a JSON object")
    return value


def _walk_bundle(root: pathlib.Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return deterministic regular-file and directory manifests without following links."""
    try:
        root_stat = root.lstat()
    except OSError as cause:
        raise InspectionError(f"Cannot stat app bundle: {cause}") from cause
    require(stat.S_ISDIR(root_stat.st_mode), "App bundle must be a directory")
    require(not root.is_symlink(), "App bundle must not be a symlink")
    if os.name != "nt":
        validate_posix_permissions(stat.S_IMODE(root_stat.st_mode), ".", directory=True)

    files: list[dict[str, Any]] = []
    directories: list[dict[str, Any]] = []

    def visit(directory: pathlib.Path) -> None:
        try:
            entries = sorted(os.scandir(directory), key=lambda entry: entry.name)
        except OSError as cause:
            raise InspectionError(f"Cannot enumerate app bundle: {cause}") from cause
        for entry in entries:
            item = pathlib.Path(entry.path)
            relative = item.relative_to(root).as_posix()
            require("\\" not in relative and not relative.startswith("/"), "Unsafe bundle path")
            require(all(part not in {"", ".", ".."} for part in relative.split("/")), "Unsafe bundle path")
            require(entry.name.casefold() not in FORBIDDEN_NAME_CASEFOLD, f"Forbidden public payload path: {relative}")
            require(item.suffix.lower() not in FORBIDDEN_SUFFIXES, f"Forbidden public payload file: {relative}")
            try:
                item_stat = entry.stat(follow_symlinks=False)
            except OSError as cause:
                raise InspectionError(f"Cannot stat bundle item {relative}: {cause}") from cause
            require(not stat.S_ISLNK(item_stat.st_mode), f"Unexpected symlink: {relative}")
            mode = stat.S_IMODE(item_stat.st_mode)
            # Windows reports synthetic POSIX mode bits that do not reflect the
            # ACL. The real packaging gate runs against the Xcode product on
            # macOS, where these permission bits are authoritative.
            if os.name != "nt":
                require(mode & 0o022 == 0, f"Group/world-writable bundle item: {relative}")
            if stat.S_ISDIR(item_stat.st_mode):
                if os.name != "nt":
                    validate_posix_permissions(mode, relative, directory=True)
                directories.append({"path": relative, "mode": f"{mode:04o}"})
                visit(item)
            elif stat.S_ISREG(item_stat.st_mode):
                try:
                    data = item.read_bytes()
                except OSError as cause:
                    raise InspectionError(f"Cannot read bundle file {relative}: {cause}") from cause
                is_macho = data[:4] in MACHO_MAGICS
                if os.name != "nt":
                    validate_posix_permissions(mode, relative, directory=False, macho=is_macho)
                files.append(
                    {
                        "path": relative,
                        "mode": f"{mode:04o}",
                        "bytes": len(data),
                        "sha256": sha256(data),
                        "isMachO": is_macho,
                        "_data": data,
                        "_absolute": item,
                    }
                )
            else:
                raise InspectionError(f"Unexpected non-regular bundle item: {relative}")

    visit(root)
    require(files, "App bundle contains no files")
    return files, directories


def _validate_public_resources(
    root: pathlib.Path,
    files: list[dict[str, Any]],
    expected_source_sha: str,
) -> dict[str, Any]:
    www = root / "www"
    require(www.is_dir() and not www.is_symlink(), "Missing public www resource directory")
    allowlist_path = www / "public-resources.json"
    provenance_path = www / "provenance.json"
    try:
        allowlist = json.loads(allowlist_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as cause:
        raise InspectionError(f"Invalid public resource allowlist: {cause}") from cause
    require(type(allowlist) is list and allowlist, "Public resource allowlist must be a non-empty array")
    require(all(type(item) is str for item in allowlist), "Public resource allowlist paths must be strings")
    require(len(allowlist) == len(set(allowlist)), "Duplicate public resource allowlist path")
    require(all(PUBLIC_RUNTIME_PATH_RE.fullmatch(item) for item in allowlist), "Unsafe public resource allowlist path")

    actual_www = {
        entry["path"][len("www/") :]
        for entry in files
        if entry["path"].startswith("www/")
    }
    expected_www = set(allowlist) | {"public-resources.json", "provenance.json"}
    require(actual_www == expected_www, "Public www payload does not exactly match its output allowlist")

    provenance = load_json_object(provenance_path, "public provenance")
    required_top = {
        "schema",
        "mode",
        "sourceCommit",
        "buildSourceCommit",
        "transformations",
        "files",
    }
    require(set(provenance) == required_top, "Public provenance fields do not match schema")
    require(provenance["schema"] == 2, "Unsupported public provenance schema")
    require(provenance["mode"] == "public-ios-port", "Public provenance mode is not public-ios-port")
    require(
        type(provenance["sourceCommit"]) is str
        and SHA40_RE.fullmatch(provenance["sourceCommit"]) is not None,
        "Invalid frozen Android source SHA",
    )
    require(
        provenance["sourceCommit"] == FROZEN_ANDROID_SOURCE_SHA,
        "Frozen Android source SHA changed unexpectedly",
    )
    require(provenance["buildSourceCommit"] == expected_source_sha, "Build source SHA does not match reviewed SHA")
    require(
        type(provenance["transformations"]) is list,
        "Invalid public provenance transformations",
    )
    entries = provenance["files"]
    require(type(entries) is list, "Public provenance files must be an array")
    require(len(entries) == len(allowlist), "Public provenance file count does not match allowlist")
    require(
        [entry.get("path") if type(entry) is dict else None for entry in entries] == allowlist,
        "Public provenance file order does not match allowlist",
    )
    by_path = {entry["path"]: entry for entry in files}
    seen: set[str] = set()
    for entry in entries:
        require(type(entry) is dict, "Public provenance entry must be an object")
        require(
            set(entry) == {"path", "source", "sourceSha256", "outputSha256"},
            "Public provenance entry fields do not match schema",
        )
        path = entry["path"]
        require(type(path) is str and path in allowlist and path not in seen, "Invalid or duplicate public provenance path")
        seen.add(path)
        require(
            type(entry["source"]) is str
            and PUBLIC_SOURCE_PATH_RE.fullmatch(entry["source"]) is not None,
            "Unsafe public provenance source path",
        )
        source = entry["source"]
        source_matches_output = (
            source.startswith("android-demo/") and source.endswith("/" + path)
        ) or (
            source.startswith("ios-app/web/")
            and path.startswith(("js/", "css/"))
            and source.removeprefix("ios-app/web/") == pathlib.PurePosixPath(path).name
        )
        require(source_matches_output, "Public provenance source/output path mismatch")
        require(
            type(entry["sourceSha256"]) is str
            and SHA256_RE.fullmatch(entry["sourceSha256"]) is not None,
            "Invalid public source hash",
        )
        require(
            type(entry["outputSha256"]) is str
            and SHA256_RE.fullmatch(entry["outputSha256"]) is not None,
            "Invalid public output hash",
        )
        require(
            by_path[f"www/{path}"]["sha256"] == entry["outputSha256"],
            f"Public output hash mismatch: {path}",
        )
    require(seen == set(allowlist), "Public provenance paths do not exactly match allowlist")
    transformation_paths: set[str] = set()
    require(
        [
            transformation.get("path") if type(transformation) is dict else None
            for transformation in provenance["transformations"]
        ]
        == allowlist,
        "Public transformation order does not match allowlist",
    )
    for transformation in provenance["transformations"]:
        require(type(transformation) is dict, "Public transformation must be an object")
        require(set(transformation) == {"path", "steps"}, "Public transformation fields do not match schema")
        path = transformation["path"]
        require(type(path) is str and path in allowlist and path not in transformation_paths, "Invalid or duplicate public transformation path")
        require(
            type(transformation["steps"]) is list
            and all(type(step) is str and step for step in transformation["steps"]),
            "Invalid public transformation steps",
        )
        transformation_paths.add(path)
    require(
        transformation_paths == set(allowlist),
        "Public transformation paths do not exactly match allowlist",
    )
    return {
        "frozenAndroidSourceSHA": provenance["sourceCommit"],
        "reviewedBuildSourceSHA": provenance["buildSourceCommit"],
        "runtimeFiles": len(allowlist),
    }


def _inspect_machos(files: list[dict[str, Any]], platform: str, executable: str) -> list[dict[str, Any]]:
    machos: list[dict[str, Any]] = []
    for entry in files:
        mode = int(entry["mode"], 8)
        if not entry["isMachO"]:
            if os.name != "nt":
                validate_posix_permissions(mode, entry["path"], directory=False, macho=False)
            continue
        if os.name != "nt":
            validate_posix_permissions(mode, entry["path"], directory=False, macho=True)
        try:
            build = subprocess.check_output(
                ["xcrun", "vtool", "-show-build", str(entry["_absolute"])], text=True
            )
            architectures = subprocess.check_output(
                ["lipo", "-archs", str(entry["_absolute"])], text=True
            ).strip()
        except (OSError, subprocess.CalledProcessError) as cause:
            raise InspectionError(f"Cannot inspect Mach-O {entry['path']}: {cause}") from cause
        platforms = [
            line.split()[-1]
            for line in build.splitlines()
            if line.strip().startswith("platform ")
        ]
        require(platforms and set(platforms) == {platform}, f"Incorrect Mach-O platform: {entry['path']}")
        arches = architectures.split()
        if platform == "IOS":
            require(arches == ["arm64"], f"Incorrect device architecture: {entry['path']}")
        else:
            require(
                arches
                and len(arches) == len(set(arches))
                and set(arches).issubset({"arm64", "x86_64"}),
                f"Incorrect simulator architecture: {entry['path']}",
            )
        machos.append(
            {
                "path": entry["path"],
                "architectures": arches,
                "bytes": entry["bytes"],
                "sha256": entry["sha256"],
            }
        )
    require(any(entry["path"] == executable for entry in machos), "Missing Mach-O executable")
    return machos


def _validate_entitlements(app: pathlib.Path, platform: str, files: list[dict[str, Any]]) -> list[str]:
    signature_paths = {
        entry["path"]
        for entry in files
        if entry["path"].startswith("_CodeSignature/")
    }
    try:
        result = subprocess.run(
            ["codesign", "-d", "--entitlements", ":-", str(app)],
            capture_output=True,
            check=False,
        )
    except OSError as cause:
        raise InspectionError(f"Cannot inspect code signature: {cause}") from cause
    entitlement_bytes = result.stdout.strip()
    entitlements: dict[str, Any] = {}
    if entitlement_bytes:
        try:
            value = plistlib.loads(entitlement_bytes)
        except plistlib.InvalidFileException as cause:
            raise InspectionError("Invalid code-signing entitlements") from cause
        require(type(value) is dict, "Code-signing entitlements must be a dictionary")
        entitlements = value
    require(set(entitlements).issubset({"get-task-allow"}), "Unexpected entitlements")
    if platform == "IOS":
        require(result.returncode != 0, "Device test product must be unsigned for external re-signing")
        require(not signature_paths, "Unsigned device test product contains a code signature")
        require(not entitlements, "Unsigned device test product contains entitlements")
    return sorted(entitlements)


def inspect_app(
    app: pathlib.Path,
    *,
    platform: str,
    source_sha: str,
    expected_version: str,
    expected_build: int,
    synthetic_test_product: bool,
) -> dict[str, Any]:
    require(app.name == "Quareia.app", "Expected a Quareia.app bundle")
    require(platform in {"IOS", "IOSSIMULATOR"}, "Unsupported platform")
    require(
        SHA40_RE.fullmatch(source_sha) is not None,
        "Reviewed source SHA must be 40 lowercase hex characters",
    )
    require(SEMVER_RE.fullmatch(expected_version) is not None, "Expected version must be strict SemVer")
    require(
        type(expected_build) is int and 1 <= expected_build <= 2_147_483_647,
        "Expected build is out of range",
    )
    require(
        synthetic_test_product,
        "PRIVATE_BUILD_BLOCKED: only the explicit synthetic test product is inspectable",
    )

    files, directories = _walk_bundle(app)
    file_by_path = {entry["path"]: entry for entry in files}
    require("Info.plist" in file_by_path, "Missing Info.plist")
    try:
        info = plistlib.loads(file_by_path["Info.plist"]["_data"])
    except plistlib.InvalidFileException as cause:
        raise InspectionError("Invalid Info.plist") from cause
    require(type(info) is dict, "Info.plist root must be a dictionary")

    flavor = info.get("QuareiaBuildFlavor")
    require(flavor in SYNTHETIC_IDENTITIES, "Missing explicit synthetic test-product marker")
    require(
        info.get("CFBundleDisplayName") == SYNTHETIC_IDENTITIES[flavor],
        "Synthetic flavor/display name mismatch",
    )
    require(info.get("CFBundleIdentifier") == "com.hedanbaomi.quareia.ios", "Unexpected bundle identifier")
    require(info.get("CFBundlePackageType") == "APPL", "Unexpected bundle package type")
    require(
        info.get("CFBundleShortVersionString") == expected_version,
        "App version does not match expected version",
    )
    require(info.get("CFBundleVersion") == str(expected_build), "App build does not match expected build")
    require(info.get("MinimumOSVersion") == "16.0", "Unexpected minimum iOS version")
    require(sorted(info.get("UIDeviceFamily", [])) == [1, 2], "Unexpected device family")
    require(info.get("LSRequiresIPhoneOS") is True, "App must require iPhoneOS")
    expected_supported = ["iPhoneOS"] if platform == "IOS" else ["iPhoneSimulator"]
    require(
        info.get("CFBundleSupportedPlatforms") == expected_supported,
        "Info.plist platform does not match requested platform",
    )
    expected_sdk = "iphoneos" if platform == "IOS" else "iphonesimulator"
    if "DTPlatformName" in info:
        require(info["DTPlatformName"] == expected_sdk, "DTPlatformName does not match requested platform")
    if "DTSDKName" in info:
        require(
            type(info["DTSDKName"]) is str and info["DTSDKName"].startswith(expected_sdk),
            "DTSDKName does not match requested platform",
        )
    require(
        not info.get("NSAppTransportSecurity", {}).get("NSAllowsArbitraryLoads", False),
        "Arbitrary network loads are forbidden",
    )
    for key in ["UIBackgroundModes", "UIFileSharingEnabled", "LSSupportsOpeningDocumentsInPlace"]:
        require(not info.get(key), f"Unexpected capability: {key}")

    executable = info.get("CFBundleExecutable")
    require(
        type(executable) is str and re.fullmatch(r"[A-Za-z0-9._-]+", executable),
        "Unsafe bundle executable path",
    )
    provenance = _validate_public_resources(app, files, source_sha)
    machos = _inspect_machos(files, platform, executable)
    entitlement_keys = _validate_entitlements(app, platform, files)

    public_files: list[dict[str, Any]] = []
    tree = hashlib.sha256()
    total_bytes = 0
    for entry in files:
        clean = {key: entry[key] for key in ["path", "mode", "bytes", "sha256", "isMachO"]}
        public_files.append(clean)
        total_bytes += entry["bytes"]
        tree.update(
            (
                f"F\0{entry['path']}\0{entry['mode']}\0{entry['bytes']}\0"
                f"{entry['sha256']}\n"
            ).encode("utf-8")
        )
    for entry in directories:
        tree.update(f"D\0{entry['path']}\0{entry['mode']}\n".encode("utf-8"))

    return {
        "schemaVersion": 1,
        "status": "SYNTHETIC_TEST_PRODUCT",
        "releaseComplete": False,
        "flavor": flavor,
        "bundleID": info["CFBundleIdentifier"],
        "version": info["CFBundleShortVersionString"],
        "build": info["CFBundleVersion"],
        "platform": platform,
        "sdk": info.get("DTSDKName"),
        "minimumOS": info["MinimumOSVersion"],
        "bundleBytes": total_bytes,
        "bundleTreeSHA256": tree.hexdigest(),
        "files": public_files,
        "directories": directories,
        "machOBinaries": machos,
        "entitlementKeys": entitlement_keys,
        "provenance": provenance,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("app", type=pathlib.Path)
    parser.add_argument("--platform", choices=["IOS", "IOSSIMULATOR"], required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--expected-version", required=True)
    parser.add_argument("--expected-build", type=int, required=True)
    parser.add_argument(
        "--synthetic-test-product",
        action="store_true",
        help="Acknowledge that this bundle is synthetic test output and is never release-complete.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = inspect_app(
            args.app,
            platform=args.platform,
            source_sha=args.source_sha,
            expected_version=args.expected_version,
            expected_build=args.expected_build,
            synthetic_test_product=args.synthetic_test_product,
        )
    except (InspectionError, KeyError, TypeError, ValueError) as cause:
        print(f"INSPECTION_FAILED: {cause}", file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
