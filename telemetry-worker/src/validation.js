// Announcement input validation (admin create/update). Closed field
// allow-list: any unknown field is rejected, all strings are length-bounded,
// integers are range-bounded, and the action URL must be HTTPS.

export const SEVERITIES = ["info", "important", "update"];
export const PLATFORMS = ["all", "android", "web"];
export const STATUSES = ["draft", "published", "withdrawn"];
export const MAX_VERSION_CODE = 2147483647;
export const MAX_EPOCH = 2147483647;

export const FIELD_LIMITS = {
  title_zh: 200,
  title_en: 200,
  body_zh: 2000,
  body_en: 2000,
  button_zh: 60,
  button_en: 60,
  action_url: 2048
};

const ALLOWED_FIELDS = new Set([
  "severity",
  "status",
  "title_zh",
  "body_zh",
  "button_zh",
  "title_en",
  "body_en",
  "button_en",
  "action_url",
  "platform",
  "min_version_code",
  "max_version_code",
  "starts_at",
  "ends_at"
]);

/**
 * Validates a parsed JSON body for create/update. Returns
 * { ok: true, value } with normalized fields or { ok: false, error }.
 */
export function validateAnnouncementInput(body, { requireStatus = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "announcement_must_be_object" };
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return { ok: false, error: "unexpected_field:" + key };
    }
  }

  const value = {};

  if (requireStatus) {
    if (typeof body.status !== "string" || !STATUSES.includes(body.status)) {
      return { ok: false, error: "invalid_status" };
    }
    value.status = body.status;
  }

  if (typeof body.severity !== "string" || !SEVERITIES.includes(body.severity)) {
    return { ok: false, error: "invalid_severity" };
  }
  value.severity = body.severity;

  if (typeof body.platform !== "string" || !PLATFORMS.includes(body.platform)) {
    return { ok: false, error: "invalid_platform" };
  }
  value.platform = body.platform;

  for (const field of Object.keys(FIELD_LIMITS)) {
    const raw = body[field];
    if (raw === undefined || raw === null) {
      value[field] = "";
      continue;
    }
    if (typeof raw !== "string") return { ok: false, error: "invalid_field:" + field };
    const trimmed = raw.trim();
    if (trimmed.length > FIELD_LIMITS[field]) {
      return { ok: false, error: "field_too_long:" + field };
    }
    value[field] = trimmed;
  }

  if (value.action_url && !/^https:\/\//i.test(value.action_url)) {
    return { ok: false, error: "action_url_must_be_https" };
  }

  for (const field of ["min_version_code", "max_version_code"]) {
    const raw = body[field];
    if (raw === undefined || raw === null) {
      value[field] = field === "min_version_code" ? 0 : MAX_VERSION_CODE;
      continue;
    }
    if (!Number.isInteger(raw) || raw < 0 || raw > MAX_VERSION_CODE) {
      return { ok: false, error: "invalid_field:" + field };
    }
    value[field] = raw;
  }

  if (value.min_version_code > value.max_version_code) {
    return { ok: false, error: "min_version_above_max" };
  }

  for (const field of ["starts_at", "ends_at"]) {
    const raw = body[field];
    if (raw === undefined || raw === null) {
      value[field] = 0;
      continue;
    }
    if (!Number.isInteger(raw) || raw < 0 || raw > MAX_EPOCH) {
      return { ok: false, error: "invalid_field:" + field };
    }
    value[field] = raw;
  }

  if (value.ends_at !== 0 && value.starts_at !== 0 && value.ends_at < value.starts_at) {
    return { ok: false, error: "ends_before_starts" };
  }

  return { ok: true, value };
}
