/**
 * Quareia Divination — anonymous usage-statistics ingest worker.
 *
 * Accepts POST /v1/events and GET /health only.
 *
 * Privacy contract (enforced in code):
 *  - Body is capped at 1 KB; anything larger is rejected (413).
 *  - Events are validated against a strict allow-list. Any unknown or
 *    disallowed field (card ids, names, orientations, positions, questions,
 *    notes, history, raw IP, User-Agent, …) causes a 400.
 *  - The raw client IP is used ONLY to derive a process-local rate-limit bucket.
 *    It is never written to Analytics Engine, D1, logs, or any response, and
 *    no persistent IP digest is kept.
 *  - Only the connection country (request.cf.country, ISO code) is stored, and
 *    only at country granularity — never city, region, or coordinates.
 *  - Timestamps come from the server clock (Date.now()), never the client.
 *  - On success the worker returns 204 with an empty body.
 *
 * Deployed behind telemetry.luotianyi.fun (see wrangler.toml + README).
 */
const SCHEMA_VERSION = 1;
const MAX_BODY_BYTES = 1024;
const ANDROID_MAJOR_MIN = 1;
const ANDROID_MAJOR_MAX = 100;

// Allow-listed events and their extra fields. Anything else is rejected.
const EVENT_DEFS = {
  install_seen: {},
  daily_active: {},
  reading_completed: { deck_type: "string", card_count: "int" }
};

const DECK_TYPES = new Set(["tarot", "mystagogus", "lxxxi"]);

// Base fields every event must carry (and is allowed to carry).
const BASE_FIELDS = {
  schema_version: "int",
  event: "string",
  install_hash: "string",
  app_version: "string",
  locale: "string",
  android_major: "int"
};

// Default rate limits (per worker instance / in-memory; reset on redeploy/restart).
const DEFAULT_RATE_LIMIT = {
  perInstallPerHour: 60,   // any single install_hash: <= 60 events/hour
  perIpPerMinute: 30       // any single IP digest: <= 30 events/minute
};

// In-memory rolling rate-limit counters. These live only in the isolate's
// memory and are lost on redeploy — adequate for abuse defence, not for
// precise metering. IP bucket keys are removed when the next request for that
// key arrives after its window; no IP digest is persisted elsewhere.
const installBuckets = new Map();   // installHashDigest -> [{ ts }]
const ipBuckets = new Map();        // ipDigest -> [{ ts }]

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true }, 200);
    }

    if (request.method === "POST" && url.pathname === "/v1/events") {
      return handleEvents(request, env);
    }

    return json({ error: "not_found" }, 404);
  }
};

async function handleEvents(request, env) {
  // Fail closed when the production binding is absent. A 204 here would make
  // the Android client permanently mark retryable events as delivered.
  if (!hasAnalyticsBinding(env)) {
    return json({ error: "telemetry_unavailable" }, 503);
  }

  // 1. Size guard before reading the body.
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  let batch;
  try {
    batch = JSON.parse(raw);
  } catch (_e) {
    return json({ error: "invalid_json" }, 400);
  }

  // Accept either a single event object or an array of events.
  const events = Array.isArray(batch) ? batch : [batch];
  if (events.length === 0 || events.length > 4) {
    return json({ error: "empty_or_too_many_events" }, 400);
  }

  const cf = request.cf || {};
  const country = typeof cf.country === "string" ? cf.country.slice(0, 2) : "??";

  const rateLimit = readRateLimits(env);

  // IP digest for rate limiting only — never stored beyond the rolling counter.
  const ipDigest = digestString(getClientIp(request) + "|ip-rate");

  // Rate limit by IP digest.
  if (overLimit(ipBuckets, ipDigest, rateLimit.perIpPerMinute, MIN_MS)) {
    return json({ error: "rate_limited" }, 429);
  }

  for (const event of events) {
    const validated = validateEvent(event);
    if (!validated.ok) {
      return json({ error: validated.error }, 400);
    }

    // Rate limit by install hash digest.
    const installDigest = digestString(validated.value.install_hash + "|install-rate");
    if (overLimit(installBuckets, installDigest, rateLimit.perInstallPerHour, HOUR_MS)) {
      return json({ error: "rate_limited" }, 429);
    }

    writeDataPoint(env, validated.value, country);
  }

  // 204 No Content: success, empty body, no identifiers echoed back.
  return new Response(null, { status: 204 });
}

/**
 * Strict validation. Returns { ok, value } or { ok:false, error }.
 * Rejects unknown fields, wrong types, and any disallowed content.
 */
function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return { ok: false, error: "event_must_be_object" };
  }

  const type = event.event;
  const def = EVENT_DEFS[type];
  if (!def) {
    return { ok: false, error: "unknown_event" };
  }

  // Build the full allow-list for this event type.
  const allowed = Object.assign({}, BASE_FIELDS, def);
  const keys = Object.keys(event);

  // Reject any field not in the allow-list (schema is closed).
  for (const key of keys) {
    if (!(key in allowed)) {
      return { ok: false, error: "unexpected_field:" + key };
    }
  }

  const value = {};

  // Validate base fields.
  for (const [field, ftype] of Object.entries(BASE_FIELDS)) {
    if (!validateField(event, value, field, ftype)) {
      return { ok: false, error: "invalid_field:" + field };
    }
  }

  // event must match the type we resolved.
  if (value.event !== type) {
    return { ok: false, error: "event_mismatch" };
  }

  if (value.schema_version !== SCHEMA_VERSION) {
    return { ok: false, error: "unsupported_schema_version" };
  }

  if (value.android_major < ANDROID_MAJOR_MIN || value.android_major > ANDROID_MAJOR_MAX) {
    return { ok: false, error: "invalid_android_major" };
  }

  // install_hash must be a 64-char lowercase hex SHA-256 digest.
  if (!/^[0-9a-f]{64}$/.test(value.install_hash)) {
    return { ok: false, error: "invalid_install_hash" };
  }

  // Validate event-specific fields.
  for (const [field, ftype] of Object.entries(def)) {
    if (!validateField(event, value, field, ftype)) {
      return { ok: false, error: "invalid_field:" + field };
    }
  }

  if (type === "reading_completed") {
    if (!DECK_TYPES.has(value.deck_type)) {
      return { ok: false, error: "invalid_deck_type" };
    }
    if (!Number.isInteger(value.card_count) || value.card_count < 1 || value.card_count > 81) {
      return { ok: false, error: "invalid_card_count" };
    }
  }

  return { ok: true, value };
}

function validateField(src, dst, field, ftype) {
  const v = src[field];
  if (v === undefined || v === null) return false;
  if (ftype === "int") {
    if (!Number.isInteger(v)) return false;
    dst[field] = v;
  } else {
    if (typeof v !== "string") return false;
    // Bound string length to keep payloads tiny and content-free.
    if (v.length > 64) return false;
    dst[field] = v;
  }
  return true;
}

/**
 * Writes one Analytics Engine data point. Only aggregate-safe fields are used.
 * No raw IP, no request body, no card/reading content is ever written.
 */
function writeDataPoint(env, event, country) {
  const analytics = env && env.TELEMETRY;
  if (!hasAnalyticsBinding(env)) {
    throw new Error("telemetry_binding_missing");
  }

  const blobs = [
    event.event,
    event.install_hash,
    event.deck_type || "",
    country,
    event.app_version,
    event.locale
  ];
  const doubles = [
    event.event === "reading_completed" ? Number(event.card_count) : 0,
    Number(event.android_major)
  ];
  const indexes = [event.install_hash];

  try {
    analytics.writeDataPoint({
      blobs,
      doubles,
      indexes
      // timestamp is added automatically by Analytics Engine (server time).
    });
  } catch (_e) {
    // A storage hiccup must not surface to the client.
  }
}

function hasAnalyticsBinding(env) {
  return Boolean(
    env &&
      env.TELEMETRY &&
      typeof env.TELEMETRY.writeDataPoint === "function"
  );
}

function readRateLimits(env) {
  return {
    perInstallPerHour: readPositiveInt(
      env && env.RATE_LIMIT_PER_INSTALL_PER_HOUR,
      DEFAULT_RATE_LIMIT.perInstallPerHour
    ),
    perIpPerMinute: readPositiveInt(
      env && env.RATE_LIMIT_PER_IP_PER_MINUTE,
      DEFAULT_RATE_LIMIT.perIpPerMinute
    )
  };
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100000
    ? parsed
    : fallback;
}

// ---------- Rate limiting helpers ----------

function overLimit(buckets, key, limit, windowMs) {
  const now = Date.now();
  const entries = buckets.get(key) || [];
  const fresh = entries.filter((ts) => now - ts < windowMs);
  if (fresh.length === 0) buckets.delete(key);
  if (fresh.length >= limit) {
    buckets.set(key, fresh);
    return true;
  }
  fresh.push(now);
  buckets.set(key, fresh);
  return false;
}

function getClientIp(request) {
  // Only Cloudflare's connection header is trusted. X-Forwarded-For is
  // client-controlled at the edge and is deliberately ignored.
  return request.headers.get("cf-connecting-ip") || "0.0.0.0";
}

// Synchronous, non-cryptographic digest for the process-local rate-limit key.
// This is not an irreversible privacy mechanism; the resulting key is never
// written to persistent storage, logs, Analytics Engine, or a response.
function digestString(input) {
  const s = "quareia-tel|" + input;
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x1000193 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + 0x9e3779b1), 0x85ebca77) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
