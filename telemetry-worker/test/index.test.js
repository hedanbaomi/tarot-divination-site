import assert from "node:assert/strict";
import test from "node:test";

import worker, { __test } from "../src/index.js";
import { createMockD1 } from "./helpers.js";

let sequence = 0;
let now = 1_000_000;

test.beforeEach(() => {
  now = 1_000_000;
  __test.setClockForTesting(() => now);
  __test.resetRateLimits();
});

test.after(() => {
  __test.resetRateLimits();
  __test.resetClock();
});

function nextHash() {
  sequence += 1;
  return sequence.toString(16).padStart(64, "0");
}

function mockAnalytics() {
  return {
    points: [],
    writeDataPoint(point) {
      this.points.push(point);
    }
  };
}

function makeEnv(analytics = mockAnalytics(), overrides = {}) {
  return {
    TELEMETRY: analytics,
    DB: createMockD1(),
    RATE_LIMIT_PER_INSTALL_PER_HOUR: "60",
    RATE_LIMIT_PER_IP_PER_MINUTE: "30",
    ...overrides
  };
}

function makeEvent(event, overrides = {}) {
  return {
    schema_version: 1,
    event,
    install_hash: nextHash(),
    app_version: "1.0",
    locale: "zh-CN",
    android_major: 35,
    ...overrides
  };
}

function makeRequest(
  body,
  {
    ip = "198.51.100.10",
    country = "TW",
    regionCode,
    region,
    forwardedFor,
    cfExtra = {}
  } = {}
) {
  const headers = {
    "content-type": "application/json",
    "cf-connecting-ip": ip
  };
  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
  const request = new Request("https://telemetry.test/v1/events", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  Object.defineProperty(request, "cf", {
    value: { country, regionCode, region, ...cfExtra }
  });
  return request;
}

async function post(event, env, options = {}) {
  return worker.fetch(makeRequest(event, options), env);
}

test("install_seen succeeds with the mock Analytics Engine binding", async () => {
  const analytics = mockAnalytics();
  const response = await post(makeEvent("install_seen"), makeEnv(analytics));

  assert.equal(response.status, 204);
  assert.equal(analytics.points.length, 1);
});

test("daily_active succeeds with the mock Analytics Engine binding", async () => {
  const analytics = mockAnalytics();
  const response = await post(makeEvent("daily_active"), makeEnv(analytics));

  assert.equal(response.status, 204);
  assert.equal(analytics.points.length, 1);
});

for (const deckType of ["tarot", "mystagogus", "lxxxi"]) {
  test(`reading_completed succeeds for ${deckType}`, async () => {
    const analytics = mockAnalytics();
    const response = await post(
      makeEvent("reading_completed", { deck_type: deckType, card_count: 3 }),
      makeEnv(analytics)
    );

    assert.equal(response.status, 204);
    assert.equal(analytics.points.length, 1);
  });
}

test("Analytics Engine arrays use the fixed order and one index", async () => {
  const analytics = mockAnalytics();
  const event = makeEvent("reading_completed", {
    install_hash: "a".repeat(64),
    deck_type: "lxxxi",
    card_count: 8,
    app_version: "2.4.6",
    locale: "en-US",
    android_major: 34
  });

  const response = await post(event, makeEnv(analytics), {
    country: "GB",
    regionCode: "ENG",
    region: "England"
  });

  assert.equal(response.status, 204);
  assert.deepEqual(analytics.points, [{
    blobs: [
      "reading_completed", "a".repeat(64), "lxxxi", "GB", "GB-ENG", "England",
      "2.4.6", "en-US"
    ],
    doubles: [8, 34],
    indexes: ["a".repeat(64)]
  }]);
});

test("non-reading events use empty deck and zero card-count slots", async () => {
  const analytics = mockAnalytics();
  const event = makeEvent("install_seen", { install_hash: "b".repeat(64) });

  await post(event, makeEnv(analytics));

  assert.deepEqual(analytics.points[0].blobs, [
    "install_seen", "b".repeat(64), "", "TW", "", "", "1.0", "zh-CN"
  ]);
  assert.deepEqual(analytics.points[0].doubles, [0, 35]);
  assert.deepEqual(analytics.points[0].indexes, ["b".repeat(64)]);
});

test("forbidden fields are rejected", async () => {
  const analytics = mockAnalytics();
  const event = makeEvent("install_seen", { card_name: "The Fool" });

  const response = await post(event, makeEnv(analytics));

  assert.equal(response.status, 400);
  assert.equal(analytics.points.length, 0);
});

test("unknown fields are rejected", async () => {
  const response = await post(
    makeEvent("daily_active", { unexpected: true }),
    makeEnv()
  );

  assert.equal(response.status, 400);
});

test("UTF-8 oversized requests are rejected by byte length", async () => {
  const event = makeEvent("daily_active", { app_version: "😀".repeat(300) });
  const response = await post(event, makeEnv());

  assert.equal(response.status, 413);
});

test("schema_version must be exactly 1", async () => {
  const response = await post(
    makeEvent("install_seen", { schema_version: 2 }),
    makeEnv()
  );

  assert.equal(response.status, 400);
  assert.match(await response.text(), /unsupported_schema_version/);
});

test("android_major is restricted to a reasonable integer range", async () => {
  const response = await post(
    makeEvent("install_seen", { android_major: 0 }),
    makeEnv()
  );

  assert.equal(response.status, 400);
  assert.match(await response.text(), /invalid_android_major/);
});

test("missing Analytics Engine binding returns 503", async () => {
  const response = await post(makeEvent("install_seen"), {});

  assert.equal(response.status, 503);
  assert.match(await response.text(), /telemetry_unavailable/);
});

test("only a single JSON event object is accepted", async () => {
  const analytics = mockAnalytics();
  const response = await post(
    [makeEvent("install_seen"), makeEvent("daily_active")],
    makeEnv(analytics)
  );

  assert.equal(response.status, 400);
  assert.match(await response.text(), /event_must_be_object/);
  assert.equal(analytics.points.length, 0);
});

test("a synchronous Analytics Engine failure returns 503", async () => {
  const analytics = {
    writeDataPoint() {
      throw new Error("mock write failure");
    }
  };

  const response = await post(makeEvent("install_seen"), makeEnv(analytics));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "telemetry_write_failed" });
});

test("Cloudflare country and first-level subdivision fields are mapped", async () => {
  const analytics = mockAnalytics();
  const response = await post(
    makeEvent("install_seen", { install_hash: "d".repeat(64) }),
    makeEnv(analytics),
    { country: "CN", regionCode: "BJ", region: "Beijing" }
  );

  assert.equal(response.status, 204);
  assert.deepEqual(analytics.points[0].blobs, [
    "install_seen", "d".repeat(64), "", "CN", "CN-BJ", "Beijing", "1.0", "zh-CN"
  ]);
});

test("missing Cloudflare subdivision fields safely fall back to empty strings", async () => {
  const analytics = mockAnalytics();
  const response = await post(
    makeEvent("daily_active", { install_hash: "e".repeat(64) }),
    makeEnv(analytics),
    { country: "CN" }
  );

  assert.equal(response.status, 204);
  assert.deepEqual(analytics.points[0].blobs.slice(3, 6), ["CN", "", ""]);
});

test("region names are capped and forbidden geo fields are never written", async () => {
  const analytics = mockAnalytics();
  const region = "R".repeat(100);
  const response = await post(
    makeEvent("install_seen", { install_hash: "f".repeat(64) }),
    makeEnv(analytics),
    {
      country: "US",
      regionCode: "CA",
      region,
      cfExtra: {
        city: "San Francisco",
        postalCode: "94105",
        latitude: "37.7",
        longitude: "-122.4",
        metroCode: "807"
      }
    }
  );

  assert.equal(response.status, 204);
  assert.equal(analytics.points[0].blobs.length, 8);
  assert.equal(analytics.points[0].blobs[5], "R".repeat(64));
  assert.equal(JSON.stringify(analytics.points[0]), JSON.stringify({
    blobs: [
      "install_seen", "f".repeat(64), "", "US", "US-CA", "R".repeat(64), "1.0", "zh-CN"
    ],
    doubles: [0, 35],
    indexes: ["f".repeat(64)]
  }));
});

for (const field of ["country", "region", "subdivision_code"]) {
  test(`client-supplied ${field} is rejected`, async () => {
    const response = await post(
      makeEvent("install_seen", { [field]: "client-value" }),
      makeEnv()
    );

    assert.equal(response.status, 400);
    assert.match(await response.text(), new RegExp(`unexpected_field:${field}`));
  });
}

test("the trusted CF-Connecting-IP header controls IP rate limiting", async () => {
  const analytics = mockAnalytics();
  const env = makeEnv(analytics, {
    RATE_LIMIT_PER_IP_PER_MINUTE: "1",
    RATE_LIMIT_PER_INSTALL_PER_HOUR: "100"
  });

  const first = await post(
    makeEvent("install_seen"),
    env,
    { ip: "198.51.100.20", forwardedFor: "203.0.113.99" }
  );
  const second = await post(
    makeEvent("install_seen"),
    env,
    { ip: "198.51.100.21", forwardedFor: "203.0.113.99" }
  );

  assert.equal(first.status, 204);
  assert.equal(second.status, 204);
});

test("repeated requests from one CF IP are rate limited", async () => {
  const env = makeEnv(mockAnalytics(), {
    RATE_LIMIT_PER_IP_PER_MINUTE: "2",
    RATE_LIMIT_PER_INSTALL_PER_HOUR: "100"
  });
  const options = { ip: "198.51.100.30" };

  const statuses = [];
  for (let i = 0; i < 3; i += 1) {
    statuses.push((await post(makeEvent("daily_active"), env, options)).status);
  }

  assert.deepEqual(statuses, [204, 204, 429]);
});

test("repeated requests from one install hash are rate limited", async () => {
  const env = makeEnv(mockAnalytics(), {
    RATE_LIMIT_PER_IP_PER_MINUTE: "100",
    RATE_LIMIT_PER_INSTALL_PER_HOUR: "2"
  });
  const installHash = "c".repeat(64);
  const statuses = [];

  for (let i = 0; i < 3; i += 1) {
    statuses.push((await post(
      makeEvent("daily_active", { install_hash: installHash }),
      env,
      { ip: `198.51.100.${40 + i}` }
    )).status);
  }

  assert.deepEqual(statuses, [204, 204, 429]);
});

test("rate-limit buckets have fixed fields, enforce a window, and reset after expiry", async () => {
  const env = makeEnv(mockAnalytics(), {
    RATE_LIMIT_PER_IP_PER_MINUTE: "2",
    RATE_LIMIT_PER_INSTALL_PER_HOUR: "100"
  });
  const options = { ip: "198.51.100.60" };

  assert.equal((await post(makeEvent("daily_active"), env, options)).status, 204);
  assert.equal((await post(makeEvent("daily_active"), env, options)).status, 204);
  assert.equal((await post(makeEvent("daily_active"), env, options)).status, 429);
  assert.deepEqual(__test.snapshotRateLimits().ipBucketFields, [
    "count", "windowStartedAt", "expiresAt"
  ]);

  now += 60 * 1000 + 1;
  assert.equal((await post(makeEvent("daily_active"), env, options)).status, 204);
});

test("an unrelated request triggers bounded cleanup of an expired IP key", async () => {
  const env = makeEnv(mockAnalytics(), {
    RATE_LIMIT_PER_IP_PER_MINUTE: "100",
    RATE_LIMIT_PER_INSTALL_PER_HOUR: "100"
  });

  await post(makeEvent("install_seen", { install_hash: "1".repeat(64) }), env, {
    ip: "198.51.100.70"
  });
  assert.equal(__test.snapshotRateLimits().ipBucketCount, 1);

  now += 60 * 1000 + 1;
  await post(makeEvent("install_seen", { install_hash: "2".repeat(64) }), env, {
    ip: "198.51.100.71"
  });

  assert.equal(__test.snapshotRateLimits().ipBucketCount, 1);
});

test("random keys cannot grow either rate-limit map beyond its capacity", async () => {
  const env = makeEnv(mockAnalytics(), {
    RATE_LIMIT_PER_IP_PER_MINUTE: "100",
    RATE_LIMIT_PER_INSTALL_PER_HOUR: "100"
  });

  for (let i = 0; i < 4200; i += 1) {
    await post(makeEvent("install_seen"), env, {
      ip: `203.0.${Math.floor(i / 256)}.${i % 256}`
    });
  }

  const snapshot = __test.snapshotRateLimits();
  assert.ok(snapshot.ipBucketCount <= 4096);
  assert.ok(snapshot.installBucketCount <= 4096);
});

test("health remains available without a telemetry binding", async () => {
  const response = await worker.fetch(new Request("https://telemetry.test/health"), {});

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
