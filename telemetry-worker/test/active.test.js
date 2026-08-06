import assert from "node:assert/strict";
import test from "node:test";

import worker, { __test } from "../src/index.js";
import {
  createMockD1,
  failingD1,
  makeEnv,
  makeEvent,
  makeRequest,
  mockAnalytics
} from "./helpers.js";

let now = 1_700_000_000_000;

test.beforeEach(() => {
  now = 1_700_000_000_000;
  __test.setClockForTesting(() => now);
  __test.resetRateLimits();
});

test.after(() => {
  __test.resetClock();
  __test.resetRateLimits();
});

async function postActive(env, overrides = {}, options = {}) {
  const request = makeRequest(
    "https://telemetry.test/v1/events",
    {
      method: "POST",
      body: makeEvent("app_active", { version_code: 4, ...overrides }),
      ...options
    }
  );
  return worker.fetch(request, env);
}

function installRows(db) {
  return db.all("SELECT * FROM install_state ORDER BY install_hash");
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const INSTALL_A = "a".repeat(64);

test("app_active creates a new install row with first and last seen equal", async () => {
  const db = createMockD1();
  const analytics = mockAnalytics();
  const response = await postActive(makeEnv({ db, analytics }));

  assert.equal(response.status, 204);
  const rows = installRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version_code, 4);
  assert.equal(rows[0].first_seen_at, Math.floor(now / 1000));
  assert.equal(rows[0].last_seen_at, Math.floor(now / 1000));
  assert.equal(analytics.points.length, 1);
  assert.equal(analytics.points[0].blobs[0], "app_active");
});

test("same version within six hours is deduped: 204 with no D1 write", async () => {
  const db = createMockD1();
  const first = await postActive(makeEnv({ db, analytics: mockAnalytics() }), { install_hash: INSTALL_A });
  assert.equal(first.status, 204);
  const before = installRows(db)[0];

  now += SIX_HOURS_MS - 1000;
  const deduped = await postActive(makeEnv({ db, analytics: mockAnalytics() }), { install_hash: INSTALL_A });
  assert.equal(deduped.status, 204);
  const rows = installRows(db);
  assert.equal(rows.length, 1);
  const after = rows[0];
  assert.equal(after.last_seen_at, before.last_seen_at);
  assert.equal(after.first_seen_at, before.first_seen_at);
});

test("same version after six hours is written again", async () => {
  const db = createMockD1();
  await postActive(makeEnv({ db, analytics: mockAnalytics() }), { install_hash: INSTALL_A });

  now += SIX_HOURS_MS;
  const response = await postActive(makeEnv({ db, analytics: mockAnalytics() }), { install_hash: INSTALL_A });
  assert.equal(response.status, 204);
  const rows = installRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].last_seen_at, Math.floor(now / 1000));
  assert.equal(rows[0].first_seen_at, Math.floor(now / 1000) - 6 * 60 * 60);
});

test("a version change reports immediately and moves the install to the new group", async () => {
  const db = createMockD1();
  await postActive(makeEnv({ db, analytics: mockAnalytics() }), {
    install_hash: INSTALL_A,
    version_code: 3
  });

  now += 1000; // only one second later — version change must not be deduped
  const response = await postActive(makeEnv({ db, analytics: mockAnalytics() }), {
    install_hash: INSTALL_A,
    version_code: 4
  });
  assert.equal(response.status, 204);

  const rows = installRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version_code, 4);
  assert.equal(rows[0].app_version, "1.2.0");
  assert.equal(rows[0].last_seen_at, Math.floor(now / 1000));
  // first_seen_at is preserved across upgrades.
  assert.equal(rows[0].first_seen_at, Math.floor(now / 1000) - 1);
});

test("two distinct installs stay separate rows", async () => {
  const db = createMockD1();
  await postActive(makeEnv({ db, analytics: mockAnalytics() }));
  await postActive(makeEnv({ db, analytics: mockAnalytics() }), { install_hash: "f".repeat(64) });

  assert.equal(installRows(db).length, 2);
});

async function postEvent(env, body) {
  const request = makeRequest("https://telemetry.test/v1/events", {
    method: "POST",
    body
  });
  return worker.fetch(request, env);
}

test("a legacy v1.1 daily_active creates install_state with unknown version", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics() });

  const response = await postEvent(env, makeEvent("daily_active", {
    install_hash: INSTALL_A,
    app_version: "1.1"
  }));

  assert.equal(response.status, 204);
  const rows = installRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].install_hash, INSTALL_A);
  assert.equal(rows[0].version_code, 0);
  assert.equal(rows[0].app_version, "1.1");
  assert.equal(rows[0].first_seen_at, Math.floor(now / 1000));
  assert.equal(rows[0].last_seen_at, Math.floor(now / 1000));
});

test("repeated legacy daily_active within six hours is not written again", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics() });

  await postEvent(env, makeEvent("daily_active", { install_hash: INSTALL_A, app_version: "1.1" }));
  const before = installRows(db)[0];

  now += SIX_HOURS_MS - 1000;
  const response = await postEvent(env, makeEvent("daily_active", { install_hash: INSTALL_A, app_version: "1.1" }));
  assert.equal(response.status, 204);

  const rows = installRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].last_seen_at, before.last_seen_at);
});

test("a legacy daily_active followed by app_active migrates the install version", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics() });
  const firstSeen = Math.floor(now / 1000);

  await postEvent(env, makeEvent("daily_active", { install_hash: INSTALL_A, app_version: "1.1" }));

  now += 1000;
  const response = await postEvent(env, makeEvent("app_active", {
    install_hash: INSTALL_A,
    app_version: "1.2.0",
    version_code: 4
  }));
  assert.equal(response.status, 204);

  const rows = installRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version_code, 4);
  assert.equal(rows[0].app_version, "1.2.0");
  // first_seen_at is preserved; last_seen_at moved to the app_active time.
  assert.equal(rows[0].first_seen_at, firstSeen);
  assert.equal(rows[0].last_seen_at, Math.floor(now / 1000));
});

test("install_seen and reading_completed never write install_state", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, analytics: mockAnalytics() });

  const install = await postEvent(env, makeEvent("install_seen", { install_hash: INSTALL_A }));
  assert.equal(install.status, 204);
  const reading = await postEvent(env, makeEvent("reading_completed", {
    install_hash: INSTALL_A,
    deck_type: "tarot",
    card_count: 3
  }));
  assert.equal(reading.status, 204);

  assert.equal(installRows(db).length, 0);
});

test("app_active without a D1 binding returns a retryable 503", async () => {
  const analytics = mockAnalytics();
  const response = await postActive(makeEnv({ db: undefined, analytics }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "d1_write_failed" });
  // The Analytics Engine point is still written; the retry is cheap.
  assert.equal(analytics.points.length, 1);
});

test("a failing D1 returns 503 rather than pretending success", async () => {
  const response = await postActive(makeEnv({ db: failingD1(), analytics: mockAnalytics() }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "d1_write_failed" });
});

test("an Analytics Engine failure for app_active still returns 503", async () => {
  const analytics = {
    writeDataPoint() {
      throw new Error("boom");
    }
  };
  const response = await postActive(makeEnv({ db: createMockD1(), analytics }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "telemetry_write_failed" });
});

test("legacy events keep working without a D1 binding", async () => {
  const analytics = mockAnalytics();
  const request = makeRequest("https://telemetry.test/v1/events", {
    method: "POST",
    body: makeEvent("install_seen")
  });
  const response = await worker.fetch(request, makeEnv({ db: undefined, analytics }));

  assert.equal(response.status, 204);
});

test("app_active rejects missing, zero and out-of-range version_code", async () => {
  const env = makeEnv({ db: createMockD1(), analytics: mockAnalytics() });

  const missing = makeRequest("https://telemetry.test/v1/events", {
    method: "POST",
    body: makeEvent("app_active")
  });
  assert.equal((await worker.fetch(missing, env)).status, 400);

  const zero = makeRequest("https://telemetry.test/v1/events", {
    method: "POST",
    body: makeEvent("app_active", { version_code: 0 })
  });
  assert.equal((await worker.fetch(zero, env)).status, 400);

  const huge = makeRequest("https://telemetry.test/v1/events", {
    method: "POST",
    body: makeEvent("app_active", { version_code: 2147483648 })
  });
  assert.equal((await worker.fetch(huge, env)).status, 400);
});

test("app_active rejects forbidden and unknown fields", async () => {
  const env = makeEnv({ db: createMockD1(), analytics: mockAnalytics() });

  const forbidden = makeRequest("https://telemetry.test/v1/events", {
    method: "POST",
    body: makeEvent("app_active", { version_code: 4, card_name: "The Fool" })
  });
  const forbiddenResponse = await worker.fetch(forbidden, env);
  assert.equal(forbiddenResponse.status, 400);

  const unknown = makeRequest("https://telemetry.test/v1/events", {
    method: "POST",
    body: makeEvent("app_active", { version_code: 4, user_agent: "x" })
  });
  assert.equal((await worker.fetch(unknown, env)).status, 400);
});

test("oversized app_active payloads are rejected with 413", async () => {
  const request = makeRequest("https://telemetry.test/v1/events", {
    method: "POST",
    body: makeEvent("app_active", { version_code: 4, locale: "x".repeat(1500) })
  });
  const response = await worker.fetch(request, makeEnv({ db: createMockD1(), analytics: mockAnalytics() }));

  assert.equal(response.status, 413);
});
