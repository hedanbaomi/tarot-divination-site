#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Public harness for the future private-provider integration boundary.

The synthetic subcommands exercise 82 opaque record slots, provenance, key
marker, path, hash, and final-app binding checks without implementing or
guessing the real private format or cryptography. Real mode is intentionally
blocked: JSON supplied by a caller is not accepted as evidence that the actual
provider runtime decoded 82 records inside the final app.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
from typing import Any


RECORD_COUNT = 82
SOURCE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SYNTHETIC_MARKER = "SYNTHETIC_TEST_PRODUCT"
SYNTHETIC_KEY_PATH = "synthetic-key-marker.txt"
SYNTHETIC_KEY_BYTES = b"SYNTHETIC TEST MARKER - NOT A REAL KEY\n"


class GateError(RuntimeError):
    """The public synthetic provider contract failed closed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_path(value: Any) -> str:
    require(type(value) is str and value, "Fixture path must be a non-empty string")
    require("\\" not in value and not value.startswith("/"), f"Unsafe fixture path: {value}")
    require(all(part not in {"", ".", ".."} for part in value.split("/")), f"Unsafe fixture path: {value}")
    return value


def reject_unsupported_mode(mode: int, path: str) -> None:
    require(not stat.S_ISLNK(mode), f"Fixture symlink is forbidden: {path}")
    require(stat.S_ISREG(mode) or stat.S_ISDIR(mode), f"Fixture special file is forbidden: {path}")


def _source_bytes(index: int) -> bytes:
    return f"SYNTHETIC-SOURCE/{index:03d}/NO-REAL-CRYPTO\n".encode("ascii")


def _decoded_bytes(index: int) -> bytes:
    return f"SYNTHETIC-DECODED/{index:03d}/CONTRACT-ONLY\n".encode("ascii")


def create_synthetic_fixture(root: pathlib.Path, source_sha: str) -> dict[str, Any]:
    require(SOURCE_SHA_RE.fullmatch(source_sha) is not None, "Reviewed source SHA must be full lowercase hex")
    require(not root.exists(), "Refusing to overwrite an existing synthetic fixture")
    (root / "sources").mkdir(parents=True)
    (root / "decoded").mkdir()
    (root / SYNTHETIC_KEY_PATH).write_bytes(SYNTHETIC_KEY_BYTES)
    records = []
    for index in range(RECORD_COUNT):
        source_path = f"sources/{index:03d}.synthetic"
        decoded_path = f"decoded/{index:03d}.synthetic"
        source = _source_bytes(index)
        decoded = _decoded_bytes(index)
        (root / pathlib.PurePosixPath(source_path)).write_bytes(source)
        (root / pathlib.PurePosixPath(decoded_path)).write_bytes(decoded)
        records.append(
            {
                "id": f"synthetic-{index:03d}",
                "source": source_path,
                "sourceBytes": len(source),
                "sourceSha256": digest(source),
                "decoded": decoded_path,
                "decodedBytes": len(decoded),
                "decodedSha256": digest(decoded),
            }
        )
    contract = {
        "schemaVersion": 1,
        "productMarker": SYNTHETIC_MARKER,
        "reviewedSourceSHA": source_sha,
        "keyMarker": {
            "path": SYNTHETIC_KEY_PATH,
            "bytes": len(SYNTHETIC_KEY_BYTES),
            "sha256": digest(SYNTHETIC_KEY_BYTES),
        },
        "records": records,
    }
    (root / "contract.json").write_text(
        json.dumps(contract, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    return contract


def _fixture_inventory(root: pathlib.Path) -> set[str]:
    require(root.is_dir() and not root.is_symlink(), "Synthetic fixture must be a real directory")
    inventory: set[str] = set()
    for directory, dir_names, file_names in os.walk(root, followlinks=False):
        base = pathlib.Path(directory)
        for name in dir_names + file_names:
            item = base / name
            relative = safe_path(item.relative_to(root).as_posix())
            item_stat = item.lstat()
            reject_unsupported_mode(item_stat.st_mode, relative)
            inventory.add(relative)
    return inventory


def _load_object(path: pathlib.Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as cause:
        raise GateError(f"Invalid {label}: {cause}") from cause
    require(type(value) is dict, f"{label} must be a JSON object")
    return value


def _verify_file(root: pathlib.Path, path: str, expected_bytes: Any, expected_hash: Any) -> None:
    safe_path(path)
    require(type(expected_bytes) is int and expected_bytes > 0, f"Invalid declared size: {path}")
    require(type(expected_hash) is str and SHA256_RE.fullmatch(expected_hash), f"Invalid declared hash: {path}")
    target = root / pathlib.PurePosixPath(path)
    require(target.is_file() and not target.is_symlink(), f"Missing regular fixture file: {path}")
    data = target.read_bytes()
    require(len(data) == expected_bytes, f"Fixture size mismatch: {path}")
    require(digest(data) == expected_hash, f"Fixture hash mismatch: {path}")


def _app_binding(app_report: dict[str, Any], source_sha: str) -> tuple[str, str]:
    require(app_report.get("status") == SYNTHETIC_MARKER, "App report is not a synthetic test product")
    require(app_report.get("releaseComplete") is False, "Synthetic app report cannot be release-complete")
    reported_source = app_report.get("reviewedSourceSHA")
    app_hash = app_report.get("appBundleTreeSHA256")
    if reported_source is None:
        provenance = app_report.get("provenance")
        require(type(provenance) is dict, "App report has no reviewed source provenance")
        reported_source = provenance.get("reviewedBuildSourceSHA")
        app_hash = app_report.get("bundleTreeSHA256")
    require(reported_source == source_sha, "App report reviewed source SHA mismatch")
    require(type(app_hash) is str and SHA256_RE.fullmatch(app_hash), "App report has no valid final app hash")
    return reported_source, app_hash


def verify_synthetic_fixture(
    root: pathlib.Path,
    app_report_path: pathlib.Path,
    source_sha: str,
) -> dict[str, Any]:
    require(SOURCE_SHA_RE.fullmatch(source_sha) is not None, "Reviewed source SHA must be full lowercase hex")
    contract = _load_object(root / "contract.json", "synthetic provider contract")
    require(
        set(contract) == {"schemaVersion", "productMarker", "reviewedSourceSHA", "keyMarker", "records"},
        "Synthetic provider contract fields do not match schema",
    )
    require(contract["schemaVersion"] == 1, "Unsupported synthetic provider contract schema")
    require(contract["productMarker"] == SYNTHETIC_MARKER, "Missing synthetic product marker")
    require(contract["reviewedSourceSHA"] == source_sha, "Synthetic fixture source SHA mismatch")
    key = contract["keyMarker"]
    require(type(key) is dict and set(key) == {"path", "bytes", "sha256"}, "Invalid synthetic key marker")
    require(key["path"] == SYNTHETIC_KEY_PATH, "Unexpected synthetic key marker path")
    _verify_file(root, key["path"], key["bytes"], key["sha256"])
    require((root / key["path"]).read_bytes() == SYNTHETIC_KEY_BYTES, "Synthetic key marker content mismatch")

    records = contract["records"]
    require(type(records) is list and len(records) == RECORD_COUNT, "Synthetic fixture must contain exactly 82 records")
    expected_paths = {"contract.json", "sources", "decoded", SYNTHETIC_KEY_PATH}
    seen_ids: set[str] = set()
    seen_sources: set[str] = set()
    seen_decoded: set[str] = set()
    for index, record in enumerate(records):
        require(type(record) is dict, "Synthetic record must be an object")
        require(
            set(record)
            == {"id", "source", "sourceBytes", "sourceSha256", "decoded", "decodedBytes", "decodedSha256"},
            "Synthetic record fields do not match schema",
        )
        expected_id = f"synthetic-{index:03d}"
        expected_source = f"sources/{index:03d}.synthetic"
        expected_decoded = f"decoded/{index:03d}.synthetic"
        require(record["id"] == expected_id and record["id"] not in seen_ids, "Invalid synthetic record id")
        require(record["source"] == expected_source and record["source"] not in seen_sources, "Invalid synthetic source path")
        require(record["decoded"] == expected_decoded and record["decoded"] not in seen_decoded, "Invalid synthetic decoded path")
        seen_ids.add(record["id"])
        seen_sources.add(record["source"])
        seen_decoded.add(record["decoded"])
        _verify_file(root, record["source"], record["sourceBytes"], record["sourceSha256"])
        _verify_file(root, record["decoded"], record["decodedBytes"], record["decodedSha256"])
        expected_paths.update({record["source"], record["decoded"]})
    require(_fixture_inventory(root) == expected_paths, "Synthetic fixture contains missing or extra paths")

    app_report = _load_object(app_report_path, "app inspection/package report")
    _, app_hash = _app_binding(app_report, source_sha)
    return {
        "schemaVersion": 1,
        "status": "SYNTHETIC_PROVIDER_CONTRACT_PASS",
        "productMarker": SYNTHETIC_MARKER,
        "recordCount": RECORD_COUNT,
        "reviewedSourceSHA": source_sha,
        "finalAppBundleTreeSHA256": app_hash,
        "actualProviderRuntimeExecuted": False,
        "actualDecodeEvidence": False,
        "privateBuildStatus": "PRIVATE_BUILD_BLOCKED",
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("make-synthetic")
    make.add_argument("--output", type=pathlib.Path, required=True)
    make.add_argument("--source-sha", required=True)
    verify = commands.add_parser("verify-synthetic")
    verify.add_argument("--fixture", type=pathlib.Path, required=True)
    verify.add_argument("--app-report", type=pathlib.Path, required=True)
    verify.add_argument("--source-sha", required=True)
    commands.add_parser(
        "real",
        help="Always blocked until separately approved private runtime integration exists.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "real":
        print(
            "PRIVATE_BUILD_BLOCKED: no approved private provider adapter or actual 82-record runtime decode gate exists",
            file=sys.stderr,
        )
        return 3
    try:
        if args.command == "make-synthetic":
            result = create_synthetic_fixture(args.output, args.source_sha)
            report = {
                "status": "SYNTHETIC_FIXTURE_CREATED",
                "productMarker": SYNTHETIC_MARKER,
                "recordCount": len(result["records"]),
                "privateBuildStatus": "PRIVATE_BUILD_BLOCKED",
            }
        else:
            report = verify_synthetic_fixture(args.fixture, args.app_report, args.source_sha)
    except (GateError, OSError, ValueError) as cause:
        print(f"PRIVATE_INTEGRATION_GATE_FAILED: {cause}", file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
