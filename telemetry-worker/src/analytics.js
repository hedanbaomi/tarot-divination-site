// Read-only historical Analytics Engine queries for the private admin panel.
// This module deliberately has no D1 dependency and never exposes the
// sampling key or any raw upstream row. Every query is selected from the
// fixed templates below; the window is the only caller-controlled input.

import { json, securityHeaders } from "./http.js";
import { nowSec } from "./clock.js";

export const ANALYTICS_DATASET = "quareia_telemetry";
export const ANALYTICS_QUERY_TIMEOUT_MS = 8_000;
export const ANALYTICS_QUERY_CONCURRENCY = 3;
export const ANALYTICS_MAX_RESPONSE_BYTES = 256 * 1024;
export const ANALYTICS_MAX_RESULT_ROWS = 100;
export const ANALYTICS_MAX_DISTRIBUTION_ROWS = 50;
export const ANALYTICS_MAX_DAILY_TREND_ROWS = 31;

const ADMIN_SECURITY_HEADERS = securityHeaders();

const EVENT_TYPES = Object.freeze([
  "install_seen",
  "daily_active",
  "app_active",
  "reading_completed"
]);

const WINDOW_SPECS = Object.freeze({
  "24h": Object.freeze({ interval: "INTERVAL '24' HOUR", seconds: 24 * 60 * 60 }),
  "7d": Object.freeze({ interval: "INTERVAL '7' DAY", seconds: 7 * 24 * 60 * 60 }),
  "30d": Object.freeze({ interval: "INTERVAL '30' DAY", seconds: 30 * 24 * 60 * 60 })
});

const DIMENSION_SPECS = Object.freeze({
  deck_type: Object.freeze({
    alias: "deck_type",
    field: "blob3",
    filter: "blob1 = 'reading_completed'",
    basis: "reading_completed",
    semantics: "weighted reading_completed events"
  }),
  app_version: Object.freeze({
    alias: "app_version",
    field: "blob7",
    filter: "blob1 = 'install_seen'",
    basis: "first_report_snapshot",
    semantics: "weighted install_seen first-report snapshot; not current state"
  }),
  locale: Object.freeze({
    alias: "locale",
    field: "blob8",
    filter: "blob1 = 'install_seen'",
    basis: "first_report_snapshot",
    semantics: "weighted install_seen first-report snapshot; not current state"
  }),
  country: Object.freeze({
    alias: "country",
    field: "blob4",
    filter: "blob1 = 'install_seen'",
    basis: "first_report_snapshot",
    semantics: "weighted install_seen first-report snapshot; not current state"
  }),
  subdivision: Object.freeze({
    alias: "subdivision",
    field: "blob5",
    filter: "blob1 = 'install_seen'",
    basis: "first_report_snapshot",
    semantics: "weighted install_seen first-report snapshot; not current state"
  })
});

const QUERY_NAMES = Object.freeze([
  "event_totals",
  "active_estimate",
  "reading_metrics",
  "deck_type",
  "app_version",
  "locale",
  "country",
  "subdivision",
  "daily_trend"
]);

function timeFilter(interval) {
  return `timestamp >= NOW() - ${interval}`;
}

function queryTemplates(interval) {
  const filter = timeFilter(interval);
  const eventFilter = "blob1 IN ('install_seen', 'daily_active', 'app_active', 'reading_completed')";

  return {
    event_totals: `
SELECT blob1 AS event, SUM(_sample_interval) AS count
FROM ${ANALYTICS_DATASET}
WHERE ${filter} AND ${eventFilter}
GROUP BY event
ORDER BY event
LIMIT 8
`,
    active_estimate: `
SELECT COUNT(DISTINCT index1) AS active_estimate
FROM ${ANALYTICS_DATASET}
WHERE ${filter} AND blob1 IN ('daily_active', 'app_active')
LIMIT 1
`,
    reading_metrics: `
SELECT
  SUM(_sample_interval) AS reading_completed,
  IF(
    SUM(_sample_interval) > 0,
    SUM(_sample_interval * double1) / SUM(_sample_interval),
    0
  ) AS avg_card_count
FROM ${ANALYTICS_DATASET}
WHERE ${filter} AND blob1 = 'reading_completed'
LIMIT 1
`,
    deck_type: dimensionQuery(DIMENSION_SPECS.deck_type, filter),
    app_version: dimensionQuery(DIMENSION_SPECS.app_version, filter),
    locale: dimensionQuery(DIMENSION_SPECS.locale, filter),
    country: dimensionQuery(DIMENSION_SPECS.country, filter),
    subdivision: dimensionQuery(DIMENSION_SPECS.subdivision, filter),
    daily_trend: `
SELECT intDiv(toUInt32(timestamp), 86400) AS utc_day, SUM(_sample_interval) AS count
FROM ${ANALYTICS_DATASET}
WHERE ${filter} AND ${eventFilter}
GROUP BY utc_day
ORDER BY utc_day ASC
LIMIT ${ANALYTICS_MAX_DAILY_TREND_ROWS + 1}
`
  };
}

function dimensionQuery(spec, filter) {
  return `
SELECT ${spec.field} AS value, SUM(_sample_interval) AS count
FROM ${ANALYTICS_DATASET}
WHERE ${filter} AND ${spec.filter} AND ${spec.field} <> ''
GROUP BY value
ORDER BY count DESC, value ASC
LIMIT ${ANALYTICS_MAX_DISTRIBUTION_ROWS + 1}
`;
}

/**
 * Exposes only the fixed query set for deterministic tests and audits. An
 * invalid window returns null; no caller can supply SQL, a field, or a table.
 */
export function buildAnalyticsQueries(window) {
  const spec = WINDOW_SPECS[window];
  return spec ? queryTemplates(spec.interval) : null;
}

function analyticsJson(obj, status) {
  return json(obj, status, ADMIN_SECURITY_HEADERS);
}

function hasAnalyticsConfig(env) {
  return Boolean(
    env &&
      typeof env.ACCOUNT_ID === "string" &&
      env.ACCOUNT_ID.length > 0 &&
      typeof env.ANALYTICS_READ_TOKEN === "string" &&
      env.ANALYTICS_READ_TOKEN.length > 0
  );
}

function analyticsApiUrl(env) {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.ACCOUNT_ID)}/analytics_engine/sql`;
}

/** Handles GET /admin/api/analytics?window=24h|7d|30d after admin auth. */
export async function handleAnalytics(request, env) {
  if (request.method !== "GET") {
    return analyticsJson({ error: "method_not_allowed", module: "analytics" }, 405);
  }

  const window = new URL(request.url).searchParams.get("window");
  const windowSpec = WINDOW_SPECS[window];
  if (!windowSpec) {
    return analyticsJson({
      error: "invalid_window",
      module: "analytics",
      allowed_windows: Object.keys(WINDOW_SPECS)
    }, 400);
  }

  if (!hasAnalyticsConfig(env)) {
    return unavailableResponse(window, [], "missing_config");
  }

  const queries = queryTemplates(windowSpec.interval);
  const jobs = QUERY_NAMES.map((name) => ({
    name,
    sql: queries[name],
    maxRows: maxRowsFor(name)
  }));
  const outcomes = await runQueries(jobs, env);
  const parsed = parseOutcomes(outcomes, window);

  const response = buildAnalyticsResponse(window, parsed);
  if (parsed.failedSections.length > 0) {
    return analyticsJson({
      ...response,
      error: "analytics_unavailable",
      failed_sections: parsed.failedSections
    }, 503);
  }
  return analyticsJson(response, 200);
}

function maxRowsFor(name) {
  if (name === "deck_type" || name === "app_version" || name === "locale" ||
      name === "country" || name === "subdivision") {
    return ANALYTICS_MAX_DISTRIBUTION_ROWS + 1;
  }
  if (name === "daily_trend") return ANALYTICS_MAX_DAILY_TREND_ROWS + 1;
  return Math.min(ANALYTICS_MAX_RESULT_ROWS, 8);
}

async function runQueries(jobs, env) {
  const outcomes = new Array(jobs.length);
  let next = 0;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(
    () => deadlineController.abort(),
    ANALYTICS_QUERY_TIMEOUT_MS
  );

  async function runWorker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= jobs.length) return;
      const job = jobs[index];
      if (deadlineController.signal.aborted) {
        outcomes[index] = { name: job.name, error: "upstream_timeout" };
        continue;
      }
      try {
        outcomes[index] = {
          name: job.name,
          rows: await executeQuery(job.sql, job.maxRows, env, deadlineController.signal)
        };
      } catch (error) {
        outcomes[index] = {
          name: job.name,
          error: safeFailureCode(error)
        };
      }
    }
  }

  try {
    const workers = Math.min(ANALYTICS_QUERY_CONCURRENCY, jobs.length);
    await Promise.all(Array.from({ length: workers }, () => runWorker()));
    return outcomes;
  } finally {
    clearTimeout(deadlineTimer);
  }
}

async function executeQuery(sql, maxRows, env, parentSignal) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), ANALYTICS_QUERY_TIMEOUT_MS);
  try {
    const response = await fetchWithAbort(analyticsApiUrl(env), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.ANALYTICS_READ_TOKEN}`,
        "content-type": "text/plain; charset=utf-8",
        Accept: "application/json"
      },
      body: sql,
      signal: controller.signal
    });

    const status = response && Number(response.status);
    if (!Number.isInteger(status) || status < 200 || status > 299) {
      throw new AnalyticsQueryError("upstream_http_error");
    }

    const contentLength = response.headers && response.headers.get
      ? Number(response.headers.get("content-length") || 0)
      : 0;
    if (Number.isFinite(contentLength) && contentLength > ANALYTICS_MAX_RESPONSE_BYTES) {
      throw new AnalyticsQueryError("upstream_body_too_large");
    }
    if (!response || typeof response.text !== "function") {
      throw new AnalyticsQueryError("upstream_invalid_response");
    }

    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > ANALYTICS_MAX_RESPONSE_BYTES) {
      throw new AnalyticsQueryError("upstream_body_too_large");
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (_error) {
      throw new AnalyticsQueryError("upstream_invalid_json");
    }
    if (!payload || payload.success === false) {
      throw new AnalyticsQueryError("upstream_query_error");
    }

    const rows = extractRows(payload);
    if (rows.length > maxRows || rows.length > ANALYTICS_MAX_RESULT_ROWS) {
      throw new AnalyticsQueryError("upstream_rows_too_large");
    }
    return rows;
  } catch (error) {
    if (error instanceof AnalyticsQueryError) throw error;
    if (controller.signal.aborted || (error && error.name === "AbortError")) {
      throw new AnalyticsQueryError("upstream_timeout");
    }
    throw new AnalyticsQueryError("upstream_error");
  } finally {
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener("abort", abortFromParent);
  }
}

async function fetchWithAbort(url, init) {
  const signal = init.signal;
  if (!signal) return fetch(url, init);
  if (signal.aborted) throw abortError();

  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // Promise.race keeps a rejection handler attached to an implementation
    // that ignores AbortSignal, so a timed-out mock or platform fetch cannot
    // leave an unhandled rejection behind.
    return await Promise.race([fetch(url, init), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

class AnalyticsQueryError extends Error {
  constructor(code) {
    super(code);
    this.name = "AnalyticsQueryError";
    this.code = code;
  }
}

function safeFailureCode(error) {
  return error instanceof AnalyticsQueryError && typeof error.code === "string"
    ? error.code
    : "upstream_error";
}

function extractRows(payload) {
  if (payload.result && Array.isArray(payload.result.data)) return payload.result.data;
  if (Array.isArray(payload.data)) return payload.data;
  throw new AnalyticsQueryError("upstream_invalid_rows");
}

function parseOutcomes(outcomes, window) {
  const byName = new Map();
  const failedSections = [];
  for (const outcome of outcomes) {
    if (!outcome || outcome.error) {
      failedSections.push(outcome && outcome.name ? outcome.name : "unknown");
    } else {
      byName.set(outcome.name, outcome.rows);
    }
  }

  const parsed = {
    window,
    failedSections,
    eventTotals: parseEventTotals(byName, "event_totals", failedSections),
    activeEstimate: parseActiveEstimate(byName, "active_estimate", failedSections),
    readingMetrics: parseReadingMetrics(byName, "reading_metrics", failedSections),
    distributions: {},
    dailyTrend: parseDailyTrend(byName, "daily_trend", failedSections)
  };

  for (const name of Object.keys(DIMENSION_SPECS)) {
    parsed.distributions[name] = parseDimension(
      byName,
      name,
      failedSections
    );
  }
  return parsed;
}

function parseEventTotals(byName, name, failures) {
  if (!byName.has(name)) return null;
  const rows = byName.get(name);
  if (!Array.isArray(rows)) {
    failures.push(name);
    return null;
  }
  const totals = Object.fromEntries(EVENT_TYPES.map((event) => [event, 0]));
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      failures.push(name);
      return null;
    }
    const event = row.event;
    if (!EVENT_TYPES.includes(event)) continue;
    const count = nonNegativeNumber(row.count);
    if (count === null) {
      failures.push(name);
      return null;
    }
    totals[event] = count;
  }
  return EVENT_TYPES.map((event) => ({ event, count: totals[event] }));
}

function parseActiveEstimate(byName, name, failures) {
  if (!byName.has(name)) return null;
  const rows = byName.get(name);
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const value = nonNegativeNumber(rows[0] && rows[0].active_estimate);
  if (value === null) {
    failures.push(name);
    return null;
  }
  return value;
}

function parseReadingMetrics(byName, name, failures) {
  if (!byName.has(name)) return null;
  const rows = byName.get(name);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { averageCardCount: null };
  }
  const row = rows[0];
  if (!row || typeof row !== "object") {
    failures.push(name);
    return null;
  }
  const raw = row.avg_card_count;
  if (raw === null || raw === undefined || raw === "") {
    return { averageCardCount: null };
  }
  const averageCardCount = nonNegativeNumber(raw);
  if (averageCardCount === null) {
    failures.push(name);
    return null;
  }
  return { averageCardCount };
}

function parseDimension(byName, name, failures) {
  if (!byName.has(name)) return null;
  const rows = byName.get(name);
  if (!Array.isArray(rows)) {
    failures.push(name);
    return null;
  }
  const truncated = rows.length > ANALYTICS_MAX_DISTRIBUTION_ROWS;
  const output = [];
  for (const row of rows.slice(0, ANALYTICS_MAX_DISTRIBUTION_ROWS)) {
    if (!row || typeof row !== "object" || typeof row.value !== "string") {
      failures.push(name);
      return null;
    }
    const count = nonNegativeNumber(row.count);
    if (count === null) {
      failures.push(name);
      return null;
    }
    if (row.value.length === 0) continue;
    // A fixed dimension query should never return the install identifier. If
    // an upstream/schema mistake sends a hash-shaped value, drop it rather
    // than turning an Analytics API response into an identifier oracle.
    if (/^[0-9a-f]{64}$/i.test(row.value)) continue;
    output.push({ value: row.value, count });
  }
  return {
    basis: DIMENSION_SPECS[name].basis,
    semantics: DIMENSION_SPECS[name].semantics,
    // Keep one stable row shape for the admin panel; the dimension name and
    // its semantic basis are carried by the enclosing distribution section.
    rows: output.map(({ value, count }) => ({ value, count })),
    limit: ANALYTICS_MAX_DISTRIBUTION_ROWS,
    truncated
  };
}

function parseDailyTrend(byName, name, failures) {
  if (!byName.has(name)) return null;
  const rows = byName.get(name);
  if (!Array.isArray(rows)) {
    failures.push(name);
    return null;
  }
  const truncated = rows.length > ANALYTICS_MAX_DAILY_TREND_ROWS;
  const output = [];
  for (const row of rows.slice(0, ANALYTICS_MAX_DAILY_TREND_ROWS)) {
    if (!row || typeof row !== "object") {
      failures.push(name);
      return null;
    }
    const day = normalizeUtcDay(row.utc_day ?? row.day);
    const count = nonNegativeNumber(row.count);
    if (day === null || count === null) {
      failures.push(name);
      return null;
    }
    output.push({ utc_day: day, count });
  }
  return {
    basis: "all_events",
    window_basis: "rolling_window",
    bucket_basis: "utc_day",
    partial_boundary_days: true,
    rows: output,
    limit: ANALYTICS_MAX_DAILY_TREND_ROWS,
    truncated
  };
}

function normalizeUtcDay(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 4_000_000) return null;
  return new Date(number * 86_400_000).toISOString().slice(0, 10);
}

function nonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function buildAnalyticsResponse(window, parsed) {
  const eventTotals = parsed.eventTotals;
  const installSeen = eventTotals
    ? eventTotals.find((row) => row.event === "install_seen").count
    : null;
  const readingCompleted = eventTotals
    ? eventTotals.find((row) => row.event === "reading_completed").count
    : null;

  const distributions = {
    ...parsed.distributions,
    event: eventTotals
      ? {
          basis: "all_events",
          semantics: "weighted accepted event rows",
          rows: eventTotals.map(({ event, count }) => ({ value: event, count })),
          limit: EVENT_TYPES.length,
          truncated: false
        }
      : null
  };

  return {
    module: "analytics",
    available: parsed.failedSections.length === 0,
    window,
    window_seconds: WINDOW_SPECS[window].seconds,
    generated_at: nowSec(),
    install_seen: installSeen,
    active_estimate: parsed.activeEstimate,
    active_estimate_meta: {
      estimated: true,
      event_types: ["daily_active", "app_active"],
      basis: "sampled_distinct_active_install_estimate",
      sampling_note: "DISTINCT active counts are estimates and are affected by Analytics Engine sampling"
    },
    reading_completed: readingCompleted,
    reading_completed_average_card_count: parsed.readingMetrics
      ? parsed.readingMetrics.averageCardCount
      : null,
    event_totals: eventTotals,
    distributions,
    daily_trend: parsed.dailyTrend,
    semantics: {
      weighted_counts: "Event and distribution counts use _sample_interval weighting",
      app_version_locale: "app_version and locale use an install_seen first-report snapshot, not current state",
      geography: "country and subdivision use an install_seen first-report snapshot, not current state",
      daily_trend: "The query uses a rolling window and groups results by UTC day; boundary days may be partial"
    }
  };
}

function unavailableResponse(window, failedSections, reason) {
  const response = buildAnalyticsResponse(window, {
    failedSections: failedSections.length > 0 ? failedSections : [reason],
    eventTotals: null,
    activeEstimate: null,
    readingMetrics: null,
    distributions: {
      deck_type: null,
      app_version: null,
      locale: null,
      country: null,
      subdivision: null
    },
    dailyTrend: null
  });
  return analyticsJson({
    ...response,
    available: false,
    error: "analytics_unavailable",
    failed_sections: failedSections.length > 0 ? failedSections : [reason]
  }, 503);
}
