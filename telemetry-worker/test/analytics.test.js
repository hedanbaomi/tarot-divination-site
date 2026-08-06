import assert from "node:assert/strict";
import test from "node:test";

import worker, { __test as workerTest } from "../src/index.js";
import { createMockD1, makeEnv, makeRequest } from "./helpers.js";

const ADMIN_TOKEN = "test-admin-token";
const READ_TOKEN = "analytics-read-token";
const ACCOUNT_ID = "a".repeat(32);
const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  workerTest.setClockForTesting(() => 1_700_000_000_000);
  workerTest.resetRateLimits();
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test.after(() => {
  workerTest.resetClock();
  workerTest.resetRateLimits();
});

function analyticsEnv(overrides = {}) {
  return makeEnv({
    db: createMockD1(),
    adminToken: ADMIN_TOKEN,
    overrides: {
      ACCOUNT_ID,
      ANALYTICS_READ_TOKEN: READ_TOKEN,
      ...overrides
    }
  });
}

function analyticsRequest({ token = ADMIN_TOKEN, window = "24h", ip = "198.51.100.20" } = {}) {
  const suffix = window === null ? "" : `?window=${window}`;
  return makeRequest(`https://telemetry.test/admin/api/analytics${suffix}`, {
    token,
    ip
  });
}

function upstreamResponse(rows, { status = 200, body, headers } = {}) {
  const payload = body === undefined
    ? JSON.stringify({ success: true, result: { data: rows } })
    : body;
  return new Response(payload, {
    status,
    headers: {
      "content-type": "application/json",
      ...(headers || {})
    }
  });
}

function installDefaultAnalyticsFetch({ onCall } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), init };
    calls.push(call);
    if (onCall) return onCall(call, calls.length);

    const sql = String(init.body);
    if (sql.includes("COUNT(DISTINCT index1)")) {
      return upstreamResponse([{ active_estimate: 3 }]);
    }
    if (sql.includes("avg_card_count")) {
      return upstreamResponse([{ reading_completed: 2, avg_card_count: 3.5 }]);
    }
    if (sql.includes("utc_day")) {
      return upstreamResponse([{ utc_day: "2026-08-06", count: 4 }]);
    }
    if (sql.includes("GROUP BY event")) {
      return upstreamResponse([
        { event: "install_seen", count: 5 },
        { event: "daily_active", count: 4 },
        { event: "app_active", count: 2 },
        { event: "reading_completed", count: 2 }
      ]);
    }
    if (sql.includes("blob3 AS value")) {
      return upstreamResponse([{ value: "tarot", count: 2 }]);
    }
    return upstreamResponse([{ value: "1.2.0", count: 4 }]);
  };
  return calls;
}

test("analytics returns weighted summary, fixed distributions, and a UTC daily trend", async () => {
  const calls = installDefaultAnalyticsFetch();
  const response = await worker.fetch(analyticsRequest(), analyticsEnv());

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.module, "analytics");
  assert.equal(result.available, true);
  assert.equal(result.window, "24h");
  assert.equal(result.install_seen, 5);
  assert.equal(result.reading_completed, 2);
  assert.equal(result.active_estimate, 3);
  assert.equal(result.active_estimate_meta.estimated, true);
  assert.deepEqual(result.active_estimate_meta.event_types, ["daily_active", "app_active"]);
  assert.equal(result.reading_completed_average_card_count, 3.5);
  for (const dimension of ["deck_type", "event", "app_version", "locale", "country", "subdivision"]) {
    assert.ok(result.distributions[dimension]);
    assert.ok(Array.isArray(result.distributions[dimension].rows));
    assert.equal(typeof result.distributions[dimension].truncated, "boolean");
  }
  assert.equal(result.distributions.deck_type.rows[0].value, "tarot");
  assert.equal(result.distributions.event.rows[0].value, "install_seen");
  assert.equal(result.distributions.app_version.basis, "first_report_snapshot");
  assert.equal(result.distributions.locale.basis, "first_report_snapshot");
  assert.equal(result.distributions.country.basis, "first_report_snapshot");
  assert.ok(Array.isArray(result.daily_trend.rows));
  assert.equal(result.daily_trend.window_basis, "rolling_window");
  assert.equal(result.daily_trend.bucket_basis, "utc_day");

  const responseText = JSON.stringify(result);
  assert.doesNotMatch(responseText, /index1|install_hash|[a-f]{64}/i);
  assert.ok(calls.length >= 7);
  for (const call of calls) {
    assert.equal(call.url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`);
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers.Authorization, `Bearer ${READ_TOKEN}`);
    assert.match(String(call.init.body), /quareia_telemetry/);
    if (!String(call.init.body).includes("COUNT(DISTINCT index1)")) {
      assert.match(String(call.init.body), /SUM\(_sample_interval\)/);
    }
  }
});

test("analytics accepts only 24h, 7d, and 30d and interpolates only fixed windows", async () => {
  const calls = installDefaultAnalyticsFetch();
  const sevenDay = await worker.fetch(
    analyticsRequest({ window: "7d", ip: "198.51.100.21" }),
    analyticsEnv()
  );
  assert.equal(sevenDay.status, 200);
  assert.ok(calls.some(({ init }) => String(init.body).includes("INTERVAL '7' DAY")));

  const invalid = await worker.fetch(
    analyticsRequest({ window: "90d", ip: "198.51.100.22" }),
    analyticsEnv()
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    error: "invalid_window",
    module: "analytics",
    allowed_windows: ["24h", "7d", "30d"]
  });
  assert.equal(calls.length, 9);
});

test("analytics authenticates before doing any upstream work", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return upstreamResponse([]);
  };

  const missing = await worker.fetch(
    analyticsRequest({ token: "" }),
    analyticsEnv()
  );
  assert.equal(missing.status, 401);

  const wrong = await worker.fetch(
    analyticsRequest({ token: "wrong", ip: "198.51.100.23" }),
    analyticsEnv()
  );
  assert.equal(wrong.status, 401);
  assert.equal(calls, 0);
});

test("analytics is unavailable when either ordinary account config or read secret is missing", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return upstreamResponse([]);
  };

  const noAccount = await worker.fetch(
    analyticsRequest({ ip: "198.51.100.24" }),
    analyticsEnv({ ACCOUNT_ID: "" })
  );
  assert.equal(noAccount.status, 503);
  assert.equal((await noAccount.json()).error, "analytics_unavailable");

  const noToken = await worker.fetch(
    analyticsRequest({ ip: "198.51.100.25" }),
    analyticsEnv({ ANALYTICS_READ_TOKEN: "" })
  );
  assert.equal(noToken.status, 503);
  assert.equal((await noToken.json()).error, "analytics_unavailable");
  assert.equal(calls, 0);
});

test("analytics limits upstream concurrency", async () => {
  let active = 0;
  let maximum = 0;
  installDefaultAnalyticsFetch({
    onCall: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return upstreamResponse([]);
    }
  });

  const response = await worker.fetch(analyticsRequest(), analyticsEnv());
  assert.equal(response.status, 200);
  assert.ok(maximum <= 3);
});

test("analytics timeout and upstream errors are unavailable without echoing upstream content", async () => {
  globalThis.fetch = async () => {
    const error = new Error("private-upstream-body-and-token");
    error.name = "AbortError";
    throw error;
  };
  const timeout = await worker.fetch(analyticsRequest(), analyticsEnv());
  assert.equal(timeout.status, 503);
  const timeoutText = await timeout.text();
  assert.match(timeoutText, /analytics_unavailable/);
  assert.doesNotMatch(timeoutText, /private-upstream-body-and-token|analytics-read-token/);

  globalThis.fetch = async () => upstreamResponse([], {
    status: 502,
    body: JSON.stringify({ error: "secret upstream response" })
  });
  const error = await worker.fetch(
    analyticsRequest({ ip: "198.51.100.26" }),
    analyticsEnv()
  );
  assert.equal(error.status, 503);
  const errorText = await error.text();
  assert.match(errorText, /analytics_unavailable/);
  assert.doesNotMatch(errorText, /secret upstream response/);
});

test("analytics enforces upstream response body and row limits", async () => {
  globalThis.fetch = async () => upstreamResponse([], {
    body: "x".repeat(300_000)
  });
  const oversizedBody = await worker.fetch(analyticsRequest(), analyticsEnv());
  assert.equal(oversizedBody.status, 503);

  globalThis.fetch = async () => upstreamResponse(
    Array.from({ length: 101 }, (_, index) => ({ event: "install_seen", count: index }))
  );
  const oversizedRows = await worker.fetch(
    analyticsRequest({ ip: "198.51.100.27" }),
    analyticsEnv()
  );
  assert.equal(oversizedRows.status, 503);
});

test("partial query failure becomes null and is never served from a prior response", async () => {
  let failDeck = false;
  installDefaultAnalyticsFetch({
    onCall: async (call) => {
      const sql = String(call.init.body);
      if (failDeck && sql.includes("blob3 AS value")) {
        throw new Error("deck query failed");
      }
      return upstreamResponse([]);
    }
  });

  const first = await worker.fetch(analyticsRequest(), analyticsEnv());
  assert.equal(first.status, 200);

  failDeck = true;
  const second = await worker.fetch(
    analyticsRequest({ ip: "198.51.100.28" }),
    analyticsEnv()
  );
  assert.equal(second.status, 503);
  const secondJson = await second.json();
  assert.equal(secondJson.distributions.deck_type, null);
  assert.deepEqual(secondJson.failed_sections, ["deck_type"]);
});

test("analytics does not require D1 and its failure does not change the D1 stats route", async () => {
  installDefaultAnalyticsFetch();
  const noD1 = await worker.fetch(analyticsRequest(), analyticsEnv({ DB: undefined }));
  assert.equal(noD1.status, 200);

  globalThis.fetch = async () => {
    throw new Error("analytics unavailable");
  };
  const analyticsFailure = await worker.fetch(
    analyticsRequest({ ip: "198.51.100.29" }),
    analyticsEnv()
  );
  assert.equal(analyticsFailure.status, 503);

  const stats = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/stats", { token: ADMIN_TOKEN, ip: "198.51.100.30" }),
    analyticsEnv()
  );
  assert.equal(stats.status, 200);
  assert.deepEqual((await stats.json()).windows.active_24h.count, 0);
});
