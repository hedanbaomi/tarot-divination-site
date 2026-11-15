// AI interpretation usage counters: D1-only ingest for the closed `ai_usage`
// event, plus the 90-day retention sweep.
//
// This module is deliberately separate from the Analytics Engine path: an AI
// report is stored exactly once in D1 and never written as a telemetry data
// point. No install hash, locale, app version, question, answer, prompt, API
// key, URL or conversation id reaches this table — only the four scalar usage
// fields and the server timestamp.

import { hasD1Binding } from "./announcements.js";
import { nowSec } from "./clock.js";

export const AI_USAGE_STALE_AFTER_SECONDS = 90 * 24 * 60 * 60; // 90 days

const INSERT_USAGE = `
  INSERT OR IGNORE INTO ai_usage
    (request_id, model_id, platform, usage_kind, total_tokens, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`;

/**
 * Records one completed AI request. Returns "written" for a new request and
 * "duplicate" when the same request_id was already stored (the client retried
 * after a lost 204, or the same request was reported twice).
 *
 * Throws when D1 is missing or the write fails so the caller can return a
 * retryable 503 instead of pretending the report was stored.
 */
export async function recordAiUsage(env, event) {
  if (!hasD1Binding(env)) throw new Error("d1_binding_missing");

  const result = await env.DB.prepare(INSERT_USAGE)
    .bind(
      event.request_id,
      event.model_id,
      event.platform,
      event.usage_kind,
      event.total_tokens === null || event.total_tokens === undefined
        ? null
        : event.total_tokens,
      nowSec()
    )
    .run();

  const changes = result && result.meta ? Number(result.meta.changes) : 0;
  return changes > 0 ? "written" : "duplicate";
}

/**
 * Deletes AI usage rows older than 90 days. Returns the deleted count; a
 * missing D1 binding is a no-op. The scheduled handler calls this
 * independently of the install-state cleanup so one failure cannot suppress
 * the other.
 */
export async function cleanupAiUsage(env) {
  if (!hasD1Binding(env)) return 0;
  const cutoff = nowSec() - AI_USAGE_STALE_AFTER_SECONDS;
  const result = await env.DB.prepare("DELETE FROM ai_usage WHERE created_at < ?")
    .bind(cutoff)
    .run();
  const changes = result && result.meta ? result.meta.changes : 0;
  return typeof changes === "number" ? changes : Number(changes) || 0;
}
