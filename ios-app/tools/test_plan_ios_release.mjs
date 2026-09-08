// SPDX-License-Identifier: MPL-2.0
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ARTIFACT_BYTES,
  buildDryRunPlan,
  compareSemVer,
  isStrictSemVer,
  validateUpdateManifest,
  validateUpdateTransition,
} from "./plan-ios-release.mjs";

const SOURCE_SHA = "a".repeat(40);

function fixture(root, data = Buffer.from("synthetic ipa")) {
  const ipaPath = path.join(root, "Quareia-1.2.3-42.ipa");
  fs.writeFileSync(ipaPath, data);
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  const packageReport = {
    schemaVersion: 1,
    status: "SYNTHETIC_TEST_PRODUCT",
    releaseComplete: false,
    uploadPerformed: false,
    platform: "IOS",
    version: "1.2.3",
    build: 42,
    reviewedSourceSHA: SOURCE_SHA,
    appBundleTreeSHA256: "b".repeat(64),
    ipa: { filename: "Quareia-1.2.3-42.ipa", bytes: data.length, sha256 },
    inspection: {
      status: "SYNTHETIC_TEST_PRODUCT",
      releaseComplete: false,
      bundleTreeSHA256: "b".repeat(64),
      provenance: { reviewedBuildSourceSHA: SOURCE_SHA },
    },
  };
  return { ipaPath, packageReport, sha256 };
}

function plan(input) {
  return buildDryRunPlan({
    ipaPath: input.ipaPath,
    packageReport: input.packageReport,
    downloadUrl: "https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.2.3/QuareiaDivination-iOS-v1.2.3.ipa",
    tag: "ios-v1.2.3",
    previousManifest: null,
  });
}

test("dry-run plan matches UpdateManifest v1 and can never publish or become latest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-release-plan-"));
  try {
    const input = fixture(root);
    const result = plan(input);
    assert.equal(result.status, "DRY_RUN_ONLY");
    assert.equal(result.publishable, false);
    assert.equal(result.releaseComplete, false);
    assert.equal(result.networkPerformed, false);
    assert.equal(result.uploadPerformed, false);
    assert.equal(result.syntheticTestProduct, true);
    assert.equal(result.release.tagName, "ios-v1.2.3");
    assert.equal(result.release.make_latest, false);
    assert.deepEqual(Object.keys(result.updateManifestPreview).sort(), [
      "build",
      "ipa_url",
      "minimum_ios",
      "platform",
      "schema_version",
      "sha256",
      "size",
      "version",
    ]);
    assert.equal(result.updateManifestPreview.sha256, input.sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI writes one local dry-run plan with an explicit initial-channel baseline", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-release-plan-cli-"));
  try {
    const input = fixture(root);
    const reportPath = path.join(root, "package.json");
    const outputPath = path.join(root, "plan.json");
    fs.writeFileSync(reportPath, JSON.stringify(input.packageReport));
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./plan-ios-release.mjs", import.meta.url)),
        "--ipa",
        input.ipaPath,
        "--package-report",
        reportPath,
        "--download-url",
        "https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.2.3/QuareiaDivination-iOS-v1.2.3.ipa",
        "--tag",
        "ios-v1.2.3",
        "--previous-manifest",
        "INITIAL_CHANNEL",
        "--output",
        outputPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(written.status, "DRY_RUN_ONLY");
    assert.equal(written.release.baseline, "INITIAL_CHANNEL");
    assert.equal(written.release.make_latest, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("strict SemVer rejects leading v, partial versions, and numeric prerelease zero padding", () => {
  assert.equal(isStrictSemVer("1.2.3"), true);
  assert.equal(isStrictSemVer("1.2.3-rc.1+build.9"), true);
  for (const value of ["v1.2.3", "1.2", "01.2.3", "1.2.3-rc.01"]) {
    assert.equal(isStrictSemVer(value), false, value);
  }
  assert.equal(isStrictSemVer(`1.2.3-${"a".repeat(59)}`), false);
  assert.equal(compareSemVer("1.2.3", "1.2.3-rc.9"), 1);
  assert.equal(compareSemVer("1.2.3-rc.10", "1.2.3-rc.2"), 1);
  assert.equal(compareSemVer("1.2.3+build.2", "1.2.3+build.1"), 0);
});

test("manifest rejects unknown, missing, null, HTTP, credentialed, query, and malformed fields", () => {
  const base = {
    schema_version: 1,
    platform: "ios",
    version: "1.2.3",
    build: 42,
    minimum_ios: "16.0",
    ipa_url: "https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.2.3/QuareiaDivination-iOS-v1.2.3.ipa",
    size: 123,
    sha256: "a".repeat(64),
  };
  const bad = [
    { ...base, unknown: true },
    Object.fromEntries(Object.entries(base).filter(([key]) => key !== "build")),
    { ...base, build: null },
    { ...base, minimum_ios: "15.9" },
    { ...base, ipa_url: base.ipa_url.replace("https:", "http:") },
    { ...base, ipa_url: "https://user:pass@github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.2.3/QuareiaDivination-iOS-v1.2.3.ipa" },
    { ...base, ipa_url: `${base.ipa_url}?candidate=1` },
    { ...base, ipa_url: `https://github.com/${"a".repeat(2_049)}` },
    { ...base, sha256: "A".repeat(64) },
    { ...base, size: MAX_ARTIFACT_BYTES + 1 },
  ];
  for (const candidate of bad) assert.throws(() => validateUpdateManifest(candidate));
});

test("local IPA hash and size must match the package report", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-release-plan-"));
  try {
    const hashInput = fixture(root);
    hashInput.packageReport.ipa.sha256 = "0".repeat(64);
    assert.throws(() => plan(hashInput), /hash/);
    const sizeInput = fixture(root);
    sizeInput.packageReport.ipa.bytes += 1;
    assert.throws(() => plan(sizeInput), /size/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("tag and download basename must match the inspected version build and artifact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-release-plan-"));
  try {
    const input = fixture(root);
    assert.throws(
      () => buildDryRunPlan({
        ipaPath: input.ipaPath,
        packageReport: input.packageReport,
        downloadUrl: "https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.2.3/wrong.ipa",
        tag: "ios-v1.2.3",
        previousManifest: null,
      }),
      /canonical versioned GitHub asset path/,
    );
    assert.throws(
      () => buildDryRunPlan({
        ipaPath: input.ipaPath,
        packageReport: input.packageReport,
        downloadUrl: "https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.2.3/QuareiaDivination-iOS-v1.2.3.ipa",
        tag: "v1.2.3",
        previousManifest: null,
      }),
      /tag/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("candidate build is globally monotonic even across display-version bumps", () => {
  const previous = {
    schema_version: 1,
    platform: "ios",
    version: "1.2.3",
    build: 42,
    minimum_ios: "16.0",
    ipa_url: "https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.2.3/QuareiaDivination-iOS-v1.2.3.ipa",
    size: 123,
    sha256: "a".repeat(64),
  };
  const valid = {
    ...previous,
    version: "1.3.0",
    build: 43,
    ipa_url: "https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.3.0/QuareiaDivination-iOS-v1.3.0.ipa",
    sha256: "b".repeat(64),
  };
  assert.doesNotThrow(() => validateUpdateTransition(previous, valid));
  assert.throws(
    () => validateUpdateTransition(previous, { ...valid, build: 42 }),
    /globally greater/,
  );
  assert.throws(
    () => validateUpdateTransition(previous, {
      ...valid,
      version: "1.2.2",
      ipa_url: "https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.2.2/QuareiaDivination-iOS-v1.2.2.ipa",
    }),
    /move forward/,
  );
});

test("a non-synthetic or falsely complete package report is rejected", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-release-plan-"));
  try {
    const real = fixture(root);
    real.packageReport.status = "COMPLETE_PRODUCT";
    assert.throws(() => plan(real), /synthetic/);
    const falseClaim = fixture(root);
    falseClaim.packageReport.releaseComplete = true;
    assert.throws(() => plan(falseClaim), /must not claim/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("release planner source contains no network, child-process, or GitHub mutation capability", () => {
  const source = fs.readFileSync(new URL("./plan-ios-release.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:(?:https|http|net|tls|child_process)/);
  assert.doesNotMatch(source, /\b(?:fetch|execFile|spawn)\s*\(/);
  assert.doesNotMatch(source, /\bgh\s+release\b/);
});
