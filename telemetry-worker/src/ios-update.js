import { json, noStoreHeaders } from "./http.js";

const MANIFEST_FIELDS = [
  "schema_version",
  "platform",
  "version",
  "build",
  "minimum_ios",
  "ipa_url",
  "size",
  "sha256"
];
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const MINIMUM_IOS_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function handleIOSUpdate(env) {
  const raw = env?.IOS_UPDATE_MANIFEST_JSON;
  if (typeof raw !== "string" || raw.length === 0) {
    return json({ error: "ios_update_unavailable" }, 404, noStoreHeaders());
  }
  if (new TextEncoder().encode(raw).byteLength > 16 * 1024) {
    return json({ error: "ios_update_invalid_configuration" }, 503, noStoreHeaders());
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (_error) {
    return json({ error: "ios_update_invalid_configuration" }, 503, noStoreHeaders());
  }
  if (!isCanonicalIOSUpdateManifest(manifest)) {
    return json({ error: "ios_update_invalid_configuration" }, 503, noStoreHeaders());
  }

  return json(manifest, 200, {
    "cache-control": "public, max-age=300",
    "x-content-type-options": "nosniff"
  });
}

export function isCanonicalIOSUpdateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
  if (Object.keys(manifest).sort().join("\0") !== [...MANIFEST_FIELDS].sort().join("\0")) return false;
  if (manifest.schema_version !== 1 || manifest.platform !== "ios") return false;
  if (!isStrictSemVer(manifest.version)) return false;
  if (!Number.isInteger(manifest.build) || manifest.build < 1 || manifest.build > 2147483647) return false;
  if (!isSupportedMinimumIOS(manifest.minimum_ios)) return false;
  if (!Number.isInteger(manifest.size) || manifest.size < 1 || manifest.size > MAX_ARTIFACT_BYTES) return false;
  if (typeof manifest.sha256 !== "string" || !SHA256_RE.test(manifest.sha256)) return false;
  return isCanonicalIPAURL(manifest.ipa_url, manifest.version);
}

function isStrictSemVer(value) {
  if (typeof value !== "string" || value.length > 64) return false;
  const match = SEMVER_RE.exec(value);
  if (!match) return false;
  if (match[4]) {
    for (const identifier of match[4].split(".")) {
      if (/^[0-9]+$/.test(identifier) && !/^(0|[1-9][0-9]*)$/.test(identifier)) return false;
    }
  }
  return true;
}

function isSupportedMinimumIOS(value) {
  if (typeof value !== "string") return false;
  const match = MINIMUM_IOS_RE.exec(value);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return Number.isSafeInteger(major) && Number.isSafeInteger(minor) &&
    major >= 16 && major <= 100 && minor <= 99;
}

function isCanonicalIPAURL(value, version) {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port !== "") return false;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return false;
  const expectedPath =
    `/hedanbaomi/tarot-divination-site/releases/download/ios-v${version}/` +
    `QuareiaDivination-iOS-v${version}.ipa`;
  return url.pathname === expectedPath;
}
