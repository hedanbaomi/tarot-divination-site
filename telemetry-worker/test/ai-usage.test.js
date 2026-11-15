// AI interpretation usage: closed schema, D1-only ingest, idempotent
// dedupe, authenticated admin filters, aggregation, 200-row truncation,
// 90-day retention and migration preservation.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import worker, { __test } from "../src/index.js";
import { cleanupAiUsage, recordAiUsage } from "../src/ai-usage.js";
import {
  AI_USAGE_MAX_GROUP_ROWS,
  parseAiUsageQuery
} from "../src/ai-stats.js";
import {
  createMockD1,
  failingD1,
  makeEnv,
  makeEvent,
  makeRequest,
  mockAnalytics
} from "./helpers.js";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const TOKEN = "test-admin-token";
const HOUR = 3600;
const DAY = 86400;

let now = 1_700_000_000_000;
let sequence = 0;

test.beforeEach(() => {
  now = 1_700_000_000_000;
  __test.setClockForTesting(() => now);
  __test.resetRateLimits();
});

test.after(() => {
  __test.resetClock();
  __test.resetRateLimits();
});

function nextRequestId() {
  sequence += 1;
  return sequence.toString(16).padStart(32, "0");
}

/** A complete, valid ai_usage event exactly as the web/Android clients send it. */
function makeAiEvent(overrides = {}) {
  const event = makeEvent("ai_usage", {
    platform: "web",
    request_id: nextRequestId(),
    model_id: "deepseek-v4-chat",
    usage_kind: "conversation",
    total_tokens: 120,
    ...overrides
  });
  // The existing web rule: android_major must be omitted by web clients. Only
  // add that default when the caller did not explicitly supply the field, so
  // tests can still probe the rejection path.
  if (event.platform === "web" && !("android_major" in overrides)) delete event.android_major;
  return event;
}

function envWith(db = createMockD1(), overrides = {}) {
  return makeEnv({ db, analytics: mockAnalytics(), adminToken: TOKEN, overrides });
}

async function postEvent(env, body) {
  return worker.fetch(makeRequest("https://telemetry.test/v1/events", { method: "POST", body }), env);
}

function adminGet(env, query) {
  return worker.fetch(
    makeRequest("https://telemetry.test/admin/api/ai-usage" + (query || ""), { token: TOKEN }),
    env
  );
}

function rows(db) {
  return db.all("SELECT * FROM ai_usage ORDER BY request_id");
}

function seedUsage(db, entries) {
  const nowSec = Math.floor(now / 1000);
  for (const entry of entries) {
    db.exec(`INSERT INTO ai_usage (request_id, model_id, platform, usage_kind, total_tokens, created_at)
      VALUES ('${entry.request_id}', '${entry.model_id}', '${entry.platform}', '${entry.usage_kind}',
        ${entry.total_tokens === null ? "NULL" : entry.total_tokens},
        ${entry.created_at === undefined ? nowSec : entry.created_at})`);
  }
}

// ---------------------------------------------------------------------------
// Migration 0006
// ---------------------------------------------------------------------------

test("migration 0006 adds ai_usage without touching existing tables or rows", () => {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) {
    if (name.startsWith("0006")) break;
    db.exec(readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
  }
  db.exec(`
    INSERT INTO announcements (id, revision, status, severity, title_zh, platform, created_at, updated_at)
    VALUES (7, 3, 'published', 'update', '已有公告', 'android', 10, 11);
    INSERT INTO install_state
      (install_hash, app_version, version_code, locale, android_major, ios_major, platform,
       env_version, first_seen_at, last_seen_at)
    VALUES ('${"a".repeat(64)}', '1.5.2', 42, 'zh-CN', 35, 0, 'android', '', 10, 20);
    INSERT INTO install_state
      (install_hash, app_version, version_code, locale, android_major, ios_major, platform,
       env_version, first_seen_at, last_seen_at)
    VALUES ('${"b".repeat(64)}', 'web-1', 0, 'en', 0, 0, 'web', '', 12, 22);
    INSERT INTO web_analytics_imports
      (id, source, host, path, from_utc, cutoff_utc, exported_at, coverage_days, pageviews,
       visits, exclude_bots, published_at)
    VALUES ('${"c".repeat(64)}', 'cloudflare_web_analytics', 'hedanbaomi.github.io',
      '/tarot-divination-site/', '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z',
      '2026-01-03T00:00:00Z', 2, 10, 5, 1, 99);
  `);
  const before = {
    announcements: db.prepare("SELECT * FROM announcements ORDER BY id").all(),
    install_state: db.prepare("SELECT * FROM install_state ORDER BY install_hash").all(),
    imports: db.prepare("SELECT * FROM web_analytics_imports ORDER BY id").all(),
    daily: db.prepare("SELECT * FROM web_analytics_daily").all()
  };
  const indexesBefore = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name"
  ).all();

  db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0006_ai_usage.sql"), "utf8"));

  assert.deepEqual({
    announcements: db.prepare("SELECT * FROM announcements ORDER BY id").all(),
    install_state: db.prepare("SELECT * FROM install_state ORDER BY install_hash").all(),
    imports: db.prepare("SELECT * FROM web_analytics_imports ORDER BY id").all(),
    daily: db.prepare("SELECT * FROM web_analytics_daily").all()
  }, before);
  // Legacy indexes survive untouched alongside the two new ai_usage indexes.
  const indexesAfter = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name"
  ).all();
  for (const index of indexesBefore) {
    assert.deepEqual(
      indexesAfter.find((row) => row.name === index.name),
      index,
      "index " + index.name + " must be preserved"
    );
  }
  const names = indexesAfter.map((row) => row.name);
  assert.ok(names.includes("idx_ai_usage_created_at"));
  assert.ok(names.includes("idx_ai_usage_platform_created_at"));

  // The new table starts empty and stores no install identifier column.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get().n, 0);
  const columns = db.prepare("PRAGMA table_info(ai_usage)").all().map((row) => row.name);
  assert.deepEqual(columns, [
    "request_id", "model_id", "platform", "usage_kind", "total_tokens", "created_at"
  ]);
  assert.ok(!columns.includes("install_hash"));
  db.close();
});

test("migration 0006 is idempotent and enforces the closed column contract", () => {
  const db = new DatabaseSync(":memory:");
  const sql = readFileSync(path.join(MIGRATIONS_DIR, "0006_ai_usage.sql"), "utf8");
  db.exec(sql);
  assert.doesNotThrow(() => db.exec(sql));

  const insert = db.prepare(
    "INSERT INTO ai_usage (request_id, model_id, platform, usage_kind, total_tokens, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
  );
  const GOOD_ID = "0123456789abcdef0123456789abcdef";
  assert.doesNotThrow(() => insert.run(GOOD_ID, "gpt-4o", "web", "conversation", 5, 1));
  assert.doesNotThrow(() => insert.run("b".repeat(32), "m", "android", "compression", 0, 1));
  assert.doesNotThrow(() => insert.run("c".repeat(32), "m", "web", "conversation", null, 1));
  // A real reported 0 is preserved as 0, never as NULL.
  assert.equal(db.prepare("SELECT total_tokens FROM ai_usage WHERE model_id='m' AND platform='android'").get().total_tokens, 0);

  const rejected = [
    [GOOD_ID, "dup", "web", "conversation", 5, 1], // primary key
    ["A".repeat(32), "m", "web", "conversation", 5, 1], // uppercase hex
    ["d".repeat(31), "m", "web", "conversation", 5, 1], // wrong length
    ["e".repeat(33), "m", "web", "conversation", 5, 1],
    ["f".repeat(32), "bad model", "web", "conversation", 5, 1], // space
    ["1".repeat(32), "@bad", "web", "conversation", 5, 1], // leading symbol
    ["2".repeat(32), "", "web", "conversation", 5, 1], // empty
    ["3".repeat(32), "m", "ios", "conversation", 5, 1], // platform allow-list
    ["4".repeat(32), "m", "miniprogram", "conversation", 5, 1],
    ["5".repeat(32), "m", "web", "other", 5, 1], // usage kind allow-list
    ["6".repeat(32), "m", "web", "conversation", -1, 1],
    ["7".repeat(32), "m", "web", "conversation", 1000000001, 1]
  ];
  for (const args of rejected) {
    assert.throws(() => insert.run(...args), /CHECK|UNIQUE|constraint/i, JSON.stringify(args));
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get().n, 3);
  db.close();
});

// ---------------------------------------------------------------------------
// Ingest schema
// ---------------------------------------------------------------------------

test("a valid ai_usage event is stored once in D1 and never in Analytics Engine", async () => {
  const db = createMockD1();
  const analytics = mockAnalytics();
  const env = makeEnv({ db, analytics, adminToken: TOKEN });
  const event = makeAiEvent({
    platform: "android",
    request_id: "0123456789abcdef0123456789abcdef",
    model_id: "deepseek-v4-flash",
    usage_kind: "compression",
    total_tokens: 0
  });

  const response = await postEvent(env, event);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");

  // ai_usage is D1-only: no Analytics Engine data point is written.
  assert.equal(analytics.points.length, 0);

  const stored = rows(db);
  assert.equal(stored.length, 1);
  assert.deepEqual({ ...stored[0] }, {
    request_id: "0123456789abcdef0123456789abcdef",
    model_id: "deepseek-v4-flash",
    platform: "android",
    usage_kind: "compression",
    total_tokens: 0,
    created_at: Math.floor(now / 1000)
  });
  // No install identifier or content columns exist to leak into.
  assert.ok(!("install_hash" in stored[0]));
});

test("platform may be omitted and then follows the existing Android rule", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics(), adminToken: TOKEN });
  // Omitted platform means Android, so android_major is required.
  const event = makeAiEvent();
  delete event.platform;
  event.android_major = 35;

  assert.equal((await postEvent(env, event)).status, 204);
  assert.equal(rows(db)[0].platform, "android");
});

test("ai_usage rejects platforms other than android and web", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics(), adminToken: TOKEN });
  for (const platform of ["ios", "miniprogram", "minigame"]) {
    const event = makeAiEvent({ platform });
    if (platform === "ios") {
      delete event.android_major;
      event.ios_major = 17;
    }
    if (platform === "miniprogram" || platform === "minigame") event.env_version = "release";
    const response = await postEvent(env, event);
    assert.equal(response.status, 400, platform);
    assert.match(await response.text(), /invalid_event_platform/, platform);
  }
  assert.equal(rows(db).length, 0);
});

test("every ai_usage field is required and unknown fields are rejected", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics(), adminToken: TOKEN });

  for (const field of ["request_id", "model_id", "usage_kind", "total_tokens"]) {
    const event = makeAiEvent();
    delete event[field];
    const response = await postEvent(env, event);
    assert.equal(response.status, 400, "missing " + field);
    assert.match(await response.text(), new RegExp("invalid_field:" + field), field);
  }

  const forbidden = [
    "question", "answer", "prompt", "completion", "api_key", "key", "url",
    "conversation_id", "conversationId", "reading", "card_name", "response",
    "usage", "headers", "provider_raw"
  ];
  for (const field of forbidden) {
    const response = await postEvent(env, makeAiEvent({ [field]: "x" }));
    assert.equal(response.status, 400, field);
    assert.match(await response.text(), new RegExp("unexpected_field:" + field), field);
  }
  // A nested usage object is not silently flattened.
  assert.equal((await postEvent(env, makeAiEvent({ usage: { total_tokens: 5 } }))).status, 400);
  assert.equal(rows(db).length, 0);
});

test("request_id must be exactly 32 lowercase hex characters", async () => {
  const env = envWith();
  const bad = [
    "0123456789ABCDEF0123456789ABCDEF", // uppercase
    "0123456789abcdef0123456789abcde", // 31
    "0123456789abcdef0123456789abcdef0", // 33
    "g".repeat(32), // non-hex
    "0123456789abcdef-123456789abcdef", // hyphen
    ""
  ];
  for (const requestId of bad) {
    const response = await postEvent(env, makeAiEvent({ request_id: requestId }));
    assert.equal(response.status, 400, requestId);
    assert.match(await response.text(), /invalid_request_id/, requestId);
  }
});

test("model_id follows the shared ASCII pattern and length bound", async () => {
  const env = envWith();
  const accepted = [
    "a",
    "gpt-4o",
    "deepseek-v4.1-flash",
    "anthropic/claude-sonnet-4",
    "qwen2.5:7b",
    "models/gemini@2026",
    "a".repeat(128)
  ];
  for (const modelId of accepted) {
    assert.equal((await postEvent(env, makeAiEvent({ model_id: modelId }))).status, 204, modelId);
  }

  const rejected = [
    "",
    " a",
    ".leading",
    "-leading",
    "has space",
    "semi;colon",
    "quote\"",
    "back\\slash",
    "a".repeat(129),
    "模型"
  ];
  for (const modelId of rejected) {
    const response = await postEvent(env, makeAiEvent({ model_id: modelId }));
    assert.equal(response.status, 400, JSON.stringify(modelId));
    // A too-long id is caught by the shared string bound; every other
    // violation is caught by the dedicated model_id check.
    assert.match(await response.text(), /invalid_model_id|invalid_field:model_id/,
      JSON.stringify(modelId));
  }
});

test("usage_kind is limited to conversation and compression", async () => {
  const env = envWith();
  for (const kind of ["conversation", "compression"]) {
    assert.equal((await postEvent(env, makeAiEvent({ usage_kind: kind }))).status, 204, kind);
  }
  for (const kind of ["CONVERSATION", "chat", "test", "connection", "compaction", 1, null]) {
    const response = await postEvent(env, makeAiEvent({ usage_kind: kind }));
    assert.equal(response.status, 400, String(kind));
  }
});

test("total_tokens is null or an integer in 0..1000000000", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics(), adminToken: TOKEN });

  // null means "unknown"; 0 means a real reported zero. Both are accepted.
  assert.equal((await postEvent(env, makeAiEvent({ total_tokens: null }))).status, 204);
  assert.equal((await postEvent(env, makeAiEvent({ total_tokens: 0 }))).status, 204);
  assert.equal((await postEvent(env, makeAiEvent({ total_tokens: 1000000000 }))).status, 204);

  for (const value of [-1, 1000000001, 1.5, "5", true, []] ) {
    const response = await postEvent(env, makeAiEvent({ total_tokens: value }));
    assert.equal(response.status, 400, JSON.stringify(value));
    // Non-integers fail the shared type check first; range violations are
    // reported by the dedicated total_tokens check.
    assert.match(await response.text(), /invalid_total_tokens|invalid_field:total_tokens/,
      JSON.stringify(value));
  }

  const stored = rows(db);
  // null is stored as SQL NULL and a real reported 0 stays 0; order is by
  // request_id, so compare as a multiset.
  assert.deepEqual(stored.map((row) => row.total_tokens).sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    return a - b;
  }), [null, 0, 1000000000].sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    return a - b;
  }));
});

test("common fields keep their existing rules for ai_usage", async () => {
  const env = envWith();
  assert.equal((await postEvent(env, makeAiEvent({ schema_version: 2 }))).status, 400);
  assert.equal((await postEvent(env, makeAiEvent({ install_hash: "short" }))).status, 400);
  assert.equal((await postEvent(env, makeAiEvent({ android_major: 0 }))).status, 400);
  assert.equal((await postEvent(env, makeAiEvent({ android_major: 101 }))).status, 400);
  assert.equal((await postEvent(env, makeAiEvent({ locale: "x".repeat(200) }))).status, 400);
  const web = makeAiEvent();
  assert.ok(!("android_major" in web));
  assert.equal((await postEvent(env, web)).status, 204, "web omits android_major");
  const webWithAndroid = { ...makeAiEvent(), android_major: 35 };
  assert.equal((await postEvent(env, webWithAndroid)).status, 400, "web rejects android_major");
});

// ---------------------------------------------------------------------------
// Idempotency / dedupe
// ---------------------------------------------------------------------------

test("a repeated request_id is idempotent and still returns 204", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics(), adminToken: TOKEN });
  const event = makeAiEvent({ request_id: "a".repeat(32), total_tokens: 42 });

  const first = await postEvent(env, event);
  const second = await postEvent(env, event);
  const third = await postEvent(env, event);

  assert.equal(first.status, 204);
  assert.equal(second.status, 204);
  assert.equal(third.status, 204);
  assert.equal(rows(db).length, 1);
  assert.equal(rows(db)[0].total_tokens, 42);
});

test("a duplicate never overwrites the original row's values", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics(), adminToken: TOKEN });
  const requestId = "b".repeat(32);

  await postEvent(env, makeAiEvent({
    request_id: requestId, model_id: "first-model", usage_kind: "conversation", total_tokens: 10
  }));
  now += 60_000;
  await postEvent(env, makeAiEvent({
    request_id: requestId, model_id: "other-model", usage_kind: "compression", total_tokens: 999
  }));

  const stored = rows(db);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].model_id, "first-model");
  assert.equal(stored[0].usage_kind, "conversation");
  assert.equal(stored[0].total_tokens, 10);
  assert.equal(stored[0].created_at, Math.floor((1_700_000_000_000) / 1000));
});

test("recordAiUsage reports written vs duplicate", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics() });
  const value = {
    request_id: "c".repeat(32),
    model_id: "m",
    platform: "web",
    usage_kind: "conversation",
    total_tokens: null
  };
  assert.equal(await recordAiUsage(env, value), "written");
  assert.equal(await recordAiUsage(env, value), "duplicate");
});

// ---------------------------------------------------------------------------
// D1 failure behaviour
// ---------------------------------------------------------------------------

test("ai_usage fails closed when D1 is missing", async () => {
  const env = makeEnv({ db: undefined, analytics: mockAnalytics(), adminToken: TOKEN });
  const response = await postEvent(env, makeAiEvent());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "d1_write_failed" });
});

test("a failing D1 write returns a retryable 503", async () => {
  const env = makeEnv({ db: failingD1(), analytics: mockAnalytics(), adminToken: TOKEN });
  const response = await postEvent(env, makeAiEvent());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "d1_write_failed" });
});

test("ai_usage never needs an Analytics Engine binding", async () => {
  const db = createMockD1();
  // No TELEMETRY binding at all: the legacy events still fail closed, while
  // ai_usage must be stored.
  const env = makeEnv({ db, analytics: undefined, adminToken: TOKEN });
  assert.equal((await postEvent(env, makeEvent("install_seen"))).status, 503);
  assert.equal((await postEvent(env, makeAiEvent())).status, 204);
  assert.equal(rows(db).length, 1);
});

test("an Analytics Engine failure cannot affect an accepted ai_usage report", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: { writeDataPoint() { throw new Error("boom"); } }, adminToken: TOKEN });
  assert.equal((await postEvent(env, makeAiEvent())).status, 204);
  assert.equal(rows(db).length, 1);
});

// ---------------------------------------------------------------------------
// Existing behaviour is preserved
// ---------------------------------------------------------------------------

test("legacy events keep their Analytics Engine mapping and 503 behaviour", async () => {
  const analytics = mockAnalytics();
  const env = makeEnv({ db: createMockD1(), analytics, adminToken: TOKEN });
  const installHash = "d".repeat(64);

  // install_seen is unchanged: one AE point, D1 untouched, no ai_usage row.
  const response = await postEvent(env, makeEvent("install_seen", { install_hash: installHash }));
  assert.equal(response.status, 204);
  assert.equal(analytics.points.length, 1);
  assert.deepEqual(analytics.points[0].blobs.slice(0, 3), ["install_seen", installHash, ""]);
  assert.equal(analytics.points[0].indexes[0], installHash);

  // app_active still writes both surfaces.
  const active = makeEvent("app_active", { install_hash: installHash, version_code: 4 });
  analytics.points.length = 0;
  assert.equal((await postEvent(env, active)).status, 204);
  assert.equal(analytics.points.length, 1);
  assert.equal(env.DB.all("SELECT COUNT(*) AS n FROM install_state")[0].n, 1);

  // Missing AE binding still returns the legacy 503 for legacy events only.
  const noAnalytics = makeEnv({ db: createMockD1(), analytics: undefined, adminToken: TOKEN });
  const legacy = await postEvent(noAnalytics, makeEvent("install_seen"));
  assert.equal(legacy.status, 503);
  assert.match(await legacy.text(), /telemetry_unavailable/);
});

// ---------------------------------------------------------------------------
// Admin API: authentication and parameters
// ---------------------------------------------------------------------------

test("the AI usage endpoint denies by default", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });

  const noToken = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/ai-usage"),
    env
  );
  assert.equal(noToken.status, 401);

  const wrongToken = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/ai-usage", { token: "wrong" }),
    env
  );
  assert.equal(wrongToken.status, 401);

  const unsetSecret = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/ai-usage", { token: TOKEN }),
    makeEnv({ db, adminToken: null })
  );
  assert.equal(unsetSecret.status, 503);
  assert.deepEqual(await unsetSecret.json(), { error: "admin_unavailable" });
});

test("the AI usage endpoint carries the admin security headers", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  for (const path of [
    "/admin/api/ai-usage",
    "/admin/api/ai-usage?window=7d",
    "/admin/api/ai-usage?window=bogus",
    "/admin/api/ai-usage?platform=ios"
  ]) {
    const response = await worker.fetch(
      makeRequest("https://telemetry.test" + path, { token: TOKEN }),
      env
    );
    assert.match(response.headers.get("cache-control") || "", /no-store/, path);
    assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/, path);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer", path);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(response.headers.get("access-control-allow-origin"), null, path);
  }
});

test("window and platform accept only the fixed allow-lists", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });

  for (const window of ["24h", "7d", "30d"]) {
    const response = await adminGet(env, "?window=" + window);
    assert.equal(response.status, 200, window);
    assert.equal((await response.json()).window, window);
  }
  for (const window of ["1h", "90d", "all", "", "24H", "24h;DROP TABLE ai_usage"]) {
    const response = await adminGet(env, "?window=" + encodeURIComponent(window));
    assert.equal(response.status, 400, window);
    const body = await response.json();
    assert.equal(body.error, "invalid_window");
    assert.deepEqual(body.allowed_windows, ["24h", "7d", "30d"]);
  }

  for (const platform of ["all", "web", "android"]) {
    const response = await adminGet(env, "?platform=" + platform);
    assert.equal(response.status, 200, platform);
    assert.equal((await response.json()).platform, platform);
  }
  for (const platform of ["ios", "miniprogram", "android' OR 1=1 --", "ALL", ""]) {
    const response = await adminGet(env, "?platform=" + encodeURIComponent(platform));
    assert.equal(response.status, 400, platform);
    const body = await response.json();
    assert.equal(body.error, "invalid_platform");
    assert.deepEqual(body.allowed_platforms, ["all", "web", "android"]);
  }

  // Defaults when both parameters are omitted.
  const defaults = await (await adminGet(env, "")).json();
  assert.equal(defaults.window, "24h");
  assert.equal(defaults.platform, "all");
});

test("parseAiUsageQuery never echoes caller SQL and rejects unknown values", () => {
  const ok = parseAiUsageQuery(new URLSearchParams("window=7d&platform=web"));
  assert.deepEqual(ok, { ok: true, window: "7d", platform: "web", seconds: 7 * DAY });

  const badWindow = parseAiUsageQuery(new URLSearchParams("window=1y"));
  assert.equal(badWindow.ok, false);
  assert.equal(badWindow.error, "invalid_window");

  const badPlatform = parseAiUsageQuery(new URLSearchParams("platform=ios"));
  assert.equal(badPlatform.ok, false);
  assert.equal(badPlatform.error, "invalid_platform");
});

test("the AI usage endpoint rejects non-GET methods", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  const response = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/ai-usage", { method: "POST", body: {}, token: TOKEN }),
    env
  );
  assert.equal(response.status, 405);
  const body = await response.json();
  assert.equal(body.error, "method_not_allowed");
});

// ---------------------------------------------------------------------------
// Admin API: aggregation and filters
// ---------------------------------------------------------------------------

test("an empty table reports zeros, not an error", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  const response = await adminGet(env, "?window=24h&platform=all");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.module, "ai_usage");
  assert.equal(body.available, true);
  assert.deepEqual(body.summary, {
    requests: 0,
    conversation_rounds: 0,
    compression_requests: 0,
    total_tokens: 0,
    unknown_usage_requests: 0,
    known_usage_requests: 0
  });
  assert.deepEqual(body.models, []);
  assert.equal(body.truncated, false);
  assert.equal(body.generated_at, Math.floor(now / 1000));
});

test("a D1 failure is reported as unavailable instead of zeros", async () => {
  const env = makeEnv({ db: failingD1(), adminToken: TOKEN });
  const response = await adminGet(env, "?window=24h");
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.module, "ai_usage");
  assert.equal(body.available, false);
  assert.equal(body.error, "ai_usage_unavailable");
  assert.equal(body.summary, undefined);
  assert.equal(body.models, undefined);
});

test("a missing D1 binding is unavailable, never an empty success", async () => {
  const env = makeEnv({ db: undefined, adminToken: TOKEN });
  const response = await adminGet(env, "?window=24h");
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.available, false);
  assert.equal(body.error, "ai_usage_unavailable");
});

test("summary counts requests, rounds, compression and known/unknown token totals", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  const nowSec = Math.floor(now / 1000);
  seedUsage(db, [
    { request_id: "1".repeat(32), model_id: "m-a", platform: "web", usage_kind: "conversation", total_tokens: 100, created_at: nowSec - 60 },
    { request_id: "2".repeat(32), model_id: "m-a", platform: "web", usage_kind: "conversation", total_tokens: 200, created_at: nowSec - 60 },
    // A regeneration is a separate request and therefore a separate round.
    { request_id: "3".repeat(32), model_id: "m-a", platform: "web", usage_kind: "conversation", total_tokens: null, created_at: nowSec - 60 },
    // Compression consumes tokens but adds no conversation round.
    { request_id: "4".repeat(32), model_id: "m-a", platform: "web", usage_kind: "compression", total_tokens: 50, created_at: nowSec - 60 },
    { request_id: "5".repeat(32), model_id: "m-b", platform: "android", usage_kind: "conversation", total_tokens: 0, created_at: nowSec - 60 }
  ]);

  const body = await (await adminGet(env, "?window=24h&platform=all")).json();
  assert.deepEqual(body.summary, {
    requests: 5,
    conversation_rounds: 4,
    compression_requests: 1,
    total_tokens: 350,
    unknown_usage_requests: 1,
    known_usage_requests: 4
  });
  assert.equal(body.truncated, false);
});

test("unknown usage is counted separately and never silently summed as zero", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  seedUsage(db, [
    { request_id: "a".repeat(32), model_id: "m", platform: "web", usage_kind: "conversation", total_tokens: null },
    { request_id: "b".repeat(32), model_id: "m", platform: "web", usage_kind: "conversation", total_tokens: null }
  ]);
  const body = await (await adminGet(env, "?window=24h")).json();
  assert.equal(body.summary.requests, 2);
  assert.equal(body.summary.conversation_rounds, 2);
  assert.equal(body.summary.total_tokens, 0);
  assert.equal(body.summary.unknown_usage_requests, 2);
  assert.equal(body.summary.known_usage_requests, 0);
  assert.match(body.semantics.unknown_usage_requests, /unknown, not zero/);
});

test("model+platform grouping is per pair and sorted by request count", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  const nowSec = Math.floor(now / 1000);
  const make = (id, model, platform, kind, tokens) => ({
    request_id: id.repeat(32), model_id: model, platform, usage_kind: kind,
    total_tokens: tokens, created_at: nowSec - 30
  });
  seedUsage(db, [
    make("1", "model-b", "web", "conversation", 10),
    make("2", "model-b", "web", "conversation", 10),
    make("3", "model-b", "web", "compression", null),
    make("4", "model-a", "android", "conversation", 5),
    make("5", "model-a", "web", "conversation", 7),
    make("6", "model-c", "android", "compression", 1)
  ]);

  const body = await (await adminGet(env, "?window=24h&platform=all")).json();
  assert.equal(body.models.length, 4);
  const byKey = new Map(body.models.map((row) => [row.model_id + "|" + row.platform, row]));
  assert.deepEqual(byKey.get("model-b|web"), {
    model_id: "model-b", platform: "web", requests: 3, conversation_rounds: 2,
    compression_requests: 1, total_tokens: 20, unknown_usage_requests: 1, known_usage_requests: 2
  });
  assert.deepEqual(byKey.get("model-a|android"), {
    model_id: "model-a", platform: "android", requests: 1, conversation_rounds: 1,
    compression_requests: 0, total_tokens: 5, unknown_usage_requests: 0, known_usage_requests: 1
  });
  // Same model on two platforms is two rows, never merged.
  assert.ok(byKey.has("model-a|web"));
  // Ordered by requests DESC, then model_id ASC, then platform ASC.
  assert.deepEqual(body.models.map((row) => [row.model_id, row.platform]), [
    ["model-b", "web"],
    ["model-a", "android"],
    ["model-a", "web"],
    ["model-c", "android"]
  ]);
  // Group sums reconcile with the summary.
  const totals = body.models.reduce((sum, row) => ({
    requests: sum.requests + row.requests,
    total_tokens: sum.total_tokens + row.total_tokens
  }), { requests: 0, total_tokens: 0 });
  assert.equal(totals.requests, body.summary.requests);
  assert.equal(totals.total_tokens, body.summary.total_tokens);
});

test("the platform filter selects only that platform and rebalances the summary", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  seedUsage(db, [
    { request_id: "1".repeat(32), model_id: "m", platform: "web", usage_kind: "conversation", total_tokens: 10 },
    { request_id: "2".repeat(32), model_id: "m", platform: "android", usage_kind: "conversation", total_tokens: 20 },
    { request_id: "3".repeat(32), model_id: "m", platform: "android", usage_kind: "compression", total_tokens: null }
  ]);

  const web = await (await adminGet(env, "?window=24h&platform=web")).json();
  assert.equal(web.summary.requests, 1);
  assert.equal(web.summary.total_tokens, 10);
  assert.deepEqual(web.models.map((row) => row.platform), ["web"]);

  const android = await (await adminGet(env, "?window=24h&platform=android")).json();
  assert.equal(android.summary.requests, 2);
  assert.equal(android.summary.conversation_rounds, 1);
  assert.equal(android.summary.compression_requests, 1);
  assert.equal(android.summary.unknown_usage_requests, 1);
  assert.deepEqual(android.models.map((row) => row.platform), ["android"]);

  const all = await (await adminGet(env, "?window=24h&platform=all")).json();
  assert.equal(all.summary.requests, 3);
  assert.equal(all.summary.total_tokens, 30);
});

test("the window filter uses rolling server-side cutoffs", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  const nowSec = Math.floor(now / 1000);
  seedUsage(db, [
    { request_id: "1".repeat(32), model_id: "m", platform: "web", usage_kind: "conversation", total_tokens: 1, created_at: nowSec - HOUR },
    { request_id: "2".repeat(32), model_id: "m", platform: "web", usage_kind: "conversation", total_tokens: 2, created_at: nowSec - 3 * DAY },
    { request_id: "3".repeat(32), model_id: "m", platform: "web", usage_kind: "conversation", total_tokens: 4, created_at: nowSec - 20 * DAY }
  ]);

  assert.equal((await (await adminGet(env, "?window=24h")).json()).summary.requests, 1);
  assert.equal((await (await adminGet(env, "?window=7d")).json()).summary.requests, 2);
  const thirty = await (await adminGet(env, "?window=30d")).json();
  assert.equal(thirty.summary.requests, 3);
  assert.equal(thirty.summary.total_tokens, 7);
  assert.equal(thirty.window_seconds, 30 * DAY);
});

test("group rows are capped at 200 while the summary keeps the full total", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  const nowSec = Math.floor(now / 1000);
  const statements = [];
  for (let i = 0; i < AI_USAGE_MAX_GROUP_ROWS + 12; i += 1) {
    statements.push(
      `INSERT INTO ai_usage (request_id, model_id, platform, usage_kind, total_tokens, created_at) VALUES
       ('${i.toString(16).padStart(32, "0")}', 'model-${String(i).padStart(3, "0")}', 'web',
        'conversation', 3, ${nowSec - 60})`
    );
  }
  db.exec(statements.join(";\n"));

  const body = await (await adminGet(env, "?window=24h&platform=all")).json();
  assert.equal(body.models.length, AI_USAGE_MAX_GROUP_ROWS);
  assert.equal(body.models_limit, AI_USAGE_MAX_GROUP_ROWS);
  assert.equal(body.truncated, true);
  // The summary is computed by SQL over the whole window, not by summing the
  // truncated page.
  assert.equal(body.summary.requests, AI_USAGE_MAX_GROUP_ROWS + 12);
  assert.equal(body.summary.total_tokens, (AI_USAGE_MAX_GROUP_ROWS + 12) * 3);
});

test("exactly 200 groups are not marked truncated", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  const nowSec = Math.floor(now / 1000);
  const statements = [];
  for (let i = 0; i < AI_USAGE_MAX_GROUP_ROWS; i += 1) {
    statements.push(
      `INSERT INTO ai_usage (request_id, model_id, platform, usage_kind, total_tokens, created_at) VALUES
       ('${i.toString(16).padStart(32, "0")}', 'model-${i}', 'web', 'conversation', 1, ${nowSec - 60})`
    );
  }
  db.exec(statements.join(";\n"));

  const body = await (await adminGet(env, "?window=24h")).json();
  assert.equal(body.models.length, AI_USAGE_MAX_GROUP_ROWS);
  assert.equal(body.truncated, false);
});

test("the response never contains identifiers, SQL or caller input", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  seedUsage(db, [
    { request_id: "f".repeat(32), model_id: "deepseek-v4", platform: "web", usage_kind: "conversation", total_tokens: 5 }
  ]);
  const response = await adminGet(env, "?window=24h&platform=all");
  const text = await response.text();
  assert.doesNotMatch(text, /f{32}/);
  assert.doesNotMatch(text, /install_hash/);
  assert.doesNotMatch(text, /SELECT |INSERT |FROM ai_usage/i);
  assert.doesNotMatch(text, new RegExp(TOKEN));
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

test("the daily cron deletes ai_usage rows older than 90 days", async () => {
  const db = createMockD1();
  const nowSec = Math.floor(now / 1000);
  seedUsage(db, [
    { request_id: "1".repeat(32), model_id: "m", platform: "web", usage_kind: "conversation", total_tokens: 1, created_at: nowSec - 89 * DAY },
    { request_id: "2".repeat(32), model_id: "m", platform: "web", usage_kind: "conversation", total_tokens: 1, created_at: nowSec - 90 * DAY - 1 },
    { request_id: "3".repeat(32), model_id: "m", platform: "web", usage_kind: "conversation", total_tokens: 1, created_at: nowSec - 200 * DAY }
  ]);

  await worker.scheduled({ scheduledTime: now }, makeEnv({ db, adminToken: TOKEN }));

  assert.deepEqual(rows(db).map((row) => row.request_id), ["1".repeat(32)]);
});

test("ai_usage retention is independent of the install cleanup failing", async () => {
  const db = createMockD1();
  const nowSec = Math.floor(now / 1000);
  seedUsage(db, [
    { request_id: "a".repeat(32), model_id: "m", platform: "web", usage_kind: "conversation", total_tokens: 1, created_at: nowSec - 100 * DAY }
  ]);

  // A DB facade whose install_state delete always fails but whose ai_usage
  // statements work: proves the two cleanups do not share a failure path.
  const guarded = {
    prepare(sql) {
      if (/install_state/i.test(sql)) {
        return { bind() { return { run: async () => { throw new Error("install cleanup failed"); } }; } };
      }
      return db.prepare(sql);
    }
  };

  await assert.doesNotReject(worker.scheduled({ scheduledTime: now }, makeEnv({ db: guarded, adminToken: TOKEN })));
  assert.equal(db.all("SELECT COUNT(*) AS n FROM ai_usage")[0].n, 0);
});

test("ai_usage cleanup is a no-op without D1 and never throws", async () => {
  assert.equal(await cleanupAiUsage(makeEnv({ db: undefined })), 0);
  await assert.doesNotReject(worker.scheduled({ scheduledTime: now }, makeEnv({ db: undefined })));
});

test("retention deletes only ai_usage rows and leaves install_state intact", async () => {
  const db = createMockD1();
  const nowSec = Math.floor(now / 1000);
  db.exec(`INSERT INTO install_state
    (install_hash, app_version, version_code, locale, android_major, platform, first_seen_at, last_seen_at)
    VALUES ('${"a".repeat(64)}', '1.5.2', 42, 'zh-CN', 35, 'android', ${nowSec}, ${nowSec})`);
  seedUsage(db, [
    { request_id: "b".repeat(32), model_id: "m", platform: "web", usage_kind: "conversation", total_tokens: 1, created_at: nowSec - 120 * DAY }
  ]);

  await worker.scheduled({ scheduledTime: now }, makeEnv({ db, adminToken: TOKEN }));

  assert.equal(db.all("SELECT COUNT(*) AS n FROM ai_usage")[0].n, 0);
  assert.equal(db.all("SELECT COUNT(*) AS n FROM install_state")[0].n, 1);
});

// ---------------------------------------------------------------------------
// Isolation from the other admin modules
// ---------------------------------------------------------------------------

test("the AI panel failure does not change stats or announcements", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, adminToken: TOKEN });
  await worker.fetch(makeRequest("https://telemetry.test/admin/api/ai-usage"), env);

  const stats = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/stats", { token: TOKEN }),
    env
  );
  assert.equal(stats.status, 200);
  assert.equal((await stats.json()).windows.active_24h.count, 0);

  const list = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/announcements", { token: TOKEN }),
    env
  );
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).announcements, []);

  // And the AI endpoint still answers when only D1 is present (no AE config).
  const ai = await adminGet(env, "?window=7d&platform=android");
  assert.equal(ai.status, 200);
});
