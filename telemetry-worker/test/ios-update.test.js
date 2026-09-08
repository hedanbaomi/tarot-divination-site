import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";
import { isCanonicalIOSUpdateManifest } from "../src/ios-update.js";

const manifest = {
  schema_version: 1,
  platform: "ios",
  version: "1.0.0",
  build: 1,
  minimum_ios: "16.0",
  ipa_url: "https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.0.0/QuareiaDivination-iOS-v1.0.0.ipa",
  size: 12_345_678,
  sha256: "a".repeat(64)
};

function request() {
  return new Request("https://telemetry.luotianyi.fun/v1/ios-update");
}

test("iOS update endpoint is public and returns the canonical configured manifest", async () => {
  const response = await worker.fetch(request(), {
    IOS_UPDATE_MANIFEST_JSON: JSON.stringify(manifest)
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), manifest);
  assert.match(response.headers.get("cache-control"), /^public/);
});

test("missing manifest configuration is an explicit unavailable 404", async () => {
  const response = await worker.fetch(request(), {});
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "ios_update_unavailable" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("malformed or noncanonical runtime configuration fails closed", async () => {
  const candidates = [
    "{",
    JSON.stringify({ ...manifest, unexpected: true }),
    JSON.stringify({ ...manifest, version: "v1.0.0" }),
    JSON.stringify({ ...manifest, build: 1.5 }),
    JSON.stringify({ ...manifest, minimum_ios: "15.9" }),
    JSON.stringify({ ...manifest, minimum_ios: "16" }),
    JSON.stringify({ ...manifest, ipa_url: "https://example.com/QuareiaDivination-iOS-v1.0.0.ipa" }),
    JSON.stringify({ ...manifest, ipa_url: manifest.ipa_url.replace("https:", "http:") }),
    JSON.stringify({ ...manifest, ipa_url: manifest.ipa_url + "?download=1" }),
    JSON.stringify({ ...manifest, size: 0 }),
    JSON.stringify({ ...manifest, size: 100 * 1024 * 1024 + 1 }),
    JSON.stringify({ ...manifest, sha256: "A".repeat(64) }),
    " ".repeat(16 * 1024 + 1)
  ];

  for (const candidate of candidates) {
    const response = await worker.fetch(request(), { IOS_UPDATE_MANIFEST_JSON: candidate });
    assert.equal(response.status, 503, candidate);
    assert.deepEqual(await response.json(), { error: "ios_update_invalid_configuration" });
  }
});

test("validator accepts only the exact GitHub asset path tied to the version", () => {
  assert.equal(isCanonicalIOSUpdateManifest(manifest), true);
  assert.equal(isCanonicalIOSUpdateManifest({
    ...manifest,
    ipa_url: manifest.ipa_url.replace("ios-v1.0.0", "ios-v1.0.1")
  }), false);
});

test("iOS endpoint is independent from Android release discovery", async () => {
  const response = await worker.fetch(
    new Request("https://telemetry.luotianyi.fun/v1/ios-update", { method: "POST" }),
    { IOS_UPDATE_MANIFEST_JSON: JSON.stringify(manifest) }
  );
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /releases\/latest|android/i);
});
