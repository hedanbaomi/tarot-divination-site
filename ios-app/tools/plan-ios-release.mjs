#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
/**
 * Produce a local DRY-RUN-ONLY iOS release plan.
 *
 * This module has no network, upload, GitHub mutation, signing, or publishing
 * implementation. Current synthetic package reports always remain
 * non-publishable and incomplete.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function isStrictSemVer(value) {
  if (typeof value !== "string") return false;
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return false;
  if (match[4]) {
    for (const identifier of match[4].split(".")) {
      if (/^[0-9]+$/.test(identifier) && !/^(0|[1-9][0-9]*)$/.test(identifier)) return false;
    }
  }
  return true;
}

function parseSemVer(value) {
  requireCondition(isStrictSemVer(value), "Version must be strict SemVer");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.+)?$/.exec(value);
  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease: match[4] === undefined ? null : match[4].split("."),
  };
}

export function compareSemVer(leftValue, rightValue) {
  const left = parseSemVer(leftValue);
  const right = parseSemVer(rightValue);
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] < right.core[index]) return -1;
    if (left.core[index] > right.core[index]) return 1;
  }
  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === rightPart) continue;
    const leftNumeric = /^[0-9]+$/.test(leftPart);
    const rightNumeric = /^[0-9]+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return BigInt(leftPart) < BigInt(rightPart) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function sha256File(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function readObject(filename, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
  requireCondition(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

export function validateUpdateManifest(manifest) {
  const required = [
    "schema_version",
    "platform",
    "display_version",
    "build",
    "download_url",
    "size_bytes",
    "sha256",
  ];
  requireCondition(
    manifest && typeof manifest === "object" && !Array.isArray(manifest),
    "Update manifest must be an object",
  );
  requireCondition(
    Object.keys(manifest).sort().join("\0") === [...required].sort().join("\0"),
    "Update manifest fields do not exactly match schema",
  );
  requireCondition(manifest.schema_version === 1, "Unsupported update manifest schema");
  requireCondition(manifest.platform === "ios", "Update manifest platform must be ios");
  requireCondition(isStrictSemVer(manifest.display_version), "display_version must be strict SemVer");
  requireCondition(
    Number.isInteger(manifest.build) && manifest.build >= 1 && manifest.build <= 2147483647,
    "build must be a positive 32-bit integer",
  );
  requireCondition(
    Number.isInteger(manifest.size_bytes) &&
      manifest.size_bytes >= 1 &&
      manifest.size_bytes <= MAX_ARTIFACT_BYTES,
    "size_bytes is outside the 100 MiB channel limit",
  );
  requireCondition(typeof manifest.sha256 === "string" && SHA256_RE.test(manifest.sha256), "sha256 must be lowercase 64-hex");
  let url;
  try {
    url = new URL(manifest.download_url);
  } catch {
    throw new Error("download_url must be an absolute URL");
  }
  requireCondition(url.protocol === "https:", "download_url must use HTTPS");
  requireCondition(url.username === "" && url.password === "", "download_url must not contain credentials");
  requireCondition(url.search === "" && url.hash === "", "download_url must not contain query or fragment");
  return url;
}

export function validateUpdateTransition(previous, candidate) {
  validateUpdateManifest(previous);
  validateUpdateManifest(candidate);
  requireCondition(candidate.build > previous.build, "Candidate build must be globally greater than the previous build");
  requireCondition(
    compareSemVer(candidate.display_version, previous.display_version) >= 0,
    "Candidate display version must not move backwards",
  );
}

export function buildDryRunPlan({ ipaPath, packageReport, downloadUrl, tag, previousManifest }) {
  const packageFields = [
    "schemaVersion",
    "status",
    "releaseComplete",
    "uploadPerformed",
    "platform",
    "version",
    "build",
    "reviewedSourceSHA",
    "appBundleTreeSHA256",
    "ipa",
    "inspection",
  ];
  requireCondition(
    Object.keys(packageReport).sort().join("\0") === packageFields.sort().join("\0"),
    "Package report fields do not exactly match schema",
  );
  requireCondition(packageReport.schemaVersion === 1, "Unsupported package report schema");
  requireCondition(packageReport.status === "SYNTHETIC_TEST_PRODUCT", "Current planner only accepts the synthetic test product");
  requireCondition(packageReport.releaseComplete === false, "Synthetic package must not claim release completion");
  requireCondition(packageReport.uploadPerformed === false, "Package report unexpectedly claims an upload");
  requireCondition(packageReport.platform === "IOS", "Package report must describe iPhoneOS output");
  requireCondition(isStrictSemVer(packageReport.version), "Package version must be strict SemVer");
  requireCondition(Number.isInteger(packageReport.build) && packageReport.build >= 1 && packageReport.build <= 2147483647, "Package build is invalid");
  requireCondition(typeof packageReport.reviewedSourceSHA === "string" && SHA40_RE.test(packageReport.reviewedSourceSHA), "Package reviewed source SHA is invalid");
  requireCondition(typeof packageReport.appBundleTreeSHA256 === "string" && SHA256_RE.test(packageReport.appBundleTreeSHA256), "Package app hash is invalid");
  requireCondition(packageReport.ipa && typeof packageReport.ipa === "object" && !Array.isArray(packageReport.ipa), "Package report has no IPA record");
  requireCondition(
    Object.keys(packageReport.ipa).sort().join("\0") === ["filename", "bytes", "sha256"].sort().join("\0"),
    "Package IPA fields do not exactly match schema",
  );
  requireCondition(
    packageReport.inspection &&
      typeof packageReport.inspection === "object" &&
      !Array.isArray(packageReport.inspection) &&
      packageReport.inspection.status === "SYNTHETIC_TEST_PRODUCT" &&
      packageReport.inspection.releaseComplete === false,
    "Embedded app inspection is not synthetic and incomplete",
  );
  requireCondition(
    packageReport.inspection.bundleTreeSHA256 === packageReport.appBundleTreeSHA256,
    "Embedded app inspection hash does not match package report",
  );
  requireCondition(
    packageReport.inspection.provenance &&
      packageReport.inspection.provenance.reviewedBuildSourceSHA === packageReport.reviewedSourceSHA,
    "Embedded app inspection source SHA does not match package report",
  );
  const canonicalName = `Quareia-${packageReport.version}-${packageReport.build}.ipa`;
  requireCondition(packageReport.ipa.filename === canonicalName, "Package report IPA filename is not canonical");
  requireCondition(path.basename(ipaPath) === canonicalName, "Local IPA filename does not match package report");
  const ipaStat = fs.lstatSync(ipaPath);
  requireCondition(ipaStat.isFile() && !ipaStat.isSymbolicLink(), "Local IPA must be a regular non-symlink file");
  const size = ipaStat.size;
  const hash = sha256File(ipaPath);
  requireCondition(size === packageReport.ipa.bytes, "Local IPA size does not match package report");
  requireCondition(hash === packageReport.ipa.sha256, "Local IPA hash does not match package report");
  requireCondition(size >= 1 && size <= MAX_ARTIFACT_BYTES, "Local IPA is outside the 100 MiB channel limit");

  const expectedTag = `ios-v${packageReport.version}-b${packageReport.build}`;
  requireCondition(tag === expectedTag && tag.startsWith("ios-v"), "iOS release tag is not canonical");
  const manifest = {
    schema_version: 1,
    platform: "ios",
    display_version: packageReport.version,
    build: packageReport.build,
    download_url: downloadUrl,
    size_bytes: size,
    sha256: hash,
  };
  const url = validateUpdateManifest(manifest);
  requireCondition(decodeURIComponent(path.posix.basename(url.pathname)) === canonicalName, "download_url basename does not match the IPA filename");
  requireCondition(
    previousManifest === null || (previousManifest && typeof previousManifest === "object"),
    "A previous manifest or explicit INITIAL_CHANNEL baseline is required",
  );
  if (previousManifest !== null) validateUpdateTransition(previousManifest, manifest);

  return {
    schemaVersion: 1,
    status: "DRY_RUN_ONLY",
    publishable: false,
    releaseComplete: false,
    syntheticTestProduct: true,
    networkPerformed: false,
    uploadPerformed: false,
    reviewedSourceSHA: packageReport.reviewedSourceSHA,
    release: {
      tagName: tag,
      make_latest: false,
      artifactFilename: canonicalName,
      baseline:
        previousManifest === null
          ? "INITIAL_CHANNEL"
          : {
              displayVersion: previousManifest.display_version,
              build: previousManifest.build,
              sha256: previousManifest.sha256,
            },
    },
    updateManifestPreview: manifest,
    requiredExternalGates: [
      "APP_STORE_OR_APPROVED_SIGNING_AND_DEVICE_ACCEPTANCE",
      "ACTUAL_PRIVATE_PROVIDER_RUNTIME_82_RECORD_DECODE_EVIDENCE",
      "EXPLICIT_RELEASE_AUTHORIZATION",
    ],
  };
}

function parseArgs(argv) {
  const known = new Set(["--ipa", "--package-report", "--download-url", "--tag", "--previous-manifest", "--output"]);
  requireCondition(argv.length === 12, "Expected exactly six named arguments");
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    requireCondition(known.has(key), `Unknown argument: ${key}`);
    requireCondition(values[key] === undefined, `Duplicate argument: ${key}`);
    requireCondition(argv[index + 1], `Missing value for ${key}`);
    values[key] = argv[index + 1];
  }
  for (const key of known) requireCondition(values[key] !== undefined, `Missing argument: ${key}`);
  return values;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const output = path.resolve(args["--output"]);
    requireCondition(path.extname(output) === ".json", "Output must have .json suffix");
    requireCondition(!fs.existsSync(output), "Refusing to overwrite an existing dry-run plan");
    const report = readObject(path.resolve(args["--package-report"]), "package report");
    const previousManifest =
      args["--previous-manifest"] === "INITIAL_CHANNEL"
        ? null
        : readObject(path.resolve(args["--previous-manifest"]), "previous iOS update manifest");
    const plan = buildDryRunPlan({
      ipaPath: path.resolve(args["--ipa"]),
      packageReport: report,
      downloadUrl: args["--download-url"],
      tag: args["--tag"],
      previousManifest,
    });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`IOS_RELEASE_PLAN_FAILED: ${error.message}\n`);
    return 2;
  }
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
