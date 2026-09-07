import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migrations = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations"
);

test("WeChat platform migration preserves old rows and accepts Mini Program and Mini Game", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(migrations, "0001_init.sql"), "utf8"));
  db.exec(`
    INSERT INTO announcements
      (id, revision, status, severity, title_zh, platform, created_at, updated_at)
    VALUES (7, 2, 'published', 'important', 'existing', 'android', 10, 11);
    INSERT INTO install_state
      (install_hash, app_version, version_code, locale, android_major, first_seen_at, last_seen_at)
    VALUES ('${"a".repeat(64)}', '1.2.0', 4, 'zh-CN', 35, 10, 11);
  `);

  db.exec(readFileSync(path.join(migrations, "0002_miniprogram_platform.sql"), "utf8"));

  assert.deepEqual({ ...db.prepare(
    "SELECT id, revision, platform, title_zh FROM announcements WHERE id = 7"
  ).get() }, { id: 7, revision: 2, platform: "android", title_zh: "existing" });
  assert.deepEqual({ ...db.prepare(
    "SELECT platform, env_version FROM install_state"
  ).get() }, { platform: "android", env_version: "" });
  assert.doesNotThrow(() => db.exec(`
    INSERT INTO announcements
      (status, severity, platform, created_at, updated_at)
    VALUES ('draft', 'info', 'miniprogram', 12, 12)
  `));
  assert.doesNotThrow(() => db.exec(`
    INSERT INTO announcements
      (status, severity, platform, created_at, updated_at)
    VALUES ('draft', 'info', 'minigame', 13, 13);
    INSERT INTO install_state
      (install_hash, app_version, version_code, locale, android_major, platform, env_version,
       first_seen_at, last_seen_at)
    VALUES ('${"b".repeat(64)}', '1.0.0', 0, 'zh-CN', 0, 'minigame', 'develop', 13, 13)
  `));
});

test("iOS migration preserves rows, ids, revisions and indexes while accepting native builds", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(migrations, "0001_init.sql"), "utf8"));
  db.exec(readFileSync(path.join(migrations, "0002_miniprogram_platform.sql"), "utf8"));
  db.exec(`
    INSERT INTO announcements
      (id, revision, status, severity, title_zh, body_en, platform, created_at, updated_at)
    VALUES (7, 9, 'published', 'important', '保留', 'preserved', 'android', 10, 11);
    INSERT INTO install_state
      (install_hash, app_version, version_code, locale, android_major, platform, env_version,
       first_seen_at, last_seen_at)
    VALUES ('${"a".repeat(64)}', '1.2.0', 4, 'zh-CN', 35, 'android', '', 10, 11),
           ('${"b".repeat(64)}', '1.3.0', 0, 'zh-CN', 0, 'miniprogram', 'release', 12, 13);
  `);

  db.exec(readFileSync(path.join(migrations, "0003_ios_platform.sql"), "utf8"));

  assert.deepEqual({ ...db.prepare(
    "SELECT id, revision, title_zh, body_en, platform, created_at, updated_at FROM announcements WHERE id = 7"
  ).get() }, {
    id: 7,
    revision: 9,
    title_zh: "保留",
    body_en: "preserved",
    platform: "android",
    created_at: 10,
    updated_at: 11
  });
  assert.deepEqual(db.prepare(
    "SELECT install_hash, platform, env_version, android_major, ios_major, first_seen_at, last_seen_at " +
      "FROM install_state ORDER BY install_hash"
  ).all().map((row) => ({ ...row })), [
    {
      install_hash: "a".repeat(64), platform: "android", env_version: "",
      android_major: 35, ios_major: 0, first_seen_at: 10, last_seen_at: 11
    },
    {
      install_hash: "b".repeat(64), platform: "miniprogram", env_version: "release",
      android_major: 0, ios_major: 0, first_seen_at: 12, last_seen_at: 13
    }
  ]);

  const indexes = db.prepare(
    "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex%' " +
      "ORDER BY name"
  ).all().map((row) => ({ ...row }));
  assert.deepEqual(indexes, [
    { name: "idx_announcements_public", tbl_name: "announcements" },
    { name: "idx_install_state_last_seen", tbl_name: "install_state" },
    { name: "idx_install_state_platform_last_seen", tbl_name: "install_state" }
  ]);

  db.exec(`
    INSERT INTO announcements
      (revision, status, severity, platform, created_at, updated_at)
    VALUES (1, 'draft', 'info', 'ios', 20, 20);
    INSERT INTO install_state
      (install_hash, app_version, version_code, locale, android_major, ios_major,
       platform, env_version, first_seen_at, last_seen_at)
    VALUES ('${"c".repeat(64)}', '1.0.0', 42, 'en-US', 0, 17, 'ios', '', 20, 20);
  `);
  assert.equal(db.prepare("SELECT id FROM announcements WHERE platform = 'ios'").get().id, 8);
  assert.equal(db.prepare("SELECT version_code FROM install_state WHERE platform = 'ios'").get().version_code, 42);
});

for (const scenario of ['surviving-row', 'all-deleted', 'never-inserted']) {
  test('iOS migration preserves announcement allocation history: ' + scenario, () => {
    const db = new DatabaseSync(':memory:');
    try {
      for (const file of ['0001_init.sql', '0002_miniprogram_platform.sql']) {
        db.exec(readFileSync(path.join(migrations, file), 'utf8'));
      }
      if (scenario !== 'never-inserted') {
        db.exec('INSERT INTO announcements (id, created_at, updated_at) VALUES (7, 1, 1), (91, 2, 2)');
        db.exec('DELETE FROM announcements WHERE id = 91');
        if (scenario === 'all-deleted') db.exec('DELETE FROM announcements');
      }
      db.exec(readFileSync(path.join(migrations, '0003_ios_platform.sql'), 'utf8'));
      db.exec('INSERT INTO announcements (created_at, updated_at) VALUES (3, 3)');
      assert.equal(db.prepare('SELECT id FROM announcements WHERE created_at = 3').get().id,
        scenario === 'never-inserted' ? 1 : 92);
      assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_sequence WHERE name = 'announcements_pre_ios'").get().count, 0);
    } finally {
      db.close();
    }
  });
}
