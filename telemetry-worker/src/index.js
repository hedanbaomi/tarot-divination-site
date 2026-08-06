/**
 * Quareia Divination — anonymous usage-statistics ingest worker.
 *
 * Endpoints:
 *  - POST /v1/events        — one validated event (install_seen, daily_active,
 *                             reading_completed, app_active); app_active also
 *                             updates the D1 install_state table.
 *  - GET  /v1/announcements — public announcements for a platform/version.
 *  - GET  /admin            — same-origin admin page (announcements + stats).
 *  - POST /admin/verify     — admin token check.
 *  - /admin/api/*           — token-authenticated announcements CRUD + stats.
 *  - GET  /health           — liveness.
 *  - scheduled cron         — daily cleanup of installs inactive > 90 days.
 *
 * Privacy contract (enforced in code):
 *  - Body is capped at 1 KB; anything larger is rejected (413).
 *  - Events are validated against a strict allow-list. Any unknown or
 *    disallowed field (card ids, names, orientations, positions, questions,
 *    notes, history, raw IP, User-Agent, …) causes a 400.
 *  - The raw client IP is used ONLY to derive a process-local rate-limit bucket.
 *    It is never written to Analytics Engine, D1, logs, or any response, and
 *    no persistent IP digest is kept.
 *  - Only Cloudflare's connection country and first-level subdivision fields
 *    (request.cf.country, regionCode, region) are stored. City, postal code,
 *    coordinates, metro code, and all client-supplied geo fields are ignored.
 *  - Timestamps come from the server clock, never the client.
 *  - D1 stores only the anonymous install state (hash, app version, locale,
 *    android major, first/last seen) and announcements; never an IP,
 *    User-Agent, device model, city, card, spread, question, note or history.
 *  - On success the worker returns 204 with an empty body.
 *  - Admin endpoints are deny-by-default: the ADMIN_TOKEN secret is required
 *    and compared in constant time from the Authorization: Bearer header only.
 *
 * A future deployment may use telemetry.luotianyi.fun (see wrangler.toml + README).
 */
import { json, securityHeaders } from "./http.js";
import { nowMs, setClockForTesting, resetClock } from "./clock.js";
import { handleAnnouncements, publicAnnouncementHeaders } from "./announcements.js";
import { recordInstallActivity, cleanupInactiveInstalls } from "./stats.js";
import { handleAdminPage, handleAdminVerify, handleAdminApi } from "./admin.js";

const SCHEMA_VERSION = 1;
const MAX_BODY_BYTES = 1024;
const ANDROID_MAJOR_MIN = 1;
const ANDROID_MAJOR_MAX = 100;
const MAX_VERSION_CODE = 2147483647;

// Allow-listed events and their extra fields. Anything else is rejected.
const EVENT_DEFS = {
  install_seen: {},
  daily_active: {},
  reading_completed: { deck_type: "string", card_count: "int" },
  app_active: { version_code: "int" }
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

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const MAX_IP_BUCKETS = 4096;
const MAX_INSTALL_BUCKETS = 4096;
const CLEANUP_EVERY_REQUESTS = 1;
const MAX_CLEANUP_SCANNED = 64;
const MAX_CLEANUP_DELETED = 64;

// In-memory rolling rate-limit counters. Each key has one bounded window
// record, never a timestamp array. These maps are isolate-local and are lost
// on restart; no IP digest is persisted elsewhere.
const installBuckets = new Map(); // installHashDigest -> bucket
const ipBuckets = new Map(); // ipDigest -> bucket
const installCleanup = { iterator: null };
const ipCleanup = { iterator: null };
let requestsSinceCleanup = 0;

export const __test = {
  resetRateLimits() {
    installBuckets.clear();
    ipBuckets.clear();
    installCleanup.iterator = null;
    ipCleanup.iterator = null;
    requestsSinceCleanup = 0;
  },
  setClockForTesting(nextClock) {
    setClockForTesting(nextClock);
  },
  resetClock() {
    resetClock();
  },
  snapshotRateLimits() {
    return {
      ipBucketCount: ipBuckets.size,
      installBucketCount: installBuckets.size,
      ipBucketFields: Object.keys(ipBuckets.values().next().value || {}),
      installBucketFields: Object.keys(installBuckets.values().next().value || {})
    };
  }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true }, 200);
    }

    if (request.method === "POST" && url.pathname === "/v1/events") {
      return handleEvents(request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/announcements") {
      if (rateLimitByIp(request, env, nowMs())) {
        return json({ error: "rate_limited" }, 429, publicAnnouncementHeaders(request));
      }
      return handleAnnouncements(request, env);
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      if (rateLimitByIp(request, env, nowMs())) {
        return json({ error: "rate_limited" }, 429, securityHeaders());
      }
      return handleAdminPage();
    }

    if (request.method === "POST" && url.pathname === "/admin/verify") {
      if (rateLimitByIp(request, env, nowMs())) {
        return json({ error: "rate_limited" }, 429, securityHeaders());
      }
      return handleAdminVerify(request, env);
    }

    if (url.pathname.startsWith("/admin/api/")) {
      if (rateLimitByIp(request, env, nowMs())) {
        return json({ error: "rate_limited" }, 429, securityHeaders());
      }
      return handleAdminApi(request, env, url.pathname);
    }

    return json({ error: "not_found" }, 404);
  },

  /**
   * Daily cron: deletes install_state rows inactive for more than 90 days.
   * Never throws; missing D1 binding is a no-op.
   */
  async scheduled(event, env, ctx) {
    try {
      await cleanupInactiveInstalls(env);
    } catch (_e) {
      // Cleanup must never take the worker down; the next cron retries.
    }
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

  let event;
  try {
    event = JSON.parse(raw);
  } catch (_e) {
    return json({ error: "invalid_json" }, 400);
  }

  // Only one object is accepted. Rejecting arrays avoids partial writes if a
  // later item in a batch is invalid or the binding fails halfway through.
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return json({ error: "event_must_be_object" }, 400);
  }

  const cf = request.cf || {};
  const country = boundedCfString(cf.country, 2).toUpperCase();
  const regionCode = boundedCfString(cf.regionCode, 64);
  const regionName = boundedCfString(cf.region, 64);
  const subdivisionCode = country && regionCode ? `${country}-${regionCode}` : "";

  const rateLimit = readRateLimits(env);
  const now = nowMillis();
  maybeCleanupExpired(now);

  // IP digest for rate limiting only — never stored beyond the rolling counter.
  const ipDigest = digestString(getClientIp(request) + "|ip-rate");

  // Rate limit by IP digest.
  if (consumeBucket(ipBuckets, ipDigest, rateLimit.perIpPerMinute, MIN_MS, now, MAX_IP_BUCKETS)) {
    return json({ error: "rate_limited" }, 429);
  }

  const validated = validateEvent(event);
  if (!validated.ok) {
    return json({ error: validated.error }, 400);
  }

  // Rate limit by install hash digest.
  const installDigest = digestString(validated.value.install_hash + "|install-rate");
  if (consumeBucket(
    installBuckets,
    installDigest,
    rateLimit.perInstallPerHour,
    HOUR_MS,
    now,
    MAX_INSTALL_BUCKETS
  )) {
    return json({ error: "rate_limited" }, 429);
  }

  try {
    writeDataPoint(env, validated.value, {
      country,
      subdivisionCode,
      regionName
    });
  } catch (_e) {
    return json({ error: "telemetry_write_failed" }, 503);
  }

  // app_active and the legacy daily_active both move the anonymous install to
  // its current version group in D1 (legacy events have no version_code and
  // are stored as 0 = "unknown/legacy"; a later app_active from the upgraded
  // client overwrites it). install_seen and reading_completed never touch D1,
  // so old clients cannot break and no reading/install metadata is retained.
  // A D1 failure returns a retryable error rather than pretending success;
  // the 6-hour same-version dedupe makes retries cheap.
  if (validated.value.event === "app_active" || validated.value.event === "daily_active") {
    try {
      await recordInstallActivity(env, validated.value);
    } catch (_e) {
      return json({ error: "d1_write_failed" }, 503);
    }
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

  if (type === "app_active") {
    if (!Number.isInteger(value.version_code) ||
        value.version_code < 1 ||
        value.version_code > MAX_VERSION_CODE) {
      return { ok: false, error: "invalid_version_code" };
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
function writeDataPoint(env, event, geo) {
  const analytics = env && env.TELEMETRY;
  if (!hasAnalyticsBinding(env)) {
    throw new Error("telemetry_binding_missing");
  }

  const blobs = [
    event.event,
    event.install_hash,
    event.deck_type || "",
    geo.country,
    geo.subdivisionCode,
    geo.regionName,
    event.app_version,
    event.locale
  ];
  const doubles = [
    event.event === "reading_completed" ? Number(event.card_count) : 0,
    Number(event.android_major)
  ];
  const indexes = [event.install_hash];

  analytics.writeDataPoint({
    blobs,
    doubles,
    indexes
    // timestamp is added automatically by Analytics Engine (server time).
  });
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

function nowMillis() {
  return nowMs();
}

/** Per-IP rate limit shared by the public GET and admin routes. */
function rateLimitByIp(request, env, now) {
  const rateLimit = readRateLimits(env);
  maybeCleanupExpired(now);
  const ipDigest = digestString(getClientIp(request) + "|ip-rate");
  return consumeBucket(ipBuckets, ipDigest, rateLimit.perIpPerMinute, MIN_MS, now, MAX_IP_BUCKETS);
}

function maybeCleanupExpired(now) {
  requestsSinceCleanup += 1;
  if (requestsSinceCleanup < CLEANUP_EVERY_REQUESTS) return;
  requestsSinceCleanup = 0;
  cleanupMap(ipBuckets, ipCleanup, now);
  cleanupMap(installBuckets, installCleanup, now);
}

function cleanupMap(map, state, now) {
  if (!state.iterator) state.iterator = map.keys();

  let scanned = 0;
  let deleted = 0;
  while (scanned < MAX_CLEANUP_SCANNED && deleted < MAX_CLEANUP_DELETED) {
    let next = state.iterator.next();
    if (next.done) {
      state.iterator = map.keys();
      next = state.iterator.next();
      if (next.done) break;
    }

    scanned += 1;
    const bucket = map.get(next.value);
    if (!bucket || bucket.expiresAt <= now) {
      if (map.delete(next.value)) deleted += 1;
    }
  }
}

function consumeBucket(buckets, key, limit, windowMs, now, maxBuckets) {
  const current = buckets.get(key);
  if (current && current.expiresAt > now) {
    if (current.count >= limit) return true;
    current.count += 1;
    return false;
  }

  // The key is missing or its fixed window has expired. Start a new window.
  if (current) buckets.delete(key);
  ensureCapacity(buckets, maxBuckets);
  buckets.set(key, {
    count: 1,
    windowStartedAt: now,
    expiresAt: now + windowMs
  });
  return false;
}

function ensureCapacity(map, maxBuckets) {
  if (map.size < maxBuckets) return;

  // Evict a small bounded prefix before adding a new random key. This keeps
  // the map below its hard ceiling even when all existing buckets are active.
  const evictionCount = Math.max(1, Math.floor(maxBuckets / 32));
  const iterator = map.keys();
  for (let i = 0; i < evictionCount; i += 1) {
    const next = iterator.next();
    if (next.done) break;
    map.delete(next.value);
  }
}

function boundedCfString(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
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
