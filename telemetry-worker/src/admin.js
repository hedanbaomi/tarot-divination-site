// Admin API: token-authenticated announcements CRUD + publish/withdraw and
// active-install statistics. Every admin response is Cache-Control: no-store.
// The token is read from the Authorization: Bearer header only and compared
// in constant time; all admin endpoints default to deny.

import { json, noStoreHeaders } from "./http.js";
import { nowSec } from "./clock.js";
import { constantTimeEqual } from "./security.js";
import { hasD1Binding } from "./announcements.js";
import { validateAnnouncementInput } from "./validation.js";
import { activeWindowCounts, versionDistribution } from "./stats.js";
import { ADMIN_PAGE_HTML } from "./admin-page.js";

const ALL_COLUMNS = `
  id, revision, status, severity, title_zh, body_zh, button_zh, title_en,
  body_en, button_en, action_url, platform, min_version_code, max_version_code,
  starts_at, ends_at, created_at, updated_at
`;

function adminToken(env) {
  return env && typeof env.ADMIN_TOKEN === "string" && env.ADMIN_TOKEN.length > 0
    ? env.ADMIN_TOKEN
    : null;
}

/**
 * Returns { ok: true } or { ok: false, status, error }.
 * Default deny: a missing secret or a mismatched token always rejects.
 */
export function checkAdmin(request, env) {
  const token = adminToken(env);
  if (!token) {
    return { ok: false, status: 503, error: "admin_unavailable" };
  }
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match || !constantTimeEqual(token, match[1])) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}

export function handleAdminPage() {
  return new Response(ADMIN_PAGE_HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer"
    }
  });
}

export async function handleAdminVerify(request, env) {
  const auth = checkAdmin(request, env);
  if (!auth.ok) {
    return json({ error: auth.error }, auth.status, noStoreHeaders());
  }
  return json({ ok: true }, 200, noStoreHeaders());
}

export async function handleAdminApi(request, env, pathname) {
  const auth = checkAdmin(request, env);
  if (!auth.ok) {
    return json({ error: auth.error }, auth.status, noStoreHeaders());
  }
  if (!hasD1Binding(env)) {
    return json({ error: "announcements_unavailable" }, 503, noStoreHeaders());
  }

  const parts = pathname.replace(/^\/admin\/api\//, "").split("/").filter(Boolean);

  if (parts[0] === "stats" && parts.length === 1 && request.method === "GET") {
    return handleStats(env);
  }

  if (parts[0] === "announcements" && parts.length === 1) {
    if (request.method === "GET") return listAnnouncements(env);
    if (request.method === "POST") return createAnnouncement(request, env);
  }

  if (parts[0] === "announcements" && parts.length === 2 && /^\d+$/.test(parts[1])) {
    const id = Number(parts[1]);
    if (request.method === "GET") return getAnnouncement(env, id);
    if (request.method === "PUT") return updateAnnouncement(request, env, id);
    if (request.method === "POST" && (parts[2] === undefined)) {
      return json({ error: "not_found" }, 404, noStoreHeaders());
    }
  }

  if (parts[0] === "announcements" && parts.length === 3 && /^\d+$/.test(parts[1])) {
    const id = Number(parts[1]);
    const action = parts[2];
    if (request.method === "POST" && (action === "publish" || action === "withdraw")) {
      return setAnnouncementStatus(env, id, action);
    }
  }

  return json({ error: "not_found" }, 404, noStoreHeaders());
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 65536) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 65536) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, status: 400, error: "body_must_be_object" };
    }
    return { ok: true, value: body };
  } catch (_e) {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}

function readError(read) {
  return json({ error: read.error }, read.status || 400, noStoreHeaders());
}

async function listAnnouncements(env) {
  const rows = await env.DB.prepare(
    `SELECT ${ALL_COLUMNS} FROM announcements ORDER BY id DESC`
  ).all();
  return json({ announcements: rows.results }, 200, noStoreHeaders());
}

async function getAnnouncement(env, id) {
  const row = await env.DB.prepare(
    `SELECT ${ALL_COLUMNS} FROM announcements WHERE id = ?`
  ).bind(id).first();
  if (!row) return json({ error: "not_found" }, 404, noStoreHeaders());
  return json({ announcement: row }, 200, noStoreHeaders());
}

async function createAnnouncement(request, env) {
  const read = await readJsonBody(request);
  if (!read.ok) return readError(read);

  const validated = validateAnnouncementInput(read.value, { requireStatus: true });
  if (!validated.ok) return json({ error: validated.error }, 400, noStoreHeaders());

  const value = validated.value;
  const now = nowSec();
  const result = await env.DB.prepare(
    `INSERT INTO announcements
       (revision, status, severity, title_zh, body_zh, button_zh, title_en, body_en,
        button_en, action_url, platform, min_version_code, max_version_code,
        starts_at, ends_at, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    value.status,
    value.severity,
    value.title_zh,
    value.body_zh,
    value.button_zh,
    value.title_en,
    value.body_en,
    value.button_en,
    value.action_url,
    value.platform,
    value.min_version_code,
    value.max_version_code,
    value.starts_at,
    value.ends_at,
    now,
    now
  ).run();

  const lastRowId = result.meta ? result.meta.last_row_id : null;
  const row = await env.DB.prepare(
    `SELECT ${ALL_COLUMNS} FROM announcements WHERE id = ?`
  ).bind(lastRowId).first();
  if (!row) return json({ error: "create_failed" }, 500, noStoreHeaders());
  return json({ announcement: row }, 200, noStoreHeaders());
}

async function updateAnnouncement(request, env, id) {
  const read = await readJsonBody(request);
  if (!read.ok) return readError(read);

  const validated = validateAnnouncementInput(read.value, { requireStatus: true });
  if (!validated.ok) return json({ error: validated.error }, 400, noStoreHeaders());

  const value = validated.value;
  const now = nowSec();
  const result = await env.DB.prepare(
    `UPDATE announcements SET
       revision = revision + 1, status = ?, severity = ?, title_zh = ?, body_zh = ?,
       button_zh = ?, title_en = ?, body_en = ?, button_en = ?, action_url = ?,
       platform = ?, min_version_code = ?, max_version_code = ?, starts_at = ?,
       ends_at = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    value.status,
    value.severity,
    value.title_zh,
    value.body_zh,
    value.button_zh,
    value.title_en,
    value.body_en,
    value.button_en,
    value.action_url,
    value.platform,
    value.min_version_code,
    value.max_version_code,
    value.starts_at,
    value.ends_at,
    now,
    id
  ).run();

  const changes = result.meta ? result.meta.changes : 0;
  if (changes === 0) {
    const exists = await env.DB.prepare("SELECT id FROM announcements WHERE id = ?").bind(id).first();
    if (!exists) return json({ error: "not_found" }, 404, noStoreHeaders());
  }

  const row = await env.DB.prepare(
    `SELECT ${ALL_COLUMNS} FROM announcements WHERE id = ?`
  ).bind(id).first();
  if (!row) return json({ error: "update_failed" }, 500, noStoreHeaders());
  return json({ announcement: row }, 200, noStoreHeaders());
}

async function setAnnouncementStatus(env, id, action) {
  const status = action === "publish" ? "published" : "withdrawn";
  const now = nowSec();
  const result = await env.DB.prepare(
    "UPDATE announcements SET status = ?, revision = revision + 1, updated_at = ? WHERE id = ?"
  ).bind(status, now, id).run();

  const changes = result.meta ? result.meta.changes : 0;
  if (changes === 0) {
    const exists = await env.DB.prepare("SELECT id FROM announcements WHERE id = ?").bind(id).first();
    if (!exists) return json({ error: "not_found" }, 404, noStoreHeaders());
  }

  const row = await env.DB.prepare(
    `SELECT ${ALL_COLUMNS} FROM announcements WHERE id = ?`
  ).bind(id).first();
  return json({ announcement: row }, 200, noStoreHeaders());
}

async function handleStats(env) {
  const [windows, distribution] = await Promise.all([
    activeWindowCounts(env),
    versionDistribution(env)
  ]);
  return json(
    {
      generated_at: nowSec(),
      windows,
      total_installs: distribution.total_installs,
      by_version: distribution.by_version
    },
    200,
    noStoreHeaders()
  );
}
