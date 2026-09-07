#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Create and re-open a local-only unsigned synthetic iPhoneOS IPA.

There is intentionally no upload, signing, release, or private-product path in
this tool. The input .app must first pass inspect-app.py for the exact reviewed
source SHA, version, build, platform, and explicit synthetic marker.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from typing import Any


SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MODE_RE = re.compile(r"^[0-7]{4}$")
SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
MAX_IPA_BYTES = 100 * 1024 * 1024
FIXED_ZIP_TIME = (2020, 1, 1, 0, 0, 0)


class PackageError(RuntimeError):
    """The .app or candidate archive failed a packaging invariant."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise PackageError(message)


def path_is_within(path: pathlib.Path, directory: pathlib.Path) -> bool:
    try:
        return os.path.commonpath([str(path), str(directory)]) == str(directory)
    except ValueError:
        return False


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative(value: Any) -> str:
    require(type(value) is str and value, "Bundle manifest path must be a non-empty string")
    require("\\" not in value and not value.startswith("/"), f"Unsafe bundle manifest path: {value}")
    parts = value.split("/")
    require(all(part not in {"", ".", ".."} for part in parts), f"Unsafe bundle manifest path: {value}")
    return value


def run_inspector(
    app: pathlib.Path,
    *,
    source_sha: str,
    expected_version: str,
    expected_build: int,
    synthetic_test_product: bool,
) -> dict[str, Any]:
    inspector = pathlib.Path(__file__).with_name("inspect-app.py")
    command = [
        sys.executable,
        str(inspector),
        str(app),
        "--platform",
        "IOS",
        "--source-sha",
        source_sha,
        "--expected-version",
        expected_version,
        "--expected-build",
        str(expected_build),
    ]
    if synthetic_test_product:
        command.append("--synthetic-test-product")
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    require(
        completed.returncode == 0,
        "App inspection failed before packaging: " + (completed.stderr.strip() or "no error detail"),
    )
    try:
        report = json.loads(completed.stdout)
    except json.JSONDecodeError as cause:
        raise PackageError("Inspector did not return one valid JSON report") from cause
    require(type(report) is dict, "Inspector report must be an object")
    return report


def validate_inspection_report(
    report: dict[str, Any],
    *,
    source_sha: str,
    expected_version: str,
    expected_build: int,
) -> None:
    require(report.get("schemaVersion") == 1, "Unsupported app inspection schema")
    require(report.get("status") == "SYNTHETIC_TEST_PRODUCT", "Only a synthetic test product can be packaged")
    require(report.get("releaseComplete") is False, "Synthetic product must never be release-complete")
    require(report.get("platform") == "IOS", "IPA packaging requires an iPhoneOS app")
    require(report.get("version") == expected_version, "Inspection version mismatch")
    require(report.get("build") == str(expected_build), "Inspection build mismatch")
    provenance = report.get("provenance")
    require(type(provenance) is dict, "Inspection report has no provenance")
    require(provenance.get("reviewedBuildSourceSHA") == source_sha, "Inspection source SHA mismatch")
    require(type(report.get("bundleTreeSHA256")) is str and SHA256_RE.fullmatch(report["bundleTreeSHA256"]), "Invalid bundle tree hash")
    require(type(report.get("bundleBytes")) is int and report["bundleBytes"] > 0, "Invalid bundle byte count")
    require(type(report.get("files")) is list and report["files"], "Inspection report has no files")
    require(type(report.get("directories")) is list, "Inspection report has no directory manifest")


def _manifest_maps(report: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    files: dict[str, dict[str, Any]] = {}
    for entry in report["files"]:
        require(type(entry) is dict, "Invalid file manifest entry")
        require(set(entry) == {"path", "mode", "bytes", "sha256", "isMachO"}, "Unexpected file manifest fields")
        path = safe_relative(entry["path"])
        require(path not in files, f"Duplicate file manifest path: {path}")
        require(type(entry["mode"]) is str and MODE_RE.fullmatch(entry["mode"]), f"Invalid file mode: {path}")
        require(type(entry["bytes"]) is int and entry["bytes"] >= 0, f"Invalid file size: {path}")
        require(type(entry["sha256"]) is str and SHA256_RE.fullmatch(entry["sha256"]), f"Invalid file hash: {path}")
        require(type(entry["isMachO"]) is bool, f"Invalid Mach-O marker: {path}")
        files[path] = entry

    directories: dict[str, dict[str, Any]] = {}
    for entry in report["directories"]:
        require(type(entry) is dict and set(entry) == {"path", "mode"}, "Invalid directory manifest entry")
        path = safe_relative(entry["path"])
        require(path not in directories and path not in files, f"Duplicate manifest path: {path}")
        require(type(entry["mode"]) is str and MODE_RE.fullmatch(entry["mode"]), f"Invalid directory mode: {path}")
        directories[path] = entry
    return files, directories


def validate_source_unchanged(
    app: pathlib.Path,
    files: dict[str, dict[str, Any]],
    directories: dict[str, dict[str, Any]],
) -> None:
    expected_paths = set(files) | set(directories)
    actual_paths: set[str] = set()
    for root, dir_names, file_names in os.walk(app, followlinks=False):
        root_path = pathlib.Path(root)
        for name in dir_names + file_names:
            item = root_path / name
            relative = safe_relative(item.relative_to(app).as_posix())
            require(not item.is_symlink(), f"Source changed after inspection (symlink): {relative}")
            actual_paths.add(relative)
    require(actual_paths == expected_paths, "Source paths changed after inspection")
    for path, expected in files.items():
        item = app / pathlib.PurePosixPath(path)
        try:
            item_stat = item.stat()
        except OSError as cause:
            raise PackageError(f"Cannot stat inspected file {path}: {cause}") from cause
        require(stat.S_ISREG(item_stat.st_mode), f"Inspected file is no longer regular: {path}")
        require(item_stat.st_size == expected["bytes"], f"Source size changed after inspection: {path}")
        require(sha256_file(item) == expected["sha256"], f"Source hash changed after inspection: {path}")
        if os.name != "nt":
            require(stat.S_IMODE(item_stat.st_mode) == int(expected["mode"], 8), f"Source mode changed after inspection: {path}")
    if os.name != "nt":
        for path, expected in directories.items():
            item = app / pathlib.PurePosixPath(path)
            require(stat.S_IMODE(item.stat().st_mode) == int(expected["mode"], 8), f"Directory mode changed after inspection: {path}")


def _zip_info(name: str, *, mode: int, directory: bool) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name + ("/" if directory and not name.endswith("/") else ""), FIXED_ZIP_TIME)
    info.create_system = 3
    kind = stat.S_IFDIR if directory else stat.S_IFREG
    info.external_attr = (kind | mode) << 16
    info.compress_type = zipfile.ZIP_STORED if directory else zipfile.ZIP_DEFLATED
    info.flag_bits |= 0x800
    return info


def write_candidate(
    destination: pathlib.Path,
    app: pathlib.Path,
    files: dict[str, dict[str, Any]],
    directories: dict[str, dict[str, Any]],
) -> None:
    with zipfile.ZipFile(destination, "w", allowZip64=False) as archive:
        archive.writestr(_zip_info("Payload", mode=0o755, directory=True), b"")
        archive.writestr(_zip_info("Payload/Quareia.app", mode=0o755, directory=True), b"")
        for path in sorted(directories):
            archive.writestr(
                _zip_info(
                    f"Payload/Quareia.app/{path}",
                    mode=int(directories[path]["mode"], 8),
                    directory=True,
                ),
                b"",
            )
        for path in sorted(files):
            archive.writestr(
                _zip_info(
                    f"Payload/Quareia.app/{path}",
                    mode=int(files[path]["mode"], 8),
                    directory=False,
                ),
                (app / pathlib.PurePosixPath(path)).read_bytes(),
            )


def validate_candidate(
    candidate: pathlib.Path,
    files: dict[str, dict[str, Any]],
    directories: dict[str, dict[str, Any]],
) -> None:
    require(candidate.stat().st_size > 0, "Candidate IPA is empty")
    require(candidate.stat().st_size <= MAX_IPA_BYTES, "Candidate IPA exceeds the 100 MiB channel limit")
    expected_names = {"Payload/", "Payload/Quareia.app/"}
    expected_names.update(f"Payload/Quareia.app/{path}/" for path in directories)
    expected_names.update(f"Payload/Quareia.app/{path}" for path in files)
    try:
        with zipfile.ZipFile(candidate, "r") as archive:
            require(archive.comment == b"", "Candidate ZIP comment is forbidden")
            infos = archive.infolist()
            names = [info.filename for info in infos]
            require(len(names) == len(set(names)), "Candidate ZIP contains duplicate paths")
            require(set(names) == expected_names, "Candidate ZIP paths do not match inspected app")
            for info in infos:
                require("\\" not in info.filename and not info.filename.startswith("/"), "Unsafe candidate ZIP path")
                parts = info.filename.rstrip("/").split("/")
                require(all(part not in {"", ".", ".."} for part in parts), "Unsafe candidate ZIP path")
                require(info.flag_bits & 0x1 == 0, "Encrypted candidate ZIP entry is forbidden")
                mode = info.external_attr >> 16
                require(not stat.S_ISLNK(mode), "Candidate ZIP symlink entry is forbidden")
                if info.filename in {"Payload/", "Payload/Quareia.app/"}:
                    require(info.is_dir(), "Candidate ZIP root entry must be a directory")
                    continue
                relative = info.filename[len("Payload/Quareia.app/") :].rstrip("/")
                if info.is_dir():
                    require(relative in directories, "Unexpected candidate ZIP directory")
                    require(stat.S_IMODE(mode) == int(directories[relative]["mode"], 8), "Candidate directory mode mismatch")
                else:
                    require(relative in files, "Unexpected candidate ZIP file")
                    expected = files[relative]
                    require(info.file_size == expected["bytes"], f"Candidate file size mismatch: {relative}")
                    data = archive.read(info)
                    require(hashlib.sha256(data).hexdigest() == expected["sha256"], f"Candidate file hash mismatch: {relative}")
                    require(stat.S_IMODE(mode) == int(expected["mode"], 8), f"Candidate file mode mismatch: {relative}")
            require(archive.testzip() is None, "Candidate ZIP CRC verification failed")
    except (OSError, zipfile.BadZipFile, RuntimeError) as cause:
        if isinstance(cause, PackageError):
            raise
        raise PackageError(f"Invalid candidate IPA: {cause}") from cause


def package_ipa(
    app: pathlib.Path,
    output: pathlib.Path,
    package_report_path: pathlib.Path,
    *,
    source_sha: str,
    expected_version: str,
    expected_build: int,
    synthetic_test_product: bool,
) -> dict[str, Any]:
    require(SHA40_RE.fullmatch(source_sha) is not None, "Reviewed source SHA must be 40 lowercase hex")
    require(SEMVER_RE.fullmatch(expected_version) is not None, "Expected version must be strict SemVer")
    require(1 <= expected_build <= 2_147_483_647, "Expected build is out of range")
    require(synthetic_test_product, "Synthetic packaging requires --synthetic-test-product")
    require(output.suffix == ".ipa", "Output must have lowercase .ipa suffix")
    require(
        output.name == f"Quareia-{expected_version}-{expected_build}.ipa",
        "Output must use canonical Quareia-<version>-<build>.ipa name",
    )
    require(package_report_path.suffix == ".json", "Package report must have .json suffix")
    require(not output.exists(), "Refusing to overwrite an existing IPA")
    require(not package_report_path.exists(), "Refusing to overwrite an existing package report")
    app_resolved = app.resolve(strict=True)
    output_resolved = output.resolve(strict=False)
    report_resolved = package_report_path.resolve(strict=False)
    require(
        not path_is_within(output_resolved, app_resolved),
        "Output must not be inside the app bundle",
    )
    require(
        not path_is_within(report_resolved, app_resolved),
        "Package report must not be inside the app bundle",
    )
    require(
        not path_is_within(output_resolved, report_resolved)
        and not path_is_within(report_resolved, output_resolved),
        "IPA output and package report paths must not overlap",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    package_report_path.parent.mkdir(parents=True, exist_ok=True)

    inspection = run_inspector(
        app,
        source_sha=source_sha,
        expected_version=expected_version,
        expected_build=expected_build,
        synthetic_test_product=synthetic_test_product,
    )
    validate_inspection_report(
        inspection,
        source_sha=source_sha,
        expected_version=expected_version,
        expected_build=expected_build,
    )
    files, directories = _manifest_maps(inspection)
    validate_source_unchanged(app, files, directories)

    temporary_handle = tempfile.NamedTemporaryFile(
        prefix=".quareia-candidate-", suffix=".ipa", dir=output.parent, delete=False
    )
    temporary = pathlib.Path(temporary_handle.name)
    temporary_handle.close()
    try:
        write_candidate(temporary, app, files, directories)
        validate_candidate(temporary, files, directories)
        artifact_bytes = temporary.stat().st_size
        artifact_sha = sha256_file(temporary)
        try:
            with temporary.open("rb") as source, output.open("xb") as target:
                shutil.copyfileobj(source, target, length=1024 * 1024)
            require(output.stat().st_size == artifact_bytes, "Published local IPA size mismatch")
            require(sha256_file(output) == artifact_sha, "Published local IPA hash mismatch")
        except BaseException:
            # This path was created by this invocation and has never been
            # exposed as a verified output, so remove a partial copy.
            output.unlink(missing_ok=True)
            raise
    finally:
        temporary.unlink(missing_ok=True)

    package_report = {
        "schemaVersion": 1,
        "status": "SYNTHETIC_TEST_PRODUCT",
        "releaseComplete": False,
        "uploadPerformed": False,
        "platform": "IOS",
        "version": expected_version,
        "build": expected_build,
        "reviewedSourceSHA": source_sha,
        "appBundleTreeSHA256": inspection["bundleTreeSHA256"],
        "ipa": {
            "filename": output.name,
            "bytes": output.stat().st_size,
            "sha256": sha256_file(output),
        },
        "inspection": inspection,
    }
    with package_report_path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(package_report, stream, indent=2, sort_keys=True)
        stream.write("\n")
    return package_report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("app", type=pathlib.Path)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--expected-version", required=True)
    parser.add_argument("--expected-build", type=int, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--package-report", type=pathlib.Path, required=True)
    parser.add_argument("--synthetic-test-product", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = package_ipa(
            args.app,
            args.output,
            args.package_report,
            source_sha=args.source_sha,
            expected_version=args.expected_version,
            expected_build=args.expected_build,
            synthetic_test_product=args.synthetic_test_product,
        )
    except (PackageError, OSError, ValueError) as cause:
        print(f"IPA_PACKAGING_FAILED: {cause}", file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
