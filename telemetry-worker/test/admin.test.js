import assert from "node:assert/strict";
import test from "node:test";

import worker, { __test } from "../src/index.js";
import {
  createMockD1,
  makeEnv,
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

const TOKEN = "test-admin-token";
let db;

test.beforeEach(() => {
  db = createMockD1();
});

function adminRequest(path, { method = "GET", body, token = TOKEN } = {}) {
  return worker.fetch(
    makeRequest("https://telemetry.test" + path, { method, body, token }),
    makeEnv({ db, adminToken: TOKEN })
  );
}

function validBody(overrides = {}) {
  return {
    severity: "info",
    platform: "all",
    status: "draft",
    title_zh: "新公告",
    body_zh: "正文",
    title_en: "Notice",
    body_en: "Body",
    ...overrides
  };
}

async function createAnnouncement(body = validBody()) {
  return adminRequest("/admin/api/announcements", { method: "POST", body });
}

test("admin endpoints deny by default without a token", async () => {
  const env = makeEnv({ db: createMockD1(), adminToken: TOKEN });

  const noHeader = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/announcements"),
    env
  );
  assert.equal(noHeader.status, 401);

  const wrongToken = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/announcements", { token: "wrong" }),
    env
  );
  assert.equal(wrongToken.status, 401);
});

test("admin endpoints fail closed when ADMIN_TOKEN is unset", async () => {
  const env = makeEnv({ db: createMockD1(), adminToken: null });
  const response = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/announcements", { token: "anything" }),
    env
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "admin_unavailable" });
});

test("verify accepts the correct token only", async () => {
  const ok = await adminRequest("/admin/verify", { method: "POST", body: {} });
  assert.equal(ok.status, 200);

  const bad = await worker.fetch(
    makeRequest("https://telemetry.test/admin/verify", {
      method: "POST",
      body: {},
      token: "wrong"
    }),
    makeEnv({ db: createMockD1(), adminToken: TOKEN })
  );
  assert.equal(bad.status, 401);
});

test("create, list and fetch a single announcement", async () => {
  const created = await createAnnouncement();
  assert.equal(created.status, 200);
  const createdJson = await created.json();
  assert.equal(createdJson.announcement.revision, 1);
  assert.equal(createdJson.announcement.status, "draft");
  assert.equal(createdJson.announcement.severity, "info");
  assert.equal(createdJson.announcement.title_zh, "新公告");
  assert.ok(createdJson.announcement.id > 0);

  const id = createdJson.announcement.id;
  const list = await adminRequest("/admin/api/announcements");
  const listJson = await list.json();
  assert.equal(listJson.announcements.length, 1);

  const single = await adminRequest("/admin/api/announcements/" + id);
  assert.equal(single.status, 200);
});

test("updating an announcement bumps revision and updated_at", async () => {
  const id = (await (await createAnnouncement()).json()).announcement.id;

  now += 5000;
  const updated = await adminRequest("/admin/api/announcements/" + id, {
    method: "PUT",
    body: validBody({ severity: "important", title_zh: "改过的标题" })
  });
  assert.equal(updated.status, 200);
  const json = await updated.json();
  assert.equal(json.announcement.revision, 2);
  assert.equal(json.announcement.severity, "important");
  assert.equal(json.announcement.title_zh, "改过的标题");
  assert.equal(json.announcement.updated_at, Math.floor(now / 1000));
});

test("publish and withdraw bump revision and change status", async () => {
  const id = (await (await createAnnouncement()).json()).announcement.id;

  const published = await adminRequest("/admin/api/announcements/" + id + "/publish", {
    method: "POST",
    body: {}
  });
  assert.equal(published.status, 200);
  const publishedJson = await published.json();
  assert.equal(publishedJson.announcement.status, "published");
  assert.equal(publishedJson.announcement.revision, 2);

  const withdrawn = await adminRequest("/admin/api/announcements/" + id + "/withdraw", {
    method: "POST",
    body: {}
  });
  const withdrawnJson = await withdrawn.json();
  assert.equal(withdrawnJson.announcement.status, "withdrawn");
  assert.equal(withdrawnJson.announcement.revision, 3);

  const gone = await adminRequest("/admin/api/announcements/" + id + "/publish", {
    method: "POST",
    body: {}
  });
  assert.equal(gone.status, 200);
});

test("unknown fields are rejected on create and update", async () => {
  const create = await createAnnouncement(validBody({ html_body: "<b>x</b>" }));
  assert.equal(create.status, 400);
  assert.match(await create.text(), /unexpected_field:html_body/);

  const id = (await (await createAnnouncement()).json()).announcement.id;
  const update = await adminRequest("/admin/api/announcements/" + id, {
    method: "PUT",
    body: validBody({ surprise: 1 })
  });
  assert.equal(update.status, 400);
});

test("invalid severities, platforms, statuses are rejected", async () => {
  assert.equal((await createAnnouncement(validBody({ severity: "critical" }))).status, 400);
  assert.equal((await createAnnouncement(validBody({ platform: "ios" }))).status, 400);
  assert.equal((await createAnnouncement(validBody({ status: "archived" }))).status, 400);
});

test("non-HTTPS action URLs are rejected", async () => {
  for (const url of ["http://example.com/x", "javascript:alert(1)", "ftp://x"]) {
    const response = await createAnnouncement(validBody({ action_url: url }));
    assert.equal(response.status, 400);
    assert.match(await response.text(), /action_url_must_be_https/);
  }
  const ok = await createAnnouncement(validBody({ action_url: "https://example.com/update" }));
  assert.equal(ok.status, 200);
});

test("oversized strings and inverted ranges are rejected", async () => {
  const long = await createAnnouncement(validBody({ body_zh: "x".repeat(2001) }));
  assert.equal(long.status, 400);
  assert.match(await long.text(), /field_too_long:body_zh/);

  const inverted = await createAnnouncement(validBody({ min_version_code: 9, max_version_code: 4 }));
  assert.equal(inverted.status, 400);
  assert.match(await inverted.text(), /min_version_above_max/);

  const invertedTime = await createAnnouncement(validBody({ starts_at: 200, ends_at: 100 }));
  assert.equal(invertedTime.status, 400);
  assert.match(await invertedTime.text(), /ends_before_starts/);
});

test("oversized admin bodies are rejected with 413", async () => {
  const response = await adminRequest("/admin/api/announcements", {
    method: "POST",
    body: validBody({ body_zh: "y".repeat(70_000) })
  });
  assert.equal(response.status, 413);
});

test("missing D1 returns 503 for admin API", async () => {
  const response = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/announcements", { token: TOKEN }),
    makeEnv({ db: undefined, adminToken: TOKEN })
  );
  assert.equal(response.status, 503);
});

test("stats report 24h/7d/30d active installs and per-version distribution", async () => {
  const db = createMockD1();
  const nowSec = Math.floor(now / 1000);
  const hour = 3600;
  const day = 86400;

  const seed = [
    ["a".repeat(64), 4, nowSec - 1 * hour],            // 24h + 7d + 30d
    ["b".repeat(64), 4, nowSec - 3 * day],              // 7d + 30d
    ["c".repeat(64), 3, nowSec - 10 * day],             // 30d only
    ["d".repeat(64), 3, nowSec - 60 * day],             // none
    ["e".repeat(64), 2, nowSec - 2 * hour]              // 24h + 7d + 30d
  ];
  for (const [hash, version, lastSeen] of seed) {
    db.exec(
      `INSERT INTO install_state (install_hash, app_version, version_code, locale, android_major, first_seen_at, last_seen_at)
       VALUES ('${hash}', '1.2.0', ${version}, 'zh-CN', 35, ${nowSec}, ${lastSeen})`
    );
  }

  const response = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/stats", { token: TOKEN }),
    makeEnv({ db, adminToken: TOKEN })
  );
  assert.equal(response.status, 200);
  const stats = await response.json();

  assert.equal(stats.windows.active_24h.count, 2);
  assert.equal(stats.windows.active_7d.count, 3);
  assert.equal(stats.windows.active_30d.count, 4);
  assert.equal(stats.total_installs, 5);
  assert.equal(stats.generated_at, nowSec);

  const byVersion = stats.by_version;
  assert.deepEqual(byVersion.map((r) => r.version_code), [4, 3, 2]);
  assert.equal(byVersion[0].installs, 2);
  assert.equal(byVersion[0].percent, 40);
  assert.equal(byVersion[1].installs, 2);
  assert.equal(byVersion[1].percent, 40);
  assert.equal(byVersion[2].installs, 1);
  assert.equal(byVersion[2].percent, 20);
});

test("version distribution reflects the most recently reported version", async () => {
  const db = createMockD1();
  const nowSec = Math.floor(now / 1000);
  db.exec(
    `INSERT INTO install_state (install_hash, app_version, version_code, locale, android_major, first_seen_at, last_seen_at)
     VALUES ('${"a".repeat(64)}', '1.1.1', 3, 'zh-CN', 35, ${nowSec - 100}, ${nowSec - 50}),
            ('${"b".repeat(64)}', '1.1.1', 3, 'zh-CN', 35, ${nowSec - 100}, ${nowSec - 50})`
  );
  // The two installs upgrade to 1.2.0 / versionCode 4.
  for (const hash of ["a".repeat(64), "b".repeat(64)]) {
    await worker.fetch(
      makeRequest("https://telemetry.test/v1/events", {
        method: "POST",
        body: {
          schema_version: 1,
          event: "app_active",
          install_hash: hash,
          app_version: "1.2.0",
          locale: "zh-CN",
          android_major: 35,
          version_code: 4
        }
      }),
      makeEnv({ db, adminToken: TOKEN, analytics: mockAnalytics() })
    );
  }

  const response = await worker.fetch(
    makeRequest("https://telemetry.test/admin/api/stats", { token: TOKEN }),
    makeEnv({ db, adminToken: TOKEN })
  );
  const stats = await response.json();
  assert.equal(stats.total_installs, 2);
  assert.deepEqual(stats.by_version, [
    { version_code: 4, app_version: "1.2.0", installs: 2, percent: 100 }
  ]);
});

test("daily cron deletes installs inactive for more than 90 days", async () => {
  const db = createMockD1();
  const nowSec = Math.floor(now / 1000);
  const day = 86400;
  db.exec(
    `INSERT INTO install_state (install_hash, app_version, version_code, locale, android_major, first_seen_at, last_seen_at)
     VALUES ('${"a".repeat(64)}', '1.2.0', 4, 'zh-CN', 35, ${nowSec}, ${nowSec - 89 * day}),
            ('${"b".repeat(64)}', '1.2.0', 4, 'zh-CN', 35, ${nowSec}, ${nowSec - 91 * day}),
            ('${"c".repeat(64)}', '1.2.0', 4, 'zh-CN', 35, ${nowSec}, ${nowSec - 120 * day})`
  );

  await worker.scheduled({ scheduledTime: now }, makeEnv({ db, adminToken: TOKEN }));

  const rows = db.all("SELECT install_hash FROM install_state");
  assert.deepEqual(rows.map((r) => r.install_hash), ["a".repeat(64)]);
});

test("cron with no D1 binding is a harmless no-op", async () => {
  await worker.scheduled({ scheduledTime: now }, makeEnv({ db: undefined }));
});
