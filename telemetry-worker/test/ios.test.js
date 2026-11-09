import assert from "node:assert/strict";
import test from "node:test";

import worker, { __test } from "../src/index.js";
import { createMockD1, makeEnv, makeRequest, mockAnalytics } from "./helpers.js";

const INSTALL = "9".repeat(64);
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let now = 1_800_000_000_000;

test.beforeEach(() => {
  now = 1_800_000_000_000;
  __test.setClockForTesting(() => now);
  __test.resetRateLimits();
});

test.after(() => {
  __test.resetClock();
  __test.resetRateLimits();
});

function iosEvent(event, overrides = {}) {
  return {
    schema_version: 1,
    event,
    install_hash: INSTALL,
    app_version: "1.0.0",
    locale: "en-US",
    platform: "ios",
    ios_major: 17,
    ...overrides
  };
}

async function post(body, env) {
  return worker.fetch(makeRequest("https://telemetry.test/v1/events", {
    method: "POST",
    body
  }), env);
}

test("iOS events require a real integer OS major and append only Analytics double3", async () => {
  const analytics = mockAnalytics();
  const response = await post(iosEvent("reading_completed", {
    deck_type: "tarot",
    card_count: 4
  }), makeEnv({ db: createMockD1(), analytics }));

  assert.equal(response.status, 204);
  assert.equal(analytics.points.length, 1);
  assert.deepEqual(analytics.points[0].blobs.slice(6), ["1.0.0", "en-US", "ios", ""]);
  assert.deepEqual(analytics.points[0].doubles, [4, 0, 17]);
  assert.deepEqual(analytics.points[0].indexes, [INSTALL]);

  for (const iosMajor of [undefined, null, 0, 17.5, 101]) {
    const event = iosEvent("install_seen", { ios_major: iosMajor });
    if (iosMajor === undefined) delete event.ios_major;
    const invalid = await post(event, makeEnv({ db: createMockD1(), analytics: mockAnalytics() }));
    assert.equal(invalid.status, 400, `ios_major=${String(iosMajor)}`);
    assert.match(await invalid.text(), /ios_major/);
  }

  assert.equal((await post(
    iosEvent("install_seen", { android_major: 35 }),
    makeEnv({ db: createMockD1(), analytics: mockAnalytics() })
  )).status, 400);
  assert.equal((await post(
    iosEvent("install_seen", { env_version: "release" }),
    makeEnv({ db: createMockD1(), analytics: mockAnalytics() })
  )).status, 400);
  assert.equal((await post(
    { ...iosEvent("install_seen"), platform: "android" },
    makeEnv({ db: createMockD1(), analytics: mockAnalytics() })
  )).status, 400);
});

test("iOS app_active requires the real positive integer build", async () => {
  const env = makeEnv({ db: createMockD1(), analytics: mockAnalytics() });
  for (const build of [undefined, null, 0, 1.5, 2147483648]) {
    const event = iosEvent("app_active", { version_code: build });
    if (build === undefined) delete event.version_code;
    const response = await post(event, env);
    assert.equal(response.status, 400, `version_code=${String(build)}`);
    assert.match(await response.text(), /version_code/);
  }
  assert.equal((await post(iosEvent("app_active", { version_code: 42 }), env)).status, 204);
});

test("iOS native-build upsert preserves first_seen across dedupe and upgrades", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics() });
  const firstSeen = Math.floor(now / 1000);

  assert.equal((await post(iosEvent("app_active", { version_code: 41 }), env)).status, 204);
  let row = db.all("SELECT * FROM install_state WHERE install_hash = ?", INSTALL)[0];
  assert.deepEqual({
    platform: row.platform,
    version_code: row.version_code,
    android_major: row.android_major,
    ios_major: row.ios_major,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at
  }, {
    platform: "ios",
    version_code: 41,
    android_major: 0,
    ios_major: 17,
    first_seen_at: firstSeen,
    last_seen_at: firstSeen
  });

  now += SIX_HOURS_MS - 1000;
  await post(iosEvent("app_active", { version_code: 41 }), env);
  row = db.all("SELECT * FROM install_state WHERE install_hash = ?", INSTALL)[0];
  assert.equal(row.last_seen_at, firstSeen);

  now += 1000;
  await post(iosEvent("app_active", {
    app_version: "1.1.0",
    version_code: 42,
    ios_major: 18
  }), env);
  row = db.all("SELECT * FROM install_state WHERE install_hash = ?", INSTALL)[0];
  assert.equal(row.version_code, 42);
  assert.equal(row.app_version, "1.1.0");
  assert.equal(row.ios_major, 18);
  assert.equal(row.first_seen_at, firstSeen);
  assert.equal(row.last_seen_at, Math.floor(now / 1000));
});

test("an unversioned active event cannot downgrade a real native build", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics() });
  await post(iosEvent("app_active", { version_code: 42 }), env);

  now += SIX_HOURS_MS;
  const response = await post(iosEvent("daily_active", {
    app_version: "legacy-label",
    ios_major: 18
  }), env);
  assert.equal(response.status, 204);
  const row = db.all("SELECT * FROM install_state WHERE install_hash = ?", INSTALL)[0];
  assert.equal(row.version_code, 42);
  assert.equal(row.app_version, "1.0.0");
  assert.equal(row.ios_major, 18);
  assert.equal(row.first_seen_at, 1_800_000_000);
  assert.equal(row.last_seen_at, Math.floor(now / 1000));
});

test("per-window stats keep iOS native builds separate from Android", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics(), adminToken: "test-admin-token" });
  await post(iosEvent("app_active", { version_code: 42 }), env);
  const android = {
    schema_version: 1,
    event: "app_active",
    install_hash: "a".repeat(64),
    app_version: "1.0.0",
    locale: "en-US",
    platform: "android",
    android_major: 35,
    version_code: 42
  };
  await post(android, env);

  const response = await worker.fetch(makeRequest(
    "https://telemetry.test/admin/api/stats",
    { token: "test-admin-token" }
  ), env);
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.deepEqual(stats.version_distribution.active_24h, [
    { platform: "android", env_version: "", version_code: 42, app_version: "1.0.0", installs: 1, percent: 50 },
    { platform: "ios", env_version: "", version_code: 42, app_version: "1.0.0", installs: 1, percent: 50 }
  ]);
  assert.deepEqual(stats.platform_distribution.active_24h, [
    { platform: "android", env_version: "", installs: 1, percent: 50 },
    { platform: "ios", env_version: "", installs: 1, percent: 50 }
  ]);
});
