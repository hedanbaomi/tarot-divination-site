// Validate an authenticated dashboard export and prepare idempotent D1 SQL.
// This tool never connects to Cloudflare or applies SQL; --sql only writes a file.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DAY = 86400000;
export const HISTORY_CUTOFF = "2026-11-09T00:00:00Z";
const HOST = "hedanbaomi.github.io";
const PATH = "/tarot-divination-site/";

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function exactKeys(value, keys, label) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), label + ": object required");
  requireValue(Object.keys(value).sort().join(",") === [...keys].sort().join(","), label + ": unexpected or missing fields");
}
function count(value) {
  requireValue(Number.isSafeInteger(value) && value >= 0 && value <= 1e12, "Invalid aggregate count");
  return value;
}
function utcTime(value) {
  requireValue(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value), "Invalid UTC timestamp");
  const ms = Date.parse(value);
  requireValue(Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19), "Invalid calendar timestamp");
  return ms;
}
function midnight(value) {
  const ms = utcTime(value);
  requireValue(value.endsWith("T00:00:00Z"), "Coverage boundaries must be complete UTC days");
  return ms;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

export function validateExport(input) {
  exactKeys(input, ["schema_version", "source", "host", "path", "site_tag", "site_created_at", "exported_at", "cutoff_utc", "exclude_bots", "batches"], "export");
  requireValue(input.schema_version === 1 && input.source === "cloudflare_web_analytics", "Unsupported export schema/source");
  requireValue(input.host === HOST && input.path === PATH && input.exclude_bots === true, "Wrong site or bot filter");
  requireValue(typeof input.site_tag === "string" && /^[0-9a-f]{32}$/.test(input.site_tag), "Invalid site tag");
  const created = utcTime(input.site_created_at);
  const cutoff = midnight(input.cutoff_utc);
  requireValue(cutoff <= midnight(HISTORY_CUTOFF), "History must end before the live-telemetry launch day");
  requireValue(utcTime(input.exported_at) >= cutoff, "Export predates its coverage");
  const start = Math.floor(created / DAY) * DAY;
  const coverageDays = (cutoff - start) / DAY;
  requireValue(Number.isInteger(coverageDays) && coverageDays >= 1 && coverageDays <= 186, "Invalid history coverage");
  requireValue(Array.isArray(input.batches) && input.batches.length > 0 && input.batches.length <= 12, "Invalid batch count");

  const daily = new Map();
  for (let ms = start; ms < cutoff; ms += DAY) {
    const utc_day = new Date(ms).toISOString().slice(0, 10);
    daily.set(utc_day, { utc_day, pageviews: 0, visits: 0, max_sample_interval: null, has_samples: 0 });
  }
  let expectedStart = start;
  let totalViews = 0;
  let totalVisits = 0;
  for (const batch of input.batches) {
    exactKeys(batch, ["from", "through", "site_tags", "bot", "total_pageviews", "total_visits", "paths", "rows"], "batch");
    const from = midnight(batch.from), through = midnight(batch.through);
    requireValue(from === expectedStart && through > from && through <= cutoff && through - from <= 31 * DAY, "Overlapping, missing or invalid batch coverage");
    requireValue(batch.bot === 0 && Array.isArray(batch.site_tags) && batch.site_tags.length === 1 && batch.site_tags[0] === input.site_tag, "Batch filter does not match source");
    const views = count(batch.total_pageviews), visits = count(batch.total_visits);
    requireValue(visits <= views, "Visits exceed page views");
    requireValue(Array.isArray(batch.paths) && batch.paths.length < 15, "Path breakdown may be truncated");
    let pathViews = 0, pathVisits = 0;
    const paths = new Set();
    for (const row of batch.paths) {
      requireValue(Array.isArray(row) && row.length === 3 && row[0] === PATH && !paths.has(row[0]), "Unverified or duplicate request path");
      paths.add(row[0]); pathViews += count(row[1]); pathVisits += count(row[2]);
    }
    requireValue(pathViews === views && pathVisits === visits, "Path totals do not reconcile");
    requireValue(Array.isArray(batch.rows) && batch.rows.length < 5000, "Series may be truncated");
    let rowViews = 0, rowVisits = 0, grain;
    const timestamps = new Set();
    for (const row of batch.rows) {
      requireValue(Array.isArray(row) && row.length === 4, "Invalid series row");
      const [ts, pv, vs, sample] = row;
      requireValue(typeof ts === "string" && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:00:00Z)?$/.test(ts), "Expected UTC date or hour buckets");
      const rowGrain = ts.length === 10 ? "day" : "hour";
      requireValue(!grain || grain === rowGrain, "Mixed series granularity"); grain = rowGrain;
      const ms = utcTime(ts.length === 10 ? ts + "T00:00:00Z" : ts);
      // Dashboard queries use inclusive through; refuse a boundary bucket instead
      // of silently counting it in both adjacent batches.
      requireValue(ms >= from && ms < through && !timestamps.has(ts), "Out-of-range or duplicate series bucket");
      timestamps.add(ts);
      count(pv); count(vs);
      requireValue(vs <= pv && typeof sample === "number" && Number.isFinite(sample) && sample >= 1, "Invalid sampled aggregate");
      rowViews += pv; rowVisits += vs;
      const day = daily.get(ts.slice(0, 10));
      day.pageviews += pv; day.visits += vs;
      day.max_sample_interval = Math.max(day.max_sample_interval || 1, sample);
      day.has_samples = 1;
    }
    requireValue(rowViews === views && rowVisits === visits, "Series totals do not reconcile");
    totalViews += views; totalVisits += visits;
    expectedStart = through;
  }
  requireValue(expectedStart === cutoff, "Missing final coverage");
  count(totalViews); count(totalVisits);
  const id = createHash("sha256").update(JSON.stringify(stable(input))).digest("hex");
  return {
    id, source: input.source, host: HOST, path: PATH,
    from_utc: new Date(start).toISOString().replace(".000Z", "Z"), cutoff_utc: input.cutoff_utc,
    exported_at: input.exported_at, coverage_days: coverageDays,
    pageviews: totalViews, visits: totalVisits, exclude_bots: 1,
    days_with_samples: [...daily.values()].filter(row => row.has_samples).length,
    rows: [...daily.values()]
  };
}

const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
export function buildImportSql(input) {
  const data = validateExport(input);
  const fields = ["id", "source", "host", "path", "from_utc", "cutoff_utc", "exported_at", "coverage_days", "pageviews", "visits", "exclude_bots"];
  const statements = [
    `INSERT INTO web_analytics_imports (${fields.join(", ")}) VALUES (${fields.map(key => quote(data[key])).join(", ")}) ON CONFLICT(id) DO NOTHING;`
  ];
  for (const row of data.rows) {
    statements.push(`INSERT INTO web_analytics_daily (import_id, utc_day, pageviews, visits, max_sample_interval, has_samples) VALUES (${quote(data.id)}, ${quote(row.utc_day)}, ${row.pageviews}, ${row.visits}, ${row.max_sample_interval === null ? "NULL" : row.max_sample_interval}, ${row.has_samples}) ON CONFLICT(import_id, utc_day) DO NOTHING;`);
  }
  // Only a complete, reconciled snapshot becomes visible. Re-running the same
  // source keeps both rows and publication time unchanged, even after a timeout.
  statements.push(`UPDATE web_analytics_imports SET published_at = CAST(strftime('%s', 'now') AS INTEGER)
WHERE id = ${quote(data.id)} AND published_at IS NULL
  AND (SELECT COUNT(*) FROM web_analytics_daily WHERE import_id = ${quote(data.id)}) = coverage_days
  AND (SELECT SUM(pageviews) FROM web_analytics_daily WHERE import_id = ${quote(data.id)}) = pageviews
  AND (SELECT SUM(visits) FROM web_analytics_daily WHERE import_id = ${quote(data.id)}) = visits;`);
  statements.push(`SELECT id, coverage_days, pageviews, visits, published_at FROM web_analytics_imports WHERE id = ${quote(data.id)};`);
  return { data, sql: statements.join("\n") + "\n" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    requireValue(args.length === 1 || (args.length === 3 && args[1] === "--sql"), "Usage: node tools/web-history-import.mjs export.json [--sql output.sql]");
    const raw = readFileSync(args[0], "utf8");
    requireValue(Buffer.byteLength(raw) <= 2 * 1024 * 1024, "Export too large");
    const { data, sql } = buildImportSql(JSON.parse(raw));
    if (args[2]) {
      if (existsSync(args[2])) requireValue(readFileSync(args[2], "utf8") === sql, "Output already exists with different contents");
      else writeFileSync(args[2], sql, { encoding: "utf8", flag: "wx" });
    }
    const { rows, ...summary } = data;
    console.log(JSON.stringify({ ...summary, estimated: true, applied: false, sql_file: args[2] || null }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
