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
