// Admin API: token-authenticated announcements CRUD + publish/withdraw and
// active-install statistics. Every admin response is Cache-Control: no-store
// with a strict Content-Security-Policy (no third-party scripts, no framing),
// no-referrer, and nosniff. The token is read from the Authorization: Bearer
// header only and compared in constant time; all admin endpoints default to
// deny. The admin page is self-contained (inline CSS/JS only, no third-party
// resources) and keeps the token in sessionStorage, cleared on logout.

import { json } from "./http.js";
import { nowSec } from "./clock.js";
import { constantTimeEqual } from "./security.js";
import { hasD1Binding } from "./announcements.js";
import { validateAnnouncementInput } from "./validation.js";
import { activeWindowCounts, versionDistribution } from "./stats.js";
import { ADMIN_PAGE_HTML } from "./admin-page.js";

const ADMIN_SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; " +
    "frame-ancestors 'none'; object-src 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
};

function adminJson(obj, status) {
  return json(obj, status, ADMIN_SECURITY_HEADERS);
}

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
      ...ADMIN_SECURITY_HEADERS
    }
  });
}

export async function handleAdminVerify(request, env) {
  const auth = checkAdmin(request, env);
  if (!auth.ok) {
    return adminJson({ error: auth.error }, auth.status);
  }
  return adminJson({ ok: true }, 200);
}

export async function handleAdminApi(request, env, pathname) {
  const auth = checkAdmin(request, env);
  if (!auth.ok) {
    return adminJson({ error: auth.error }, auth.status);
  }
  if (!hasD1Binding(env)) {
    return adminJson({ error: "announcements_unavailable" }, 503);
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
    if (request.method === "POST") {
      return adminJson({ error: "not_found" }, 404);
    }
  }

  if (parts[0] === "announcements" && parts.length === 3 && /^\d+$/.test(parts[1])) {
    const id = Number(parts[1]);
    const action = parts[2];
    if (request.method === "POST" && (action === "publish" || action === "withdraw")) {
      return setAnnouncementStatus(env, id, action);
    }
  }

  return adminJson({ error: "not_found" }, 404);
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
  return adminJson({ error: read.error }, read.status || 400);
}

async function listAnnouncements(env) {
  const rows = await env.DB.prepare(
    `SELECT ${ALL_COLUMNS} FROM announcements ORDER BY id DESC`
  ).all();
  return adminJson({ announcements: rows.results }, 200);
}

async function getAnnouncement(env, id) {
  const row = await env.DB.prepare(
    `SELECT ${ALL_COLUMNS} FROM announcements WHERE id = ?`
  ).bind(id).first();
  if (!row) return adminJson({ error: "not_found" }, 404);
  return adminJson({ announcement: row }, 200);
}

async function createAnnouncement(request, env) {
  const read = await readJsonBody(request);
  if (!read.ok) return readError(read);

  const validated = validateAnnouncementInput(read.value, { requireStatus: true });
  if (!validated.ok) return adminJson({ error: validated.error }, 400);

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
  if (!row) return adminJson({ error: "create_failed" }, 500);
  return adminJson({ announcement: row }, 200);
}

async function updateAnnouncement(request, env, id) {
  const read = await readJsonBody(request);
  if (!read.ok) return readError(read);

  const validated = validateAnnouncementInput(read.value, { requireStatus: true });
  if (!validated.ok) return adminJson({ error: validated.error }, 400);

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
    if (!exists) return adminJson({ error: "not_found" }, 404);
  }

  const row = await env.DB.prepare(
    `SELECT ${ALL_COLUMNS} FROM announcements WHERE id = ?`
  ).bind(id).first();
  if (!row) return adminJson({ error: "update_failed" }, 500);
  return adminJson({ announcement: row }, 200);
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
    if (!exists) return adminJson({ error: "not_found" }, 404);
  }

  const row = await env.DB.prepare(
    `SELECT ${ALL_COLUMNS} FROM announcements WHERE id = ?`
  ).bind(id).first();
  return adminJson({ announcement: row }, 200);
}

async function handleStats(env) {
  const [windows, distribution] = await Promise.all([
    activeWindowCounts(env),
    versionDistribution(env)
  ]);
  return adminJson(
    {
      generated_at: nowSec(),
      windows,
      total_installs: distribution.total_installs,
      by_version: distribution.by_version
    },
    200
  );
}
