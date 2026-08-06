// Tiny shared response helpers.

export function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

export function noStoreHeaders() {
  return { "cache-control": "no-store" };
}

/**
 * Strict security headers shared by the admin page, the admin API, and the
 * rate-limit responses those routes produce: no third-party scripts, no
 * framing, no referrer leakage, no MIME sniffing, and no caching.
 */
export function securityHeaders() {
  return {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; " +
      "frame-ancestors 'none'; object-src 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  };
}
