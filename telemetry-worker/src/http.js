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
