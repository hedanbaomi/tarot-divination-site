// install_state access: app_active upsert with a 6-hour same-version dedupe,
// active-install statistics windows, version distribution, and the 90-day
// daily cleanup. Nothing here ever sees an IP, User-Agent, or device model.

import { hasD1Binding } from "./announcements.js";
import { nowSec } from "./clock.js";

export const ACTIVE_DEDUPE_SECONDS = 6 * 60 * 60; // 6 hours
export const STALE_AFTER_SECONDS = 90 * 24 * 60 * 60; // 90 days

const SELECT_STATE = "SELECT version_code, last_seen_at FROM install_state WHERE install_hash = ?";

const UPSERT_STATE = `
  INSERT INTO install_state
    (install_hash, app_version, version_code, locale, android_major, first_seen_at, last_seen_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(install_hash) DO UPDATE SET
    app_version = excluded.app_version,
    version_code = excluded.version_code,
    locale = excluded.locale,
    android_major = excluded.android_major,
    last_seen_at = excluded.last_seen_at
`;

/**
 * Records an app_active event. Returns "written" or "deduped". A row with the
 * same version_code seen less than 6 hours ago is not written again (204 fast
 * path); an upgrade to a new version is always written immediately, moving
 * the install into the new version's group while preserving first_seen_at.
 * Throws when the write fails so the caller can return a retryable 503.
 */
export async function recordAppActive(env, event) {
  if (!hasD1Binding(env)) throw new Error("d1_binding_missing");

  const now = nowSec();
  const existing = await env.DB.prepare(SELECT_STATE).bind(event.install_hash).first();

  if (
    existing &&
    existing.version_code === event.version_code &&
    now - existing.last_seen_at < ACTIVE_DEDUPE_SECONDS
  ) {
    return "deduped";
  }

  await env.DB.prepare(UPSERT_STATE)
    .bind(
      event.install_hash,
      event.app_version,
      event.version_code,
      event.locale,
      event.android_major,
      now,
      now
    )
    .run();

  return "written";
}

/** Active installs whose last_seen_at falls inside each window. */
export async function activeWindowCounts(env) {
  const windows = {
    active_24h: 24 * 60 * 60,
    active_7d: 7 * 24 * 60 * 60,
    active_30d: 30 * 24 * 60 * 60
  };
  const now = nowSec();
  const out = {};
  for (const [key, seconds] of Object.entries(windows)) {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM install_state WHERE last_seen_at >= ?"
    ).bind(now - seconds).first();
    out[key] = { seconds, count: row ? row.count : 0 };
  }
  return out;
}

/** Total known installs and per-version groups of the most recently reported version. */
export async function versionDistribution(env) {
  const totalRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM install_state").first();
  const total = totalRow ? totalRow.count : 0;

  const rows = await env.DB.prepare(
    "SELECT version_code, app_version, COUNT(*) AS installs FROM install_state " +
      "GROUP BY version_code, app_version ORDER BY installs DESC, version_code DESC"
  ).all();

  const by_version = rows.results.map((row) => ({
    version_code: row.version_code,
    app_version: row.app_version,
    installs: row.installs,
    percent: total > 0 ? Math.round((row.installs / total) * 1000) / 10 : 0
  }));

  return { total_installs: total, by_version };
}

/** Deletes installs inactive for more than 90 days; returns deleted count. */
export async function cleanupInactiveInstalls(env) {
  if (!hasD1Binding(env)) return 0;
  const cutoff = nowSec() - STALE_AFTER_SECONDS;
  const result = await env.DB.prepare("DELETE FROM install_state WHERE last_seen_at < ?")
    .bind(cutoff)
    .run();
  const changes = result && result.meta ? result.meta.changes : 0;
  return typeof changes === "number" ? changes : Number(changes) || 0;
}
