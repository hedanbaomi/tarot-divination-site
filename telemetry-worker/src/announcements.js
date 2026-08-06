// Public announcements API: GET /v1/announcements.
//
// Returns only announcements that are published, already started, not
// expired, and matching the requested platform and version range. The
// response is a stable JSON schema with a content hash as ETag so an edit
// (revision/updated_at change) or a withdrawal changes the ETag and busts
// any short-lived client/proxy cache. The request never requires an
// install_hash and no per-device state is read or written here.

import { json } from "./http.js";
import { nowSec } from "./clock.js";
import { sha256Hex } from "./security.js";

const PUBLIC_COLUMNS = `
  id, revision, severity, title_zh, body_zh, button_zh, title_en, body_en,
  button_en, action_url, platform, min_version_code, max_version_code,
  starts_at, ends_at, updated_at
`;

const SEVERITY_ORDER = { update: 0, important: 1, info: 2 };
const CACHE_MAX_AGE = 300;

export function hasD1Binding(env) {
  return Boolean(
    env &&
      env.DB &&
      typeof env.DB.prepare === "function"
  );
}

export async function handleAnnouncements(request, env) {
  if (!hasD1Binding(env)) {
    return json({ error: "announcements_unavailable" }, 503);
  }

  const url = new URL(request.url);

  const platform = boundedParam(url.searchParams.get("platform"), 16);
  const requestedPlatform = platform === "" || platform === "all" ? null : platform;
  if (requestedPlatform !== null && !["android", "web"].includes(requestedPlatform)) {
    return json({ error: "invalid_platform" }, 400);
  }

  const versionRaw = url.searchParams.get("version_code");
  let versionCode = 0;
  if (versionRaw !== null && versionRaw !== "") {
    if (!/^\d{1,10}$/.test(versionRaw)) return json({ error: "invalid_version_code" }, 400);
    versionCode = Number(versionRaw);
    if (!Number.isSafeInteger(versionCode) || versionCode < 0) {
      return json({ error: "invalid_version_code" }, 400);
    }
  }

  const locale = boundedParam(url.searchParams.get("locale"), 64) || "en";

  const now = nowSec();
  const rows = await env.DB.prepare(buildSelect(requestedPlatform))
    .bind(...buildBindings(requestedPlatform, now, versionCode))
    .all();

  const announcements = rows.results
    .map((row) => localize(row, locale))
    .sort(compareForDisplay);

  const etag = await contentEtag(announcements);
  const cacheHeaders = {
    "cache-control": `public, max-age=${CACHE_MAX_AGE}`,
    "etag": etag
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }

  return json({ announcements, locale }, 200, cacheHeaders);
}

function buildSelect(platform) {
  const where = platform === null
    ? "WHERE status = 'published' AND starts_at <= ? AND (ends_at = 0 OR ends_at >= ?) AND min_version_code <= ? AND max_version_code >= ?"
    : "WHERE status = 'published' AND starts_at <= ? AND (ends_at = 0 OR ends_at >= ?) AND (platform = ? OR platform = 'all') AND min_version_code <= ? AND max_version_code >= ?";
  return `SELECT ${PUBLIC_COLUMNS} FROM announcements ${where}`;
}

function buildBindings(platform, now, versionCode) {
  if (platform === null) return [now, now, versionCode, versionCode];
  return [now, now, platform, versionCode, versionCode];
}

function boundedParam(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

/** Resolves one localized announcement; per-field fallback to the other language. */
export function localize(row, locale) {
  const isZh = locale.toLowerCase().startsWith("zh");
  const pick = (zh, en) => {
    const primary = isZh ? zh : en;
    const fallback = isZh ? en : zh;
    return primary && primary.length > 0 ? primary : fallback || "";
  };
  return {
    id: row.id,
    revision: row.revision,
    severity: row.severity,
    title: pick(row.title_zh, row.title_en),
    body: pick(row.body_zh, row.body_en),
    button: pick(row.button_zh, row.button_en),
    action_url: row.action_url,
    platform: row.platform,
    min_version_code: row.min_version_code,
    max_version_code: row.max_version_code,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    updated_at: row.updated_at
  };
}

function compareForDisplay(a, b) {
  const bySeverity =
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.starts_at !== b.starts_at) return b.starts_at - a.starts_at;
  return b.id - a.id;
}

async function contentEtag(announcements) {
  const fingerprint = announcements.map((a) => [a.id, a.revision, a.updated_at]);
  const digest = await sha256Hex(JSON.stringify(fingerprint));
  return `"${digest}"`;
}
