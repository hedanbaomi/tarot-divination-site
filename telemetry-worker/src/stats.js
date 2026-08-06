// install_state access: app_active upsert with a 6-hour same-version dedupe,
// active-install statistics windows, version distribution, and the 90-day
// daily cleanup. Nothing here ever sees an IP, User-Agent, or device model.

import { hasD1Binding } from "./announcements.js";
import { nowSec } from "./clock.js";

export const ACTIVE_DEDUPE_SECONDS = 6 * 60 * 60; // 6 hours
export const STALE_AFTER_SECONDS = 90 * 24 * 60 * 60; // 90 days

const SELECT_STATE =
  "SELECT app_version, version_code, last_seen_at FROM install_state WHERE install_hash = ?";

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
 * Records an install-activity event (app_active or legacy daily_active) in
 * install_state. Returns "written" or "deduped".
 *
 *  - app_active carries the real version_code and always wins: it overwrites
 *    a legacy row's app_version/version_code, moving the install into the new
 *    version group while preserving first_seen_at. Dedupe applies only to the
 *    same version_code within 6 hours.
 *  - legacy daily_active (no version_code, stored as 0) never downgrades a
 *    row that already has a real version_code: it only refreshes locale,
 *    android_major and last_seen_at, respecting the 6-hour rule.
 *  - between two legacy rows the 6-hour dedupe also compares app_version, so
 *    a v1.0 -> v1.1 upgrade migrates immediately even inside the window.
 *  - Throws when the write fails so the caller can return a retryable 503.
 */
export async function recordInstallActivity(env, event) {
  if (!hasD1Binding(env)) throw new Error("d1_binding_missing");

  const now = nowSec();
  const incomingCode = Number.isInteger(event.version_code) ? event.version_code : 0;
  const isAppActive = incomingCode > 0;
  const existing = await env.DB.prepare(SELECT_STATE).bind(event.install_hash).first();

  if (!existing) {
    await env.DB.prepare(UPSERT_STATE)
      .bind(event.install_hash, event.app_version, incomingCode, event.locale,
        event.android_major, now, now)
      .run();
    return "written";
  }

  if (isAppActive) {
    if (
      existing.version_code === incomingCode &&
      now - existing.last_seen_at < ACTIVE_DEDUPE_SECONDS
    ) {
      return "deduped";
    }
    await env.DB.prepare(UPSERT_STATE)
      .bind(event.install_hash, event.app_version, incomingCode, event.locale,
        event.android_major, now, now)
      .run();
    return "written";
  }

  // Legacy daily_active hitting an install already recorded by a newer client:
  // never downgrade app_version/version_code; only refresh time fields.
  if (existing.version_code > 0) {
    if (now - existing.last_seen_at < ACTIVE_DEDUPE_SECONDS) return "deduped";
    await env.DB.prepare(
      "UPDATE install_state SET locale = ?, android_major = ?, last_seen_at = ? WHERE install_hash = ?"
    ).bind(event.locale, event.android_major, now, event.install_hash).run();
    return "written";
  }

  // Both rows are legacy: dedupe only when the app_version is identical too,
  // so a legacy upgrade migrates immediately.
  if (
    existing.app_version === event.app_version &&
    now - existing.last_seen_at < ACTIVE_DEDUPE_SECONDS
  ) {
    return "deduped";
  }
  await env.DB.prepare(UPSERT_STATE)
    .bind(event.install_hash, event.app_version, 0, event.locale,
      event.android_major, now, now)
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

/**
 * Per-window version distribution. Each window counts only installs whose
 * last_seen_at falls inside that window, and each distribution's percentages
 * use that window's active total as the denominator. known_installs_90d is
 * the total install records seen in the last 90 days (the daily cleanup
 * removes older rows) — it is deliberately not called an active-version
 * count.
 */
export async function versionDistribution(env) {
  const windows = {
    active_24h: 24 * 60 * 60,
    active_7d: 7 * 24 * 60 * 60,
    active_30d: 30 * 24 * 60 * 60
  };
  const now = nowSec();

  const by_window = {};
  for (const [key, seconds] of Object.entries(windows)) {
    const rows = await env.DB.prepare(
      "SELECT version_code, app_version, COUNT(*) AS installs FROM install_state " +
        "WHERE last_seen_at >= ? GROUP BY version_code, app_version " +
        "ORDER BY installs DESC, version_code DESC"
    ).bind(now - seconds).all();
    const total = rows.results.reduce((sum, row) => sum + row.installs, 0);
    by_window[key] = rows.results.map((row) => ({
      version_code: row.version_code,
      app_version: row.app_version,
      installs: row.installs,
      percent: total > 0 ? Math.round((row.installs / total) * 1000) / 10 : 0
    }));
  }

  const knownRow = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM install_state WHERE last_seen_at >= ?"
  ).bind(now - 90 * 24 * 60 * 60).first();

  return {
    known_installs_90d: knownRow ? knownRow.count : 0,
    by_window
  };
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
