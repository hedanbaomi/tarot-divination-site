import assert from "node:assert/strict";
import test from "node:test";

import worker, { __test } from "../src/index.js";
import {
  createMockD1,
  makeEnv,
  makeRequest
} from "./helpers.js";

let now = 1_700_000_000_000; // ms; nowSec() = 1_700_000_000

test.beforeEach(() => {
  now = 1_700_000_000_000;
  __test.setClockForTesting(() => now);
  __test.resetRateLimits();
});

test.after(() => {
  __test.resetClock();
  __test.resetRateLimits();
});

function insertAnnouncement(db, overrides = {}) {
  const defaults = {
    status: "published",
    severity: "info",
    title_zh: "中文标题",
    body_zh: "中文正文",
    button_zh: "查看",
    title_en: "English title",
    body_en: "English body",
    button_en: "Open",
    action_url: "",
    platform: "all",
    min_version_code: 0,
    max_version_code: 2147483647,
    starts_at: 0,
    ends_at: 0,
    created_at: 100,
    updated_at: 100
  };
  const row = { ...defaults, ...overrides };
  db.exec(
    `INSERT INTO announcements
       (revision, status, severity, title_zh, body_zh, button_zh, title_en, body_en,
        button_en, action_url, platform, min_version_code, max_version_code,
        starts_at, ends_at, created_at, updated_at)
     VALUES (1, '${row.status}', '${row.severity}', '${row.title_zh}', '${row.body_zh}',
       '${row.button_zh}', '${row.title_en}', '${row.body_en}', '${row.button_en}',
       '${row.action_url}', '${row.platform}', ${row.min_version_code},
       ${row.max_version_code}, ${row.starts_at}, ${row.ends_at},
       ${row.created_at}, ${row.updated_at})`
  );
  return db.all("SELECT id FROM announcements ORDER BY id DESC LIMIT 1")[0].id;
}

async function getAnnouncements(db, query = "", token) {
  const url = "https://telemetry.test/v1/announcements" + (query ? "?" + query : "");
  return worker.fetch(makeRequest(url, { token }), makeEnv({ db }));
}

async function getAnnouncementsWithOrigin(db, origin, query = "", etag) {
  const url = "https://telemetry.test/v1/announcements" + (query ? "?" + query : "");
  const headers = { Origin: origin };
  if (etag) headers["if-none-match"] = etag;
  return worker.fetch(new Request(url, { headers }), makeEnv({ db }));
}

test("only published announcements are returned", async () => {
  const db = createMockD1();
  insertAnnouncement(db);
  insertAnnouncement(db, { status: "draft" });
  insertAnnouncement(db, { status: "withdrawn" });

  const response = await getAnnouncements(db);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.announcements.length, 1);
  assert.equal(data.announcements[0].status, undefined); // status never leaked publicly
});

test("platform filter matches android and all, excludes web", async () => {
  const db = createMockD1();
  insertAnnouncement(db, { platform: "android" });
  insertAnnouncement(db, { platform: "all" });
  insertAnnouncement(db, { platform: "web" });

  const response = await getAnnouncements(db, "platform=android");
  const data = await response.json();
  assert.deepEqual(
    data.announcements.map((a) => a.platform).sort(),
    ["all", "android"]
  );
});

test("mini-program platform filter matches miniprogram and all only", async () => {
  const db = createMockD1();
  insertAnnouncement(db, { platform: "miniprogram" });
  insertAnnouncement(db, { platform: "all" });
  insertAnnouncement(db, { platform: "android" });
  insertAnnouncement(db, { platform: "web" });

  const response = await getAnnouncements(db, "platform=miniprogram&version_code=0");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(
    data.announcements.map((announcement) => announcement.platform).sort(),
    ["all", "miniprogram"]
  );
});

test("mini-game platform filter matches minigame and all only", async () => {
  const db = createMockD1();
  insertAnnouncement(db, { platform: "minigame" });
  insertAnnouncement(db, { platform: "all" });
  insertAnnouncement(db, { platform: "miniprogram" });
  insertAnnouncement(db, { platform: "android" });

  const response = await getAnnouncements(db, "platform=minigame&version_code=0");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(
    data.announcements.map((announcement) => announcement.platform).sort(),
    ["all", "minigame"]
  );
});

test("version range filter applies min and max version_code", async () => {
  const db = createMockD1();
  insertAnnouncement(db, { min_version_code: 0, max_version_code: 2147483647 });
  insertAnnouncement(db, { min_version_code: 4, max_version_code: 4 });

  const response = await getAnnouncements(db, "platform=android&version_code=4");
  const data = await response.json();
  assert.equal(data.announcements.length, 2);

  const oldResponse = await getAnnouncements(db, "platform=android&version_code=3");
  const oldData = await oldResponse.json();
  assert.equal(oldData.announcements.length, 1);
  assert.equal(oldData.announcements[0].min_version_code, 0);
});

test("time window: not started and expired announcements are excluded", async () => {
  const db = createMockD1();
  const nowSec = Math.floor(now / 1000);
  insertAnnouncement(db, { starts_at: nowSec - 100, ends_at: 0 });        // active
  insertAnnouncement(db, { starts_at: nowSec + 1000, ends_at: 0 });       // future
  insertAnnouncement(db, { starts_at: nowSec - 5000, ends_at: nowSec - 1 }); // expired

  const response = await getAnnouncements(db);
  const data = await response.json();
  assert.equal(data.announcements.length, 1);
});

test("results are ordered by severity then publish time then id", async () => {
  const db = createMockD1();
  const nowSec = Math.floor(now / 1000);
  insertAnnouncement(db, { severity: "info", starts_at: nowSec - 100, updated_at: 1 });
  insertAnnouncement(db, { severity: "important", starts_at: nowSec - 200, updated_at: 2 });
  insertAnnouncement(db, { severity: "update", starts_at: nowSec - 300, updated_at: 3 });

  const response = await getAnnouncements(db);
  const data = await response.json();
  assert.deepEqual(
    data.announcements.map((a) => a.severity),
    ["update", "important", "info"]
  );
});

test("zh-CN locale returns Chinese fields, en returns English fields", async () => {
  const db = createMockD1();
  insertAnnouncement(db);

  const zh = await (await getAnnouncements(db, "locale=zh-CN")).json();
  assert.equal(zh.announcements[0].title, "中文标题");
  assert.equal(zh.announcements[0].body, "中文正文");
  assert.equal(zh.announcements[0].button, "查看");

  const en = await (await getAnnouncements(db, "locale=en")).json();
  assert.equal(en.announcements[0].title, "English title");
  assert.equal(en.announcements[0].body, "English body");
  assert.equal(en.announcements[0].button, "Open");
});

test("unknown locales fall back to English", async () => {
  const db = createMockD1();
  insertAnnouncement(db);

  const response = await getAnnouncements(db, "locale=de-DE");
  const data = await response.json();
  assert.equal(data.announcements[0].title, "English title");
});

test("missing primary-language fields fall back per field to the other language", async () => {
  const db = createMockD1();
  insertAnnouncement(db, { title_zh: "", body_zh: "", title_en: "Only EN" });

  const response = await getAnnouncements(db, "locale=zh-CN");
  const data = await response.json();
  assert.equal(data.announcements[0].title, "Only EN");
});

test("ETag is stable for identical content and returns 304 on If-None-Match", async () => {
  const db = createMockD1();
  insertAnnouncement(db);

  const first = await getAnnouncements(db);
  const etag = first.headers.get("etag");
  assert.ok(etag);

  const second = await worker.fetch(new Request(
    "https://telemetry.test/v1/announcements?platform=android&version_code=4&locale=zh-CN",
    { headers: { "if-none-match": etag } }
  ), makeEnv({ db }));

  assert.equal(second.status, 304);
  assert.equal(second.headers.get("etag"), etag);
  assert.match(second.headers.get("cache-control") || "", /public/);
});

test("public announcements CORS is strict and also applies to 304", async () => {
  const db = createMockD1();
  insertAnnouncement(db);

  const allowed = await getAnnouncementsWithOrigin(db, "https://hedanbaomi.github.io", "platform=web&version_code=1&locale=zh-CN");
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://hedanbaomi.github.io");
  assert.equal(allowed.headers.get("vary"), "Origin");
  assert.equal(allowed.headers.get("access-control-allow-methods"), "GET");
  assert.match(allowed.headers.get("access-control-expose-headers") || "", /etag/i);

  const notModified = await getAnnouncementsWithOrigin(
    db,
    "https://hedanbaomi.github.io",
    "platform=web&version_code=1&locale=zh-CN",
    allowed.headers.get("etag")
  );
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get("access-control-allow-origin"), "https://hedanbaomi.github.io");

  const local = await getAnnouncementsWithOrigin(db, "http://localhost:8000", "platform=web&version_code=1&locale=en");
  assert.equal(local.headers.get("access-control-allow-origin"), "http://localhost:8000");
  const localDefaultPort = await getAnnouncementsWithOrigin(db, "http://localhost", "platform=web&version_code=1&locale=en");
  assert.equal(localDefaultPort.headers.get("access-control-allow-origin"), "http://localhost");

  const denied = await getAnnouncementsWithOrigin(db, "https://evil.example", "platform=web&version_code=1&locale=en");
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal(denied.headers.get("vary"), "Origin");

  const noOrigin = await getAnnouncements(db, "platform=web&version_code=1&locale=en");
  assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);
  assert.equal(noOrigin.headers.get("vary"), "Origin");
});

test("rate-limited public announcements retain strict CORS headers", async () => {
  const db = createMockD1();
  const env = makeEnv({ db, overrides: { RATE_LIMIT_PER_IP_PER_MINUTE: "1" } });
  const request = () => new Request(
    "https://telemetry.test/v1/announcements?platform=web&version_code=1&locale=en",
    {
      headers: {
        Origin: "https://hedanbaomi.github.io",
        "cf-connecting-ip": "198.51.100.20"
      }
    }
  );

  assert.equal((await worker.fetch(request(), env)).status, 200);
  const limited = await worker.fetch(request(), env);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("access-control-allow-origin"), "https://hedanbaomi.github.io");
  assert.equal(limited.headers.get("vary"), "Origin");
});

test("admin responses never receive public announcement CORS", async () => {
  const db = createMockD1();
  const response = await worker.fetch(new Request("https://telemetry.test/admin", {
    headers: { Origin: "https://hedanbaomi.github.io" }
  }), makeEnv({ db }));
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("editing or withdrawing an announcement changes the ETag", async () => {
  const db = createMockD1();
  const id = insertAnnouncement(db);

  const before = await getAnnouncements(db);
  const etagBefore = before.headers.get("etag");

  db.exec(`UPDATE announcements SET revision = revision + 1, updated_at = 200 WHERE id = ${id}`);
  const after = await getAnnouncements(db);
  assert.notEqual(after.headers.get("etag"), etagBefore);

  db.exec(`UPDATE announcements SET status = 'withdrawn' WHERE id = ${id}`);
  const withdrawn = await getAnnouncements(db);
  assert.notEqual(withdrawn.headers.get("etag"), etagBefore);
  assert.equal((await withdrawn.json()).announcements.length, 0);
});

test("public GET never requires install_hash and rejects no params", async () => {
  const db = createMockD1();
  insertAnnouncement(db);

  const response = await getAnnouncements(db, "");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.announcements.length, 1);
  assert.ok("locale" in data);
});

test("invalid platform and version_code parameters return 400", async () => {
  const db = createMockD1();
  assert.equal((await getAnnouncements(db, "platform=ios")).status, 400);
  assert.equal((await getAnnouncements(db, "version_code=abc")).status, 400);
  assert.equal((await getAnnouncements(db, "version_code=-1")).status, 400);
});

test("missing D1 binding returns 503, empty table returns empty list", async () => {
  const noDb = await worker.fetch(
    makeRequest("https://telemetry.test/v1/announcements"),
    makeEnv({ db: undefined })
  );
  assert.equal(noDb.status, 503);

  const empty = await getAnnouncements(createMockD1());
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).announcements, []);
});

test("admin pages and API are never cached", async () => {
  const db = createMockD1();
  const token = "test-admin-token";

  const page = await worker.fetch(
    makeRequest("https://telemetry.test/admin"),
    makeEnv({ db, adminToken: token })
  );
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") || "", /text\/html/);
  assert.match(page.headers.get("cache-control") || "", /no-store/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");

  const list = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/announcements", { token }),
    makeEnv({ db, adminToken: token })
  );
  assert.match(list.headers.get("cache-control") || "", /no-store/);
});
