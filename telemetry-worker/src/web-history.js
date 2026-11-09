import { json, securityHeaders } from "./http.js";

// Read only: imports are validated offline and published through the operator's
// D1 tooling. No ingestion/authentication surface is added to the public Worker.
export async function handleWebHistory(request, env) {
  const headers = securityHeaders();
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { ...headers, Allow: "GET" });
  try {
    const batch = await env.DB.prepare(
      "SELECT id, source, host, path, from_utc, cutoff_utc, exported_at, coverage_days, pageviews, visits, published_at " +
      "FROM web_analytics_imports WHERE published_at IS NOT NULL " +
      "ORDER BY exported_at DESC, published_at DESC, id DESC LIMIT 1"
    ).first();
    if (!batch) return json({ module: "web_history", available: true, imported: false, rows: [] }, 200, headers);
    const result = await env.DB.prepare(
      "SELECT utc_day, pageviews, visits, max_sample_interval, has_samples " +
      "FROM web_analytics_daily WHERE import_id = ? ORDER BY utc_day LIMIT 187"
    ).bind(batch.id).all();
    const rows = result.results;
    if (rows.length !== batch.coverage_days || rows.length > 186 ||
        rows.reduce((sum, row) => sum + row.pageviews, 0) !== batch.pageviews ||
        rows.reduce((sum, row) => sum + row.visits, 0) !== batch.visits) throw new Error("incomplete_history");
    const { id, ...metadata } = batch;
    return json({ module: "web_history", available: true, imported: true, ...metadata,
      estimated: true, exclude_bots: true, bucket_basis: "utc_day",
      days_with_samples: rows.filter(row => row.has_samples).length, rows
    }, 200, headers);
  } catch (_error) {
    return json({ module: "web_history", available: false, error: "web_history_unavailable" }, 503, headers);
  }
}
