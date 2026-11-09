import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { validateExport, buildImportSql } from "../tools/web-history-import.mjs";
import { handleAdminApi } from "../src/admin.js";

const migrations = new URL("../migrations/", import.meta.url);
const route = "/admin/api/web-history";
function fixture() {
  return {
    schema_version: 1, source: "cloudflare_web_analytics", host: "hedanbaomi.github.io", path: "/tarot-divination-site/",
    site_tag: "a".repeat(32), site_created_at: "2026-11-06T13:00:00Z", exported_at: "2026-11-09T07:00:00Z",
    cutoff_utc: "2026-11-09T00:00:00Z", exclude_bots: true,
    batches: [{ from: "2026-11-06T00:00:00Z", through: "2026-11-07T00:00:00Z", site_tags: ["a".repeat(32)], bot: 0,
      total_pageviews: 10, total_visits: 5, paths: [["/tarot-divination-site/", 10, 5]],
      rows: [["2026-11-06T14:00:00Z", 7, 4, 1], ["2026-11-06T15:00:00Z", 3, 1, 2]] },
    { from: "2026-11-07T00:00:00Z", through: "2026-11-09T00:00:00Z", site_tags: ["a".repeat(32)], bot: 0,
      total_pageviews: 20, total_visits: 8, paths: [["/tarot-divination-site/", 20, 8]], rows: [["2026-11-08", 20, 8, 5]] }]
  };
}
function database() {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync(migrations).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, migrations), "utf8"));
  return db;
}
function d1(db) {
  return { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; }
    };
  } };
}
function request(db, { token = "test-token", method = "GET" } = {}) {
  return handleAdminApi(new Request("https://test.invalid" + route, {
    method, headers: token ? { authorization: "Bearer " + token } : {}
  }), { ADMIN_TOKEN: "test-token", DB: d1(db) }, route);
}

test("validates full UTC coverage, hourly aggregation and unobserved days", () => {
  const result = validateExport(fixture());
  assert.equal(result.pageviews, 30); assert.equal(result.visits, 13); assert.equal(result.coverage_days, 3);
  assert.deepEqual(result.rows[0], { utc_day: "2026-11-06", pageviews: 10, visits: 5, max_sample_interval: 2, has_samples: 1 });
  assert.deepEqual(result.rows[1], { utc_day: "2026-11-07", pageviews: 0, visits: 0, max_sample_interval: null, has_samples: 0 });
  const reordered = Object.fromEntries(Object.entries(fixture()).reverse());
  assert.equal(validateExport(reordered).id, result.id);
});

const invalidCases = {
  "wrong host": x => { x.host = "other.example"; },
  "bot inclusion": x => { x.exclude_bots = false; },
  "wrong site filter": x => { x.batches[0].site_tags = ["b".repeat(32)]; },
  "wrong bot filter": x => { x.batches[0].bot = 1; },
  "mixed paths": x => { x.batches[0].paths[0][0] = "/other/"; },
  "path mismatch": x => { x.batches[0].paths[0][1]++; },
  "series mismatch": x => { x.batches[0].rows[0][1]++; },
  "gap": x => { x.batches[1].from = "2026-11-08T00:00:00Z"; },
  "overlap": x => { x.batches[1].from = "2026-11-06T00:00:00Z"; },
  "inclusive boundary duplicate": x => { x.batches[0].rows[0][0] = "2026-11-07T00:00:00Z"; },
  "duplicate bucket": x => { x.batches[0].rows[1][0] = x.batches[0].rows[0][0]; },
  "invalid calendar day": x => { x.batches[0].rows[0][0] = "2026-02-30"; },
  "mixed granularity": x => { x.batches[0].rows[1][0] = "2026-11-06"; },
  "missing final batch": x => { x.batches.pop(); },
  "live period overlap": x => { x.cutoff_utc = "2026-11-10T00:00:00Z"; },
  "missing export time": x => { delete x.exported_at; },
  "invalid sample": x => { x.batches[0].rows[0][3] = NaN; },
  "visits exceed views": x => { x.batches[0].rows[0][2] = 10; }
};
for (const [name, mutate] of Object.entries(invalidCases)) test("rejects " + name, () => {
  const input = fixture(); mutate(input); assert.throws(() => validateExport(input));
});

test("migration only adds history tables, preserving all existing state", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync(migrations).filter(n => n.endsWith(".sql") && !n.startsWith("0005")).sort()) db.exec(readFileSync(new URL(name, migrations), "utf8"));
  db.exec("INSERT INTO announcements (id,created_at,updated_at) VALUES (9,1,2)");
  db.exec("INSERT INTO install_state (install_hash,app_version,version_code,locale,android_major,platform,first_seen_at,last_seen_at,ios_major) VALUES ('legacy','1.0',1,'zh-CN',0,'ios',1,2,17)");
  const before = [db.prepare("SELECT * FROM announcements").all(), db.prepare("SELECT * FROM install_state").all()];
  const indexes = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' ORDER BY name").all();
  db.exec(readFileSync(new URL("0005_web_analytics_history.sql", migrations), "utf8"));
  assert.deepEqual([db.prepare("SELECT * FROM announcements").all(), db.prepare("SELECT * FROM install_state").all()], before);
  for (const index of indexes) assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE name=?").get(index.name), index);
  db.close();
});

test("idempotent import resumes partial writes and publishes only reconciled history", async () => {
  const db = database();
  try {
    const { sql } = buildImportSql(fixture());
    db.exec(sql.split("\n").slice(0, 2).join("\n"));
    assert.equal((await (await request(db)).json()).imported, false);
    db.exec(sql);
    const response = await request(db), data = await response.json();
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(data.pageviews, 30); assert.equal(data.rows.length, 3); assert.equal(data.id, undefined);
    assert.equal(data.estimated, true); assert.equal(data.days_with_samples, 2);
    db.exec(sql);
    assert.deepEqual(await (await request(db)).json(), data);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM web_analytics_imports").get().n, 1);
    db.exec("DELETE FROM web_analytics_daily WHERE utc_day='2026-11-08'");
    assert.equal((await request(db)).status, 503);
  } finally { db.close(); }
});

test("inconsistent partial import is not published; latest snapshot replaces rather than adds", async () => {
  const db = database();
  try {
    const input = fixture(), { sql } = buildImportSql(input);
    db.exec(sql.split("\n").slice(0, 2).join("\n"));
    db.exec("UPDATE web_analytics_daily SET pageviews=99");
    db.exec(sql);
    assert.equal((await (await request(db)).json()).imported, false);
    input.exported_at = "2026-11-09T08:00:00Z";
    db.exec(buildImportSql(input).sql);
    assert.equal((await (await request(db)).json()).pageviews, 30);
    input.exported_at = "2026-11-09T09:00:00Z";
    db.exec(buildImportSql(input).sql);
    assert.equal((await (await request(db)).json()).pageviews, 30);
  } finally { db.close(); }
});

test("history auth precedes DB access, is read-only and failures stay isolated", async () => {
  assert.equal((await request(null, { token: null })).status, 401);
  assert.equal((await request(null, { token: "wrong" })).status, 401);
  assert.equal((await request(null, { method: "POST" })).status, 405);
  assert.equal((await request(null)).status, 503);
  const db = database();
  assert.equal((await (await request(db)).json()).imported, false);
  db.close();
});
