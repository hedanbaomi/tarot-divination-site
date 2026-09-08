#!/usr/bin/env node

import { createServer } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { unstable_dev } from "wrangler";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRoot = path.join(root, ".local");
const wranglerBin = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const config = path.join(root, "wrangler.local.toml");
const databaseName = "quareia-ios-local";
const fixtureToken = "local-fixture-token-not-a-secret";
const updateFixtureOrigin = "http://127.0.0.1:8787";
const updateArtifactName = "Quareia-1.0.1-2.ipa";
const updateArtifactPath = `/fixtures/${updateArtifactName}`;
const updateArtifact = Buffer.from(
  "QUAREIA PUBLIC_TESTING SYNTHETIC IPA\n" +
    "This is not an installable application archive.\n",
  "utf8"
);
const updateArtifactSha256 = "1148e3aae6c847d29f11873cb73f848322fc825ff975c9bd73c182df97fff66b";
const updateArtifactDelayMs = 1_200;
const workerReadinessTimeoutMs = 2_000;
let updateDownloadMode = "normal";
let activeUpdateDownloads = 0;

const options = readOptions(process.argv.slice(2));
mkdirSync(localRoot, { recursive: true });
const persistRoot = options.persistTo
  ? checkedPersistPath(options.persistTo)
  : mkdtempSync(path.join(localRoot, "ios-fixture-"));
mkdirSync(persistRoot, { recursive: true });

applyMigrations(persistRoot);

const backendOrigin = `http://127.0.0.1:${options.workerPort}`;
const publicOrigin = `http://127.0.0.1:${options.port}`;
let shuttingDown = false;
let server;
let localWorker;

try {
  localWorker = await unstable_dev(undefined, {
    config,
    local: true,
    port: options.workerPort,
    persistTo: persistRoot,
    logLevel: "error",
    latest: false,
    experimental: {
      disableDevRegistry: true,
      disableExperimentalWarning: true,
      forceLocal: true,
      showInteractiveDevSession: false,
      testMode: true
    }
  });
  server = createServer((request, response) => {
    handleRequest(request, response, backendOrigin).catch((error) => {
      sendJson(response, 500, { error: safeError(error) });
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", resolve);
  });
  process.stdout.write(`FIXTURE_READY ${JSON.stringify({
    origin: publicOrigin,
    persist_to: persistRoot
  })}\n`);
} catch (error) {
  if (localWorker) await localWorker.stop();
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { void shutdown(0); });
}

async function handleRequest(request, response, workerOrigin) {
  const url = new URL(request.url || "/", publicOrigin);
  if (url.pathname === "/v1/ios-update") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    if (publicOrigin !== updateFixtureOrigin || url.search !== "") {
      sendJson(response, 400, { error: "update_fixture_requires_exact_origin" });
      return;
    }
    sendJson(response, 200, {
      schema_version: 1,
      platform: "ios",
      version: "1.0.1",
      build: 2,
      minimum_ios: "16.0",
      ipa_url: updateFixtureOrigin + updateArtifactPath,
      size: updateArtifact.length,
      sha256: updateArtifactSha256
    });
    return;
  }
  if (url.pathname === updateArtifactPath) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    if (publicOrigin !== updateFixtureOrigin || url.search !== "") {
      sendJson(response, 400, { error: "update_fixture_requires_exact_origin" });
      return;
    }
    activeUpdateDownloads += 1;
    try { await sendSyntheticUpdateArtifact(response); }
    finally { activeUpdateDownloads -= 1; }
    return;
  }
  if (url.pathname === "/__fixture/health" && request.method === "GET") {
    if (!await workerAnnouncementsReady(workerOrigin)) {
      sendJson(response, 503, { error: "worker_not_ready" });
      return;
    }
    sendJson(response, 200, { ok: true, worker_origin: workerOrigin });
    return;
  }
  if (url.pathname === "/__fixture/update-state" && request.method === "GET") {
    sendJson(response, 200, { activeDownloads: activeUpdateDownloads });
    return;
  }
  if (url.pathname === "/__fixture/stats" && request.method === "GET") {
    await copyFetchResponse(response, await fetch(workerOrigin + "/__fixture-internal/stats", {
      headers: { authorization: `Bearer ${fixtureToken}` }
    }));
    return;
  }
  if (url.pathname.startsWith("/__fixture/")) {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const body = await readJson(request, 8192);
    if (url.pathname === "/__fixture/update-mode") {
      if (Object.keys(body).length !== 1 || !["normal", "blocked"].includes(body.mode)) {
        sendJson(response, 400, { error: "invalid_update_mode" });
        return;
      }
      updateDownloadMode = body.mode;
      sendJson(response, 200, { mode: updateDownloadMode });
      return;
    }
    if (url.pathname === "/__fixture/stop") {
      sendJson(response, 200, { ok: true });
      setTimeout(() => { void shutdown(0); }, 0);
      return;
    }
    if (url.pathname === "/__fixture/seed") {
      const build = readBuild(body.version_code, 42);
      await copyFetchResponse(response, await adminFetch(workerOrigin, "/admin/api/announcements", {
        method: "POST",
        body: fixtureAnnouncement(build)
      }));
      return;
    }
    if (url.pathname === "/__fixture/revise") {
      const id = readId(body.id);
      const existingResponse = await adminFetch(workerOrigin, `/admin/api/announcements/${id}`);
      if (!existingResponse.ok) {
        await copyFetchResponse(response, existingResponse);
        return;
      }
      const existing = (await existingResponse.json()).announcement;
      await copyFetchResponse(response, await adminFetch(workerOrigin, `/admin/api/announcements/${id}`, {
        method: "PUT",
        body: {
          status: existing.status,
          severity: existing.severity,
          title_zh: "[fixture] iOS 公告 v2",
          body_zh: "仅用于本地回归测试的修订公告。",
          button_zh: existing.button_zh,
          title_en: "[fixture] iOS announcement v2",
          body_en: "Synthetic revised announcement for local regression tests only.",
          button_en: existing.button_en,
          action_url: existing.action_url,
          platform: existing.platform,
          min_version_code: existing.min_version_code,
          max_version_code: existing.max_version_code,
          starts_at: existing.starts_at,
          ends_at: existing.ends_at
        }
      }));
      return;
    }
    if (url.pathname === "/__fixture/withdraw") {
      const id = readId(body.id);
      await copyFetchResponse(response, await adminFetch(
        workerOrigin,
        `/admin/api/announcements/${id}/withdraw`,
        { method: "POST", body: {} }
      ));
      return;
    }
    sendJson(response, 404, { error: "fixture_route_not_found" });
    return;
  }

  const requestBody = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await readBytes(request, 128 * 1024);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (!["host", "connection", "content-length", "transfer-encoding"].includes(name)) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
    }
  }
  const upstream = await fetch(workerOrigin + url.pathname + url.search, {
    method: request.method,
    headers,
    body: requestBody
  });
  await copyFetchResponse(response, upstream);
}

function fixtureAnnouncement(build) {
  return {
    status: "published",
    severity: "important",
    title_zh: "[fixture] iOS 公告 v1",
    body_zh: "仅用于本地回归测试的合成公告。",
    button_zh: "查看",
    title_en: "[fixture] iOS announcement v1",
    body_en: "Synthetic announcement for local regression tests only.",
    button_en: "Open",
    action_url: "",
    platform: "ios",
    min_version_code: build,
    max_version_code: build,
    starts_at: 0,
    ends_at: 0
  };
}

async function adminFetch(origin, pathname, { method = "GET", body } = {}) {
  const headers = { authorization: `Bearer ${fixtureToken}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(origin + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function applyMigrations(persistTo) {
  const result = spawnSync(process.execPath, [
    wranglerBin,
    "d1", "migrations", "apply", databaseName,
    "--local",
    "--config", config,
    "--persist-to", persistTo
  ], {
    cwd: root,
    env: {
      ...process.env,
      CI: "1",
      CLOUDFLARE_TELEMETRY_DISABLED: "1",
      WRANGLER_SEND_METRICS: "false"
    },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error("local_migration_failed");
  }
}

function readOptions(args) {
  const result = { port: 8787, workerPort: 8788, persistTo: "" };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (name === "--port" || name === "--worker-port" || name === "--persist-to") {
      if (!value) throw new Error(`missing_value:${name}`);
      if (name === "--port") result.port = readPort(value);
      if (name === "--worker-port") result.workerPort = readPort(value);
      if (name === "--persist-to") result.persistTo = value;
      index += 1;
    } else {
      throw new Error(`unknown_option:${name}`);
    }
  }
  if (result.port === result.workerPort) throw new Error("ports_must_differ");
  return result;
}

function readPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid_port");
  return port;
}

function checkedPersistPath(value) {
  const candidate = path.resolve(root, value);
  const rootWithSeparator = path.resolve(localRoot) + path.sep;
  if (!candidate.startsWith(rootWithSeparator)) throw new Error("persist_path_must_be_inside_.local");
  mkdirSync(candidate, { recursive: true });
  const resolved = realpathSync(candidate);
  if (!resolved.startsWith(rootWithSeparator)) throw new Error("persist_path_escaped_.local");
  return resolved;
}

function readBuild(value, fallback) {
  const build = value === undefined ? fallback : value;
  if (!Number.isInteger(build) || build < 1 || build > 2147483647) {
    throw new Error("invalid_version_code");
  }
  return build;
}

function readId(value) {
  if (!Number.isInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error("invalid_announcement_id");
  }
  return value;
}

async function readJson(request, limit) {
  const bytes = await readBytes(request, limit);
  if (bytes.length === 0) return {};
  const value = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("body_must_be_object");
  }
  return value;
}

async function readBytes(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("fixture_payload_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function copyFetchResponse(response, upstream) {
  // Node fetch transparently decompresses upstream bodies, so transport-level
  // encoding/length headers must be regenerated by this proxy.
  for (const [name, value] of upstream.headers) {
    if (!["connection", "content-encoding", "content-length", "transfer-encoding"].includes(name)) {
      response.setHeader(name, value);
    }
  }
  response.statusCode = upstream.status;
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

function sendJson(response, status, value) {
  if (response.headersSent) return;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
}

async function workerAnnouncementsReady(workerOrigin) {
  const url = new URL("/v1/announcements", workerOrigin);
  url.searchParams.set("platform", "ios");
  url.searchParams.set("version_code", "1");
  url.searchParams.set("locale", "en");
  try {
    const readiness = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(workerReadinessTimeoutMs)
    });
    if (readiness.status !== 200 ||
        !readiness.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      await readiness.body?.cancel();
      return false;
    }
    const body = await readiness.json();
    return body !== null && typeof body === "object" && !Array.isArray(body) &&
      Object.keys(body).sort().join(",") === "announcements,locale" &&
      body.locale === "en" && Array.isArray(body.announcements);
  } catch (_error) {
    return false;
  }
}

async function sendSyntheticUpdateArtifact(response) {
  const blocked = updateDownloadMode === "blocked";
  await new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    response.once("close", finish);
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(updateArtifact.length),
      "content-disposition": `attachment; filename="${updateArtifactName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-quareia-fixture": "public-testing-synthetic-not-installable"
    });
    response.flushHeaders();
    // Cancellation tests explicitly hold the body, avoiding a race with the UI.
    // Even a broken test cannot leave an unbounded request on the fixture.
    timer = setTimeout(() => {
      if (!response.destroyed && !response.writableEnded) {
        if (blocked) response.destroy();
        else response.end(updateArtifact);
      }
      finish();
    }, blocked ? 20_000 : updateArtifactDelayMs);
  });
}

function safeError(error) {
  const message = error && typeof error.message === "string" ? error.message : "fixture_error";
  return /^[a-z0-9_:.-]+$/i.test(message) ? message : "fixture_error";
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server) {
    server.close();
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  }
  try {
    if (localWorker) await localWorker.stop();
  } finally {
    process.exit(code);
  }
}
