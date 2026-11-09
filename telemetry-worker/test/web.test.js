import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash, randomFillSync } from "node:crypto";
import vm from "node:vm";
import worker, { __test } from "../src/index.js";
import { createMockD1, makeEnv, makeRequest, makeEvent, mockAnalytics } from "./helpers.js";

const ORIGIN = "https://hedanbaomi.github.io";
const source = readFileSync(new URL("../../js/web-telemetry.js", import.meta.url), "utf8");
const key = (name) => "quareia-web-telemetry-" + name;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };

test.beforeEach(() => __test.resetRateLimits());

function browser({ env, store = new Map(), location = {}, fetchImpl, storageError = false, native = false } = {}) {
  const calls = [];
  const listeners = {};
  const button = { hidden: true, setAttribute() {}, addEventListener(name, fn) { listeners["button:" + name] = fn; } };
  let now = 1_800_000_000_000;
  const localStorage = {
    getItem(name) { if (storageError) throw Error("blocked"); return store.get(name) ?? null; },
    setItem(name, value) { if (storageError) throw Error("blocked"); store.set(name, String(value)); },
    removeItem(name) { store.delete(name); }
  };
  const document = {
    documentElement: { lang: "zh-CN" }, visibilityState: "visible",
    getElementById: () => button,
    addEventListener(name, fn) { listeners[name] = fn; }
  };
  const window = {
    location: { protocol: "https:", hostname: "hedanbaomi.github.io", pathname: "/tarot-divination-site/", ...location },
    localStorage, androidTelemetry: native ? {} : undefined,
    crypto: {
      getRandomValues: randomFillSync,
      subtle: { digest: async (_name, bytes) => createHash("sha256").update(bytes).digest() }
    },
    DivinationI18n: { t: (value) => value },
    addEventListener(name, fn) { listeners[name] = fn; },
    fetch: async (url, init) => {
      const event = JSON.parse(init.body);
      calls.push({ url, init, event });
      if (fetchImpl) return fetchImpl(url, init);
      const request = new Request(url, { ...init, headers: { ...init.headers, origin: ORIGIN } });
      return worker.fetch(request, env);
    }
  };
  const context = vm.createContext({ window, document, Uint8Array, AbortController,
    setTimeout, clearTimeout, Date: { now: () => now } });
  vm.runInContext(source, context);
  return { window, document, store, calls, listeners, button, localStorage,
    runAgain: () => vm.runInContext(source, context), advance: (ms) => { now += ms; } };
}

test("browser visits, active browsers and readings reach the shared worker and admin", async () => {
  const db = createMockD1();
  const analytics = mockAnalytics();
  const env = makeEnv({ db, analytics });
  const page = browser({ env });
  await settle();
  assert.deepEqual(page.calls.map((call) => call.event.event).sort(), ["app_active", "install_seen", "web_visit"]);
  assert.equal(analytics.points.length, 3);
  assert.ok(analytics.points.every((point) => point.blobs[8] === "web" && point.doubles[1] === 0));
  const id = page.store.get(key("id"));
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.ok(page.calls.every((call) => call.event.install_hash === id));
  page.runAgain();
  page.listeners.pageshow();
  page.listeners.visibilitychange();
  await settle();
  assert.equal(page.calls.length, 3, "one visit per document; six-hour active dedupe");
  await page.window.DivinationWebTelemetry.logReadingCompleted("tarot", 3);
  const reading = page.calls.at(-1);
  assert.equal(reading.event.event, "reading_completed");
  assert.deepEqual(Object.keys(reading.event).sort(), ["app_version", "card_count", "deck_type", "event", "install_hash", "locale", "platform", "schema_version"]);
  assert.equal(reading.init.referrerPolicy, "no-referrer");
  assert.equal(reading.init.credentials, "omit");
  const mobile = makeEvent("app_active", { version_code: 4 });
  assert.equal((await worker.fetch(makeRequest("https://telemetry.test/v1/events", { method: "POST", body: mobile }), env)).status, 204);
  const ios = makeEvent("app_active", { platform: "ios", ios_major: 17, version_code: 1 });
  delete ios.android_major;
  assert.equal((await worker.fetch(makeRequest("https://telemetry.test/v1/events", { method: "POST", body: ios }), env)).status, 204);
  const stats = await (await worker.fetch(makeRequest("https://telemetry.test/admin/api/stats", { token: "test-admin-token" }), env)).json();
  assert.equal(stats.windows.active_24h.count, 3);
  assert.deepEqual(stats.platform_distribution.active_24h.map((row) => [row.platform, row.installs]), [["android", 1], ["ios", 1], ["web", 1]]);
  const nextPage = browser({ env, store: page.store });
  await settle();
  assert.deepEqual(nextPage.calls.map((call) => call.event.event), ["web_visit"]);
  assert.equal(nextPage.calls[0].event.install_hash, id);
  page.advance(21600000);
  page.listeners.visibilitychange();
  await settle();
  assert.equal(page.calls.at(-1).event.event, "app_active");
  assert.equal(db.all("SELECT * FROM install_state").length, 3);
});

test("collector stays off in local/native contexts, without storage, and after opt-out", async () => {
  for (const options of [
    { location: { hostname: "localhost" } }, { location: { protocol: "http:" } },
    { location: { pathname: "/other/" } }, { native: true }, { storageError: true },
    { store: new Map([[key("enabled"), "false"]]) }
  ]) {
    const page = browser(options);
    await settle();
    assert.equal(page.calls.length, 0);
  }
  const page = browser({ fetchImpl: async () => ({ status: 204 }) });
  page.window.DivinationWebTelemetry.setEnabled(false);
  await settle();
  assert.equal(page.calls.length, 0, "opting out cancels queued identity work");
  assert.equal(page.store.has(key("id")), false);
  assert.equal(page.store.get(key("enabled")), "false");
  await page.window.DivinationWebTelemetry.logReadingCompleted("tarot", 3);
  assert.equal(page.calls.length, 0);
});

test("failed requests do not mark installation or activity delivered and can retry", async () => {
  let status = 503;
  const page = browser({ fetchImpl: async () => ({ status }) });
  await settle();
  assert.equal(page.store.has(key("installed")), false);
  assert.equal(page.store.has(key("active")), false);
  status = 204;
  page.listeners.visibilitychange();
  await settle();
  assert.equal(page.calls.length, 6);
  assert.equal(page.store.get(key("installed")), "true");
  const id = page.store.get(key("id"));
  page.window.DivinationWebTelemetry.setEnabled(false);
  assert.equal(page.store.has(key("id")), false);
  page.window.DivinationWebTelemetry.setEnabled(true);
  await settle();
  assert.notEqual(page.store.get(key("id")), id);
  assert.equal(page.calls.filter((call) => call.event.event === "web_visit").length, 2,
    "only the failed visit and its successful retry; toggling must not add a third visit");
});

test("opt-out aborts in-flight work and ignores stale successful responses", async () => {
  const resolvers = [];
  const page = browser({ fetchImpl: () => new Promise((resolve) => resolvers.push(resolve)) });
  await settle();
  assert.equal(page.calls.length, 3);
  page.localStorage.setItem(key("enabled"), "false");
  page.listeners.storage({ key: key("enabled"), newValue: "false" });
  assert.ok(page.calls.every((call) => call.init.signal.aborted));
  resolvers.forEach((resolve) => resolve({ status: 204 }));
  await settle();
  for (const name of ["id", "installed", "active"]) assert.equal(page.store.has(key(name)), false);
});

test("events CORS permits the production website and never enables admin CORS", async () => {
  const env = makeEnv({ db: createMockD1(), analytics: mockAnalytics() });
  const preflight = (origin = ORIGIN, requested = "content-type") => new Request("https://telemetry.test/v1/events", {
    method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": requested }
  });
  const response = await worker.fetch(preflight(), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  for (const request of [preflight("https://evil.test"), preflight("null"), preflight(ORIGIN, "authorization")]) {
    assert.equal((await worker.fetch(request, env)).status, 403);
  }
  const admin = await worker.fetch(new Request("https://telemetry.test/admin/api/stats", { headers: { origin: ORIGIN } }), env);
  assert.equal(admin.status, 401);
  assert.equal(admin.headers.get("access-control-allow-origin"), null);
  const bad = await worker.fetch(new Request("https://telemetry.test/v1/events", { method: "POST", headers: { origin: ORIGIN }, body: "{}" }), env);
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("access-control-allow-origin"), ORIGIN);
});

test("web schema rejects native fields and content; other platforms cannot emit web_visit", async () => {
  const env = makeEnv({ db: createMockD1(), analytics: mockAnalytics() });
  const web = { schema_version: 1, platform: "web", event: "app_active", install_hash: "a".repeat(64), app_version: "web-1", locale: "en" };
  for (const extra of [{ android_major: 0 }, { android_major: null }, { ios_major: 0 }, { ios_major: null }, { version_code: 0 }, { env_version: "release" }, { question: "secret" }, { card_ids: [] }]) {
    const response = await worker.fetch(makeRequest("https://telemetry.test/v1/events", { method: "POST", body: { ...web, ...extra } }), env);
    assert.equal(response.status, 400, JSON.stringify(extra));
  }
  assert.equal((await worker.fetch(makeRequest("https://telemetry.test/v1/events", { method: "POST", body: makeEvent("web_visit") }), env)).status, 400);
  assert.equal(env.TELEMETRY.points.length, 0);
});
