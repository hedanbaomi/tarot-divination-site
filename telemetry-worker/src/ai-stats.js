// Read-only AI interpretation usage aggregates for the private admin panel.
//
// The caller can only choose a window and a platform from two fixed
// allow-lists; both are bound as SQL parameters, and the SQL text itself is a
// module constant. Nothing here accepts a model name, a column, a table, or any
// other caller-supplied SQL fragment.
//
// Semantics:
//  * `requests` counts AI calls, not people. The table deliberately stores no
//    install hash, so distinct users cannot be derived and are not claimed.
//  * `conversation_rounds` counts conversation-kind requests. A regeneration
//    is a new request and therefore a new round; `compression_requests` is the
//    context-compaction calls, which consume tokens but are never extra rounds.
//  * `total_tokens` sums only reports that carried a provider total, so
//    `known_usage_requests` and `unknown_usage_requests` are reported next to
//    it. `unknown_usage_requests > 0` means the token sum is incomplete, not
//    that those calls used zero tokens.

import { json, securityHeaders } from "./http.js";
import { nowSec } from "./clock.js";
import { hasD1Binding } from "./announcements.js";

export const AI_USAGE_MAX_GROUP_ROWS = 200;

const ADMIN_SECURITY_HEADERS = securityHeaders();

const WINDOW_SECONDS = Object.freeze({
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60
});

export const AI_USAGE_PLATFORMS = Object.freeze(["all", "web", "android"]);

const SUMMARY_SQL = `
  SELECT
    COUNT(*) AS requests,
    COALESCE(SUM(CASE WHEN usage_kind = 'conversation' THEN 1 ELSE 0 END), 0)
      AS conversation_rounds,
    COALESCE(SUM(CASE WHEN usage_kind = 'compression' THEN 1 ELSE 0 END), 0)
      AS compression_requests,
    COALESCE(SUM(CASE WHEN total_tokens IS NULL THEN 0 ELSE total_tokens END), 0)
      AS total_tokens,
    COALESCE(SUM(CASE WHEN total_tokens IS NULL THEN 1 ELSE 0 END), 0)
      AS unknown_usage_requests,
    COALESCE(SUM(CASE WHEN total_tokens IS NULL THEN 0 ELSE 1 END), 0)
      AS known_usage_requests
  FROM ai_usage
  WHERE created_at >= ? AND (? = 'all' OR platform = ?)
`;

const GROUP_SQL = `
  SELECT
    model_id,
    platform,
    COUNT(*) AS requests,
    COALESCE(SUM(CASE WHEN usage_kind = 'conversation' THEN 1 ELSE 0 END), 0)
      AS conversation_rounds,
    COALESCE(SUM(CASE WHEN usage_kind = 'compression' THEN 1 ELSE 0 END), 0)
      AS compression_requests,
    COALESCE(SUM(CASE WHEN total_tokens IS NULL THEN 0 ELSE total_tokens END), 0)
      AS total_tokens,
    COALESCE(SUM(CASE WHEN total_tokens IS NULL THEN 1 ELSE 0 END), 0)
      AS unknown_usage_requests,
    COALESCE(SUM(CASE WHEN total_tokens IS NULL THEN 0 ELSE 1 END), 0)
      AS known_usage_requests
  FROM ai_usage
  WHERE created_at >= ? AND (? = 'all' OR platform = ?)
  GROUP BY model_id, platform
  ORDER BY requests DESC, model_id ASC, platform ASC
  LIMIT ${AI_USAGE_MAX_GROUP_ROWS + 1}
`;

function aiUsageJson(obj, status) {
  return json(obj, status, ADMIN_SECURITY_HEADERS);
}

function nonNegativeInteger(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function usageCounts(row) {
  return {
    requests: nonNegativeInteger(row && row.requests),
    conversation_rounds: nonNegativeInteger(row && row.conversation_rounds),
    compression_requests: nonNegativeInteger(row && row.compression_requests),
    total_tokens: nonNegativeInteger(row && row.total_tokens),
    unknown_usage_requests: nonNegativeInteger(row && row.unknown_usage_requests),
    known_usage_requests: nonNegativeInteger(row && row.known_usage_requests)
  };
}

/** Parses and validates the two query parameters against fixed allow-lists. */
export function parseAiUsageQuery(searchParams) {
  // An absent parameter falls back to the documented default; a present but
  // empty or unknown value is rejected, so `?window=` cannot silently widen
  // the query to the default window.
  const rawWindow = searchParams.get("window");
  const rawPlatform = searchParams.get("platform");
  const window = rawWindow === null ? "24h" : rawWindow;
  const platform = rawPlatform === null ? "all" : rawPlatform;
  if (!Object.prototype.hasOwnProperty.call(WINDOW_SECONDS, window)) {
    return { ok: false, error: "invalid_window", allowed_windows: Object.keys(WINDOW_SECONDS) };
  }
  if (!AI_USAGE_PLATFORMS.includes(platform)) {
    return { ok: false, error: "invalid_platform", allowed_platforms: [...AI_USAGE_PLATFORMS] };
  }
  return { ok: true, window, platform, seconds: WINDOW_SECONDS[window] };
}

/** Handles GET /admin/api/ai-usage after admin authentication. */
export async function handleAiUsage(request, env) {
  if (request.method !== "GET") {
    return aiUsageJson({ error: "method_not_allowed", module: "ai_usage" }, 405);
  }

  const query = parseAiUsageQuery(new URL(request.url).searchParams);
  if (!query.ok) {
    return aiUsageJson({
      error: query.error,
      module: "ai_usage",
      ...(query.allowed_windows ? { allowed_windows: query.allowed_windows } : {}),
      ...(query.allowed_platforms ? { allowed_platforms: query.allowed_platforms } : {})
    }, 400);
  }

  if (!hasD1Binding(env)) {
    // Never answer a database failure with zeroes: an unavailable store is not
    // "no AI requests".
    return aiUsageJson({
      error: "ai_usage_unavailable",
      module: "ai_usage",
      available: false,
      window: query.window,
      platform: query.platform
    }, 503);
  }

  const since = nowSec() - query.seconds;

  try {
    const summaryRow = await env.DB.prepare(SUMMARY_SQL)
      .bind(since, query.platform, query.platform)
      .first();
    const groupRows = await env.DB.prepare(GROUP_SQL)
      .bind(since, query.platform, query.platform)
      .all();
    const results = (groupRows && groupRows.results) || [];
    const truncated = results.length > AI_USAGE_MAX_GROUP_ROWS;
    const models = results.slice(0, AI_USAGE_MAX_GROUP_ROWS).map((row) => ({
      model_id: String(row.model_id),
      platform: String(row.platform),
      ...usageCounts(row)
    }));

    const summary = usageCounts(summaryRow);
    return aiUsageJson({
      module: "ai_usage",
      available: true,
      window: query.window,
      window_seconds: query.seconds,
      platform: query.platform,
      generated_at: nowSec(),
      summary,
      models,
      models_limit: AI_USAGE_MAX_GROUP_ROWS,
      truncated,
      semantics: {
        requests: "AI calls, not distinct people; the table stores no install identifier",
        conversation_rounds: "conversation requests only; a regeneration is a new round",
        compression_requests: "context-compaction requests; they consume tokens but add no round",
        total_tokens: "sum of reported provider totals only",
        unknown_usage_requests: "requests without a provider total; their tokens are unknown, not zero"
      }
    }, 200);
  } catch (_error) {
    return aiUsageJson({
      error: "ai_usage_unavailable",
      module: "ai_usage",
      available: false,
      window: query.window,
      platform: query.platform
    }, 503);
  }
}
