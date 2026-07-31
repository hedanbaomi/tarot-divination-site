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
 *  - The raw client IP is used ONLY for in-memory rate limiting. It is never
 *    written to Analytics Engine, D1, logs, or any response.
 *  - Only the connection country (request.cf.country, ISO code) is stored, and
 *    only at country granularity — never city, region, or coordinates.
 *  - Timestamps come from the server clock (Date.now()), never the client.
 *  - On success the worker returns 204 with an empty body.
 *
 * Deployed behind telemetry.luotianyi.fun (see wrangler.toml + README).
 */
const SCHEMA_VERSION = 1;
const MAX_BODY_BYTES = 1024;

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

// Rate limits (per worker instance / in-memory; reset on redeploy/restart).
const RATE_LIMIT = {
  perInstallPerHour: 60,   // any single install_hash: <= 60 events/hour
  perIpPerMinute: 30       // any single IP digest: <= 30 events/minute
};

// In-memory rolling rate-limit counters and security-log entries. These live
// only in the isolate's memory and are lost on redeploy — adequate for abuse
// defence, not for precise metering.
const installBuckets = new Map();   // installHashDigest -> [{ ts }]
const ipBuckets = new Map();        // ipDigest -> [{ ts }]
const securityLog = [];             // { ipDigest, ts } retained <= 7 days

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SECURITY_LOG_TTL_DAYS = 7;

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
  // 1. Size guard before reading the body.
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength && contentLength > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
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

  // IP digest for rate limiting only — never stored beyond the rolling counter.
  const ipDigest = digestString(getClientIp(request) + "|ip-rate");

  // Rate limit by IP digest.
  if (overLimit(ipBuckets, ipDigest, RATE_LIMIT.perIpPerMinute, MIN_MS)) {
    noteSecurity(ipDigest);
    return json({ error: "rate_limited" }, 429);
  }

  for (const event of events) {
    const validated = validateEvent(event);
    if (!validated.ok) {
      return json({ error: validated.error }, 400);
    }

    // Rate limit by install hash digest.
    const installDigest = digestString(validated.value.install_hash + "|install-rate");
    if (overLimit(installBuckets, installDigest, RATE_LIMIT.perInstallPerHour, HOUR_MS)) {
      noteSecurity(ipDigest);
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

  value.schema_version = SCHEMA_VERSION; // server-controlled
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
  const analytics = env.TELEMETRY;
  if (!analytics || typeof analytics.writeDataPoint !== "function") {
    // No binding configured (e.g. local dev): accept silently so the client is
    // never blocked. In production the binding must be present.
    return;
  }

  const blobs = [
    event.event,
    event.install_hash,
    event.deck_type || "",
    country
  ];
  const doubles = [event.card_count ? Number(event.card_count) : 0];
  const indexes = [
    event.event,
    event.deck_type || "",
    country,
    event.app_version
  ];

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

// ---------- Rate limiting helpers ----------

function overLimit(buckets, key, limit, windowMs) {
  const now = Date.now();
  const entries = buckets.get(key) || [];
  const fresh = entries.filter((ts) => now - ts < windowMs);
  if (fresh.length >= limit) {
    buckets.set(key, fresh);
    return true;
  }
  fresh.push(now);
  buckets.set(key, fresh);
  return false;
}

// ---------- Security log (IP digest only, <= 7 days) ----------

function noteSecurity(ipDigest) {
  securityLog.push({ ipDigest, ts: Date.now() });
  // Trim anything older than the TTL.
  const cutoff = Date.now() - SECURITY_LOG_TTL_DAYS * DAY_MS;
  while (securityLog.length && securityLog[0].ts < cutoff) securityLog.shift();
  // Bound growth defensively.
  if (securityLog.length > 5000) securityLog.splice(0, securityLog.length - 5000);
}

function getClientIp(request) {
  // Cloudflare provides the client IP here. Used for rate-limit digesting only.
  return request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "0.0.0.0";
}

// Synchronous, non-cryptographic digest for rate-limit bucketing only. It is
// intentionally NOT crypto-strong and is salted so it cannot be reversed to the
// original IP; it only needs to map identical inputs to identical buckets.
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
