#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkAdminPage } from "./check-admin-page.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRoot = path.join(root, ".local");
const runRoot = mkdtempSync(path.join(ensureLocalRoot(), "ios-verify-"));
const migrationPersist = path.join(runRoot, "migration-state");
const httpPersist = path.join(runRoot, "http-state");
const config = path.join(root, "wrangler.local.toml");
const fixtureScript = path.join(root, "tools", "ios-local-fixture.mjs");
const wranglerBin = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const databaseName = "quareia-ios-local";
const fixtureOrigin = "http://127.0.0.1:8787";
const childEnvironment = {
  ...process.env,
  CI: "1",
  CLOUDFLARE_TELEMETRY_DISABLED: "1",
  WRANGLER_SEND_METRICS: "false"
};

const evidence = {
  status: "STARTED",
  fixture_origin: fixtureOrigin,
  run_root: runRoot,
  checks: {}
};

try {
  evidence.checks.migration = verifyMigrationPreservation();
  evidence.checks.http = await verifyHttpFlow();
  evidence.status = "PASS";
  evidence.completed_at = new Date().toISOString();
  const evidencePath = path.join(runRoot, "verification.json");
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  process.stdout.write(`IOS_LOCAL_VERIFY_PASS ${JSON.stringify({
    tests: evidence.checks,
    evidence_path: evidencePath
  })}\n`);
} catch (error) {
  evidence.status = "FAIL";
  evidence.completed_at = new Date().toISOString();
  evidence.error = safeMessage(error);
  writeFileSync(path.join(runRoot, "verification.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
  throw error;
}

function verifyMigrationPreservation() {
  mkdirSync(migrationPersist, { recursive: true });
  const preMigrationDir = path.join(runRoot, "pre-ios-migrations");
  mkdirSync(preMigrationDir, { recursive: true });
  for (const file of ["0001_init.sql", "0002_miniprogram_platform.sql"]) {
    copyFileSync(path.join(root, "migrations", file), path.join(preMigrationDir, file));
  }
  const preConfig = path.join(runRoot, "wrangler.pre-ios.toml");
  writeFileSync(preConfig, localConfigFor(preMigrationDir), "utf8");

  runWrangler([
    "d1", "migrations", "apply", databaseName,
    "--local", "--config", preConfig, "--persist-to", migrationPersist
  ]);
  runD1(preConfig, migrationPersist, `
    INSERT INTO announcements
      (id, revision, status, severity, title_zh, body_en, platform, created_at, updated_at)
    VALUES (7, 9, 'published', 'important', 'fixture-preserved', 'fixture-preserved', 'android', 10, 11);
    INSERT INTO announcements (id, created_at, updated_at) VALUES (91, 12, 12);
    DELETE FROM announcements WHERE id = 91;
    INSERT INTO install_state
      (install_hash, app_version, version_code, locale, android_major, platform, env_version,
       first_seen_at, last_seen_at)
    VALUES ('${"a".repeat(64)}', '1.2.0', 4, 'en-US', 35, 'android', '', 10, 11),
           ('${"b".repeat(64)}', '1.3.0', 0, 'zh-CN', 0, 'miniprogram', 'release', 12, 13);
  `);

  assert.equal(firstResult(runD1(preConfig, migrationPersist,
    "SELECT seq FROM sqlite_sequence WHERE name = 'announcements'")).seq, 91);

  runWrangler([
    "d1", "migrations", "apply", databaseName,
    "--local", "--config", config, "--persist-to", migrationPersist
  ]);

  assert.equal(firstResult(runD1(config, migrationPersist,
    "SELECT seq FROM sqlite_sequence WHERE name = 'announcements'")).seq, 91);
  const announcement = firstResult(runD1(config, migrationPersist,
    "SELECT id, revision, title_zh, platform, created_at, updated_at FROM announcements WHERE id = 7"));
  assert.deepEqual(announcement, {
    id: 7,
    revision: 9,
    title_zh: "fixture-preserved",
    platform: "android",
    created_at: 10,
    updated_at: 11
  });

  const installs = results(runD1(config, migrationPersist,
    "SELECT install_hash, platform, env_version, android_major, ios_major, first_seen_at, last_seen_at " +
      "FROM install_state ORDER BY install_hash"));
  assert.deepEqual(installs, [
    {
      install_hash: "a".repeat(64), platform: "android", env_version: "",
      android_major: 35, ios_major: 0, first_seen_at: 10, last_seen_at: 11
    },
    {
      install_hash: "b".repeat(64), platform: "miniprogram", env_version: "release",
      android_major: 0, ios_major: 0, first_seen_at: 12, last_seen_at: 13
    }
  ]);

  const indexes = results(runD1(config, migrationPersist,
    "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' " +
      "AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name"));
  assert.deepEqual(indexes, [
    { name: "idx_announcements_public", tbl_name: "announcements" },
    { name: "idx_install_state_last_seen", tbl_name: "install_state" },
    { name: "idx_install_state_platform_last_seen", tbl_name: "install_state" }
  ]);

  runD1(config, migrationPersist, `
    INSERT INTO announcements
      (revision, status, severity, platform, created_at, updated_at)
    VALUES (1, 'draft', 'info', 'ios', 20, 20);
    INSERT INTO install_state
      (install_hash, app_version, version_code, locale, android_major, ios_major,
       platform, env_version, first_seen_at, last_seen_at)
    VALUES ('${"c".repeat(64)}', '1.0.0', 42, 'en-US', 0, 17, 'ios', '', 20, 20);
  `);
  assert.equal(firstResult(runD1(config, migrationPersist,
    "SELECT id FROM announcements WHERE platform = 'ios'")).id, 92);
  return {
    status: "PASS",
    preserved_announcements: 1,
    preserved_install_rows: 2,
    preserved_indexes: indexes.map((row) => row.name),
    preserved_sequence: 91,
    ios_insert_id: 92
  };
}

async function verifyHttpFlow() {
  mkdirSync(httpPersist, { recursive: true });
  const fixture = spawn(process.execPath, [
    fixtureScript,
    "--persist-to", httpPersist,
    "--port", "8787",
    "--worker-port", "8788"
  ], {
    cwd: root,
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  fixture.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  fixture.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    const fixtureHealth = await waitForFixture(fixture, () => stdout, () => stderr);
    assert.match(await checkAdminPage([]), /127\.0\.0\.1:8787\/admin 200/);
    const common = {
      schema_version: 1,
      install_hash: "d".repeat(64),
      app_version: "1.0.0",
      locale: "en-US",
      platform: "ios",
      ios_major: 17
    };
    const statuses = [];
    statuses.push(await postEvent({ ...common, event: "install_seen" }));
    statuses.push(await postEvent({ ...common, event: "app_active", version_code: 42 }));
    statuses.push(await postEvent({
      ...common,
      event: "reading_completed",
      deck_type: "tarot",
      card_count: 3
    }));
    assert.deepEqual(statuses, [204, 204, 204]);

    const statsResponse = await fetch(fixtureOrigin + "/__fixture/stats");
    assert.equal(statsResponse.status, 200);
    assert.equal(statsResponse.headers.get("cache-control"), "no-store");
    const fixtureStats = await statsResponse.json();
    assert.deepEqual(fixtureStats, {
      events: { install_seen: 1, app_active: 1, reading_completed: 1 },
      reading_completed: { tarot: 1, mystagogus: 0, lxxxi: 0, card_count_sum: 3 },
      install_state: {
        platform: "ios",
        rows: 1,
        version_code: 42,
        app_version: "1.0.0",
        ios_major: 17
      }
    });
    assert.equal(JSON.stringify(fixtureStats).includes(common.install_hash), false);

    const seedResponse = await fetch(fixtureOrigin + "/__fixture/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version_code: 42 })
    });
    assert.equal(seedResponse.status, 200);
    const seeded = (await seedResponse.json()).announcement;
    assert.equal(seeded.platform, "ios");
    assert.equal(seeded.revision, 1);

    const publicResponse = await fetch(
      fixtureOrigin + "/v1/announcements?platform=ios&version_code=42&locale=en-US"
    );
    assert.equal(publicResponse.status, 200);
    const initialEtag = publicResponse.headers.get("etag");
    const publicBody = await publicResponse.json();
    assert.equal(publicBody.announcements.length, 1);
    assert.equal(publicBody.announcements[0].id, seeded.id);
    assert.equal(publicBody.announcements[0].title, "[fixture] iOS announcement v1");

    const reviseResponse = await fetch(fixtureOrigin + "/__fixture/revise", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: seeded.id })
    });
    assert.equal(reviseResponse.status, 200);
    const revised = (await reviseResponse.json()).announcement;
    assert.equal(revised.revision, 2);
    const revisedPublic = await fetch(
      fixtureOrigin + "/v1/announcements?platform=ios&version_code=42&locale=en-US"
    );
    assert.notEqual(revisedPublic.headers.get("etag"), initialEtag);
    assert.equal((await revisedPublic.json()).announcements[0].title, "[fixture] iOS announcement v2");

    const withdrawResponse = await fetch(fixtureOrigin + "/__fixture/withdraw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: seeded.id })
    });
    assert.equal(withdrawResponse.status, 200);
    assert.equal((await withdrawResponse.json()).announcement.revision, 3);
    const withdrawnPublic = await fetch(
      fixtureOrigin + "/v1/announcements?platform=ios&version_code=42&locale=en-US"
    );
    assert.deepEqual((await withdrawnPublic.json()).announcements, []);

    return await finishHttpVerification(fixture, statuses, seeded.id, fixtureStats, fixtureHealth);
  } catch (error) {
    await stopFixture(fixture);
    const wrapped = new Error(`${safeMessage(error)};fixture_stderr=${sanitizeOutput(stderr)}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

async function finishHttpVerification(fixture, statuses, announcementId, fixtureStats, fixtureHealth) {
  await stopFixture(fixture);
  const installs = results(runD1(config, httpPersist,
    "SELECT install_hash, app_version, version_code, platform, android_major, ios_major, " +
      "first_seen_at, last_seen_at FROM install_state ORDER BY install_hash"));
  assert.equal(installs.length, 1);
  assert.deepEqual({
    install_hash: installs[0].install_hash,
    app_version: installs[0].app_version,
    version_code: installs[0].version_code,
    platform: installs[0].platform,
    android_major: installs[0].android_major,
    ios_major: installs[0].ios_major
  }, {
    install_hash: "d".repeat(64),
    app_version: "1.0.0",
    version_code: 42,
    platform: "ios",
    android_major: 0,
    ios_major: 17
  });
  const announcement = firstResult(runD1(config, httpPersist,
    `SELECT id, revision, status, platform FROM announcements WHERE id = ${Number(announcementId)}`));
  assert.deepEqual(announcement, {
    id: announcementId,
    revision: 3,
    status: "withdrawn",
    platform: "ios"
  });
  return {
    status: "PASS",
    fixture_health: fixtureHealth,
    admin_check: "PASS",
    event_statuses: statuses,
    fixture_stats: fixtureStats,
    d1_install_rows: installs.length,
    announcement_revision_after_withdraw: announcement.revision,
    persistence: httpPersist
  };
}

async function postEvent(body) {
  const response = await fetch(fixtureOrigin + "/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.status;
}

function runD1(configPath, persistTo, sql) {
  const output = runWrangler([
    "d1", "execute", databaseName,
    "--local",
    "--config", configPath,
    "--persist-to", persistTo,
    "--command", sql,
    "--json",
    "--yes"
  ]);
  return JSON.parse(output);
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: root,
    env: childEnvironment,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`wrangler_failed:${sanitizeOutput(result.stderr || result.stdout)}`);
  }
  return result.stdout.trim();
}

function results(payload) {
  const batch = Array.isArray(payload) ? payload[0] : payload;
  assert.ok(batch && batch.success !== false, "D1 command failed");
  return Array.isArray(batch.results) ? batch.results : [];
}

function firstResult(payload) {
  const rows = results(payload);
  assert.ok(rows.length > 0, "expected a D1 result row");
  return rows[0];
}

async function waitForFixture(child, stdout, stderr) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`fixture_exited:${sanitizeOutput(stderr())}`);
    }
    if (stdout().includes("FIXTURE_READY ")) {
      let response;
      try {
        response = await fetch(fixtureOrigin + "/__fixture/health", {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(2_500)
        });
      } catch (_error) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      const body = await response.json();
      if (response.status === 200) {
        assert.deepEqual(body, { ok: true, worker_origin: "http://127.0.0.1:8788" });
        return { status: "PASS", worker_path: "announcements+d1" };
      }
      assert.equal(response.status, 503);
      assert.deepEqual(body, { error: "worker_not_ready" });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`fixture_ready_timeout:${sanitizeOutput(stderr())}`);
}

async function stopFixture(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    await fetch(fixtureOrigin + "/__fixture/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
  } catch (_error) {
    child.kill("SIGTERM");
  }
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function localConfigFor(migrationsDir) {
  const entry = tomlPath(path.relative(runRoot, path.join(root, "tools", "ios-local-worker.mjs")));
  const migrations = tomlPath(path.relative(runRoot, migrationsDir));
  return `name = "quareia-telemetry-ios-pre-migration-local"\n` +
    `main = "${entry}"\n` +
    `compatibility_date = "2025-07-01"\n` +
    `workers_dev = false\n` +
    `send_metrics = false\n\n` +
    `[[d1_databases]]\n` +
    `binding = "DB"\n` +
    `database_name = "quareia-ios-local"\n` +
    `database_id = "00000000-0000-4000-8000-000000000003"\n` +
    `migrations_dir = "${migrations}"\n`;
}

function tomlPath(value) {
  return value.split(path.sep).join("/").replaceAll('"', '\\"');
}

function ensureLocalRoot() {
  mkdirSync(localRoot, { recursive: true });
  return localRoot + path.sep;
}

function sanitizeOutput(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function safeMessage(error) {
  return error && typeof error.message === "string" ? error.message : "verification_failed";
}
