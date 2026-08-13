import assert from "node:assert/strict";
import test from "node:test";

import worker, { __test as workerTest } from "../src/index.js";
import { buildAnalyticsQueries } from "../src/analytics.js";
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

// Standard per-query upstream rows for the fixed 24h query set. Tests that need
// to deviate from the happy path override specific queries before falling back
// to these rows.
function upstreamRowsFor(sql) {
  if (sql.includes("blob9")) {
    return [{ value: "android", count: 3 }];
  }
  if (sql.includes("COUNT(DISTINCT index1)")) {
    return [{ active_estimate: 3 }];
  }
  if (sql.includes("utc_day")) {
    return [{ utc_day: "2026-08-06", count: 4 }];
  }
  if (sql.includes("GROUP BY event")) {
    return [
      { event: "install_seen", count: 5 },
      { event: "daily_active", count: 4 },
      { event: "app_active", count: 2 },
      { event: "reading_completed", count: 6 }
    ];
  }
  if (sql.includes("avg_card_count")) {
    return [{ avg_card_count: 3.5 }];
  }
  if (sql.includes("blob3 AS value")) {
    return [{ value: "tarot", count: 2 }];
  }
  return [{ value: "1.2.0", count: 4 }];
}

function installDefaultAnalyticsFetch({ onCall } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), init };
    calls.push(call);
    if (onCall) return onCall(call, calls.length);

    const sql = String(init.body);
    if (sql.includes("blob9")) {
      return upstreamResponse([{ value: "android", count: 3 }]);
    }
    if (sql.includes("COUNT(DISTINCT index1)")) {
      return upstreamResponse([{ active_estimate: 3 }]);
    }
    if (sql.includes("avg_card_count")) {
      return upstreamResponse([{ avg_card_count: 3.5 }]);
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
  for (const dimension of ["platform", "deck_type", "event", "app_version", "locale", "country", "subdivision"]) {
    assert.ok(result.distributions[dimension]);
    assert.ok(Array.isArray(result.distributions[dimension].rows));
    assert.equal(typeof result.distributions[dimension].truncated, "boolean");
  }
  assert.equal(result.distributions.deck_type.rows[0].value, "tarot");
  assert.equal(result.distributions.platform.rows[0].value, "android");
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
  assert.equal(calls.length, 10);
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

  let contentLengthCancellations = 0;
  const contentLengthSignals = [];
  globalThis.fetch = async (_url, init) => {
    contentLengthSignals.push(init.signal);
    return new Response(new ReadableStream({
    type: "bytes",
    pull() {
      throw new Error("known oversized body must not be read");
    },
    cancel() {
      contentLengthCancellations += 1;
    }
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": "300000"
      }
    });
  };
  const knownOversizedBody = await worker.fetch(
    analyticsRequest({ ip: "198.51.100.30" }),
    analyticsEnv()
  );
  assert.equal(knownOversizedBody.status, 503);
  assert.ok(contentLengthCancellations > 0);
  assert.ok(contentLengthSignals.every((signal) => signal.aborted));

  globalThis.fetch = async () => upstreamResponse(
    Array.from({ length: 101 }, (_, index) => ({ event: "install_seen", count: index }))
  );
  const oversizedRows = await worker.fetch(
    analyticsRequest({ ip: "198.51.100.27" }),
    analyticsEnv()
  );
  assert.equal(oversizedRows.status, 503);
});

test("analytics cancels an unbounded upstream stream as soon as the byte limit is exceeded", async () => {
  let cancelledStreams = 0;
  const bytesByStream = [];
  const streamSignals = [];
  let largestReadRequest = 0;
  globalThis.fetch = async (_url, init) => {
    streamSignals.push(init.signal);
    const streamIndex = bytesByStream.push(0) - 1;
    return new Response(new ReadableStream({
      type: "bytes",
      pull(controller) {
        const request = controller.byobRequest;
        assert.ok(request);
        const view = request.view;
        largestReadRequest = Math.max(largestReadRequest, view.byteLength);
        view.fill(120);
        bytesByStream[streamIndex] += view.byteLength;
        request.respond(view.byteLength);
      },
      cancel() {
        cancelledStreams += 1;
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const response = await worker.fetch(
    analyticsRequest({ ip: "198.51.100.29" }),
    analyticsEnv()
  );
  assert.equal(response.status, 503);
  assert.equal(cancelledStreams, bytesByStream.length);
  assert.ok(streamSignals.every((signal) => signal.aborted));
  assert.ok(largestReadRequest <= 64 * 1024);
  assert.ok(
    bytesByStream.every((bytes) => bytes <= 256 * 1024 + 1),
    `expected each stream to stop at the one-byte limit probe, received ${bytesByStream.join(",")} bytes`
  );
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
  assert.equal(second.status, 200);
  const secondJson = await second.json();
  assert.equal(secondJson.available, true);
  assert.equal(secondJson.partial, true);
  assert.equal(secondJson.distributions.deck_type, null);
  assert.deepEqual(secondJson.failed_sections, ["deck_type"]);
});

test("reading_metrics SQL is a direct weighted average without an outer IF", () => {
  const queries = buildAnalyticsQueries("24h");
  assert.ok(queries, "24h query set is exposed for audits");
  assert.match(
    queries.reading_metrics,
    /SUM\(_sample_interval \* double1\) \/ SUM\(_sample_interval\) AS avg_card_count/
  );
  assert.doesNotMatch(queries.reading_metrics, /\bIF\s*\(/);
  assert.doesNotMatch(queries.reading_metrics, /AS reading_completed/);
});

test("platform analytics groups active installs and falls back old empty slots to android", () => {
  const queries = buildAnalyticsQueries("24h");
  assert.match(queries.platform, /if\(blob9 = '', 'android', blob9\)/);
  assert.match(queries.platform, /COUNT\(DISTINCT index1\) AS count/);
  assert.match(queries.platform, /daily_active/);
  assert.match(queries.platform, /app_active/);
});

test("analytics platform filter is closed and scopes every fixed query", async () => {
  const allQueries = buildAnalyticsQueries("24h", "all");
  const androidQueries = buildAnalyticsQueries("24h", "android");
  const miniQueries = buildAnalyticsQueries("24h", "miniprogram");
  const gameQueries = buildAnalyticsQueries("24h", "minigame");
  assert.ok(allQueries && androidQueries && miniQueries && gameQueries);
  assert.equal(buildAnalyticsQueries("24h", "web"), null);
  Object.values(androidQueries).forEach((sql) => {
    assert.match(sql, /if\(blob9 = '', 'android', blob9\) = 'android'/);
  });
  Object.values(miniQueries).forEach((sql) => {
    assert.match(sql, /blob9 = 'miniprogram'/);
  });
  Object.values(gameQueries).forEach((sql) => {
    assert.match(sql, /blob9 = 'minigame'/);
  });

  const calls = installDefaultAnalyticsFetch();
  const response = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/analytics?window=24h&platform=miniprogram", {
      token: ADMIN_TOKEN,
      ip: "198.51.100.44"
    }),
    analyticsEnv()
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.platform, "miniprogram");
  assert.ok(calls.length > 0);
  calls.forEach(({ init }) => assert.match(String(init.body), /blob9 = 'miniprogram'/));

  const gameCalls = installDefaultAnalyticsFetch();
  const gameResponse = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/analytics?window=7d&platform=minigame", {
      token: ADMIN_TOKEN,
      ip: "198.51.100.46"
    }),
    analyticsEnv()
  );
  assert.equal(gameResponse.status, 200);
  const gameResult = await gameResponse.json();
  assert.equal(gameResult.platform, "minigame");
  assert.ok(gameCalls.length > 0);
  gameCalls.forEach(({ init }) => assert.match(String(init.body), /blob9 = 'minigame'/));

  const invalid = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/analytics?window=24h&platform=web", {
      token: ADMIN_TOKEN,
      ip: "198.51.100.45"
    }),
    analyticsEnv()
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    error: "invalid_platform",
    module: "analytics",
    allowed_platforms: ["all", "android", "miniprogram", "minigame"]
  });
});

test("no reading data yields a null average without marking the section failed", async () => {
  globalThis.fetch = async (_url, init) => {
    const sql = String(init.body);
    if (sql.includes("avg_card_count")) return upstreamResponse([]);
    return upstreamResponse(upstreamRowsFor(sql));
  };
  const response = await worker.fetch(analyticsRequest(), analyticsEnv());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.available, true);
  assert.equal(result.partial, false);
  assert.equal(result.reading_completed_average_card_count, null);
  assert.deepEqual(result.failed_sections, []);
});

test("a single reading_metrics failure returns 200 partial with other data intact", async () => {
  globalThis.fetch = async (_url, init) => {
    const sql = String(init.body);
    if (sql.includes("avg_card_count")) throw new Error("reading metrics upstream failed");
    return upstreamResponse(upstreamRowsFor(sql));
  };
  const response = await worker.fetch(analyticsRequest(), analyticsEnv());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.available, true);
  assert.equal(result.partial, true);
  assert.deepEqual(result.failed_sections, ["reading_metrics"]);
  assert.equal(result.reading_completed_average_card_count, null);
  assert.equal(result.install_seen, 5);
  assert.equal(result.reading_completed, 6);
  assert.equal(result.active_estimate, 3);
  assert.ok(result.distributions.deck_type);
  assert.ok(result.daily_trend);
});

test("a few failures keep the successful analytics sections intact", async () => {
  globalThis.fetch = async (_url, init) => {
    const sql = String(init.body);
    if (sql.includes("avg_card_count")) throw new Error("reading metrics failed");
    if (sql.includes("blob4 AS value")) throw new Error("country failed");
    return upstreamResponse(upstreamRowsFor(sql));
  };
  const response = await worker.fetch(analyticsRequest(), analyticsEnv());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.available, true);
  assert.equal(result.partial, true);
  assert.deepEqual(result.failed_sections, ["reading_metrics", "country"]);
  assert.equal(result.install_seen, 5);
  assert.equal(result.reading_completed, 6);
  assert.equal(result.active_estimate, 3);
  assert.equal(result.distributions.deck_type.rows[0].value, "tarot");
  assert.equal(result.distributions.country, null);
  assert.equal(result.reading_completed_average_card_count, null);
  assert.ok(result.daily_trend.rows.length >= 1);
});

test("analytics returns 503 available=false only when every section fails", async () => {
  globalThis.fetch = async () => {
    throw new Error("all upstream queries failed");
  };
  const response = await worker.fetch(analyticsRequest(), analyticsEnv());
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.available, false);
  assert.equal(result.partial, false);
  assert.equal(result.error, "analytics_unavailable");
  assert.equal(result.failed_sections.length, 10);
  assert.equal(result.install_seen, null);
  assert.equal(result.reading_completed, null);
  assert.equal(result.active_estimate, null);
  assert.equal(result.reading_completed_average_card_count, null);
  assert.equal(result.daily_trend, null);
});

test("partial responses never leak secrets, SQL, index1, or install hashes", async () => {
  globalThis.fetch = async (_url, init) => {
    const sql = String(init.body);
    if (sql.includes("avg_card_count")) throw new Error("secret " + READ_TOKEN);
    return upstreamResponse(upstreamRowsFor(sql));
  };
  const response = await worker.fetch(analyticsRequest(), analyticsEnv());
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, new RegExp(READ_TOKEN));
  assert.doesNotMatch(text, /quareia_telemetry|SELECT |SUM\(_sample_interval\)|FROM /);
  assert.doesNotMatch(text, /index1|install_hash|[a-f0-9]{64}/i);
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
