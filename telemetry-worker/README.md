# Quareia Telemetry Worker

Anonymous, opt-out usage-statistics ingest for the **Quareia Divination Android
app**. It stores aggregate signals only: active-device events, deck usage, and
completed-reading counts. It never stores raw IP addresses, request bodies,
card faces, card names, orientations, spread layouts, questions, notes, or
local history.

> **Status: code only — not deployed.** This directory contains the worker,
> reproducible tests, and deployment notes. No deployment is performed by this
> repository, and nothing here touches the existing website, R2, VPS, DNS, or
> Cloudflare configuration outside the worker's own future binding.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/v1/events` | Accepts one event or a small array, validates the closed schema, writes to Analytics Engine, and returns `204`. Invalid/oversized requests return `400`/`413`; rate-limited requests return `429`; a missing `TELEMETRY` binding returns `503`. |
| `GET` | `/health` | Returns `200 {"ok":true}`. |

## Event schema (closed allow-list)

Every event must carry these fields:

| Field | Type | Notes |
|---|---|---|
| `schema_version` | int | Must be exactly `1`. |
| `event` | string | `install_seen`, `daily_active`, or `reading_completed`. |
| `install_hash` | string | 64-character lowercase hexadecimal SHA-256 of a random per-install UUID; the raw UUID is never sent. |
| `app_version` | string | Android app version name. |
| `locale` | string | BCP-47 language tag, such as `zh-CN`. |
| `android_major` | int | Inclusive range `1..100`. |

`reading_completed` additionally carries:

| Field | Type | Notes |
|---|---|---|
| `deck_type` | string | `tarot`, `mystagogus`, or `lxxxi`. |
| `card_count` | int | Number of cards in the finished spread, `1..81`. |

Any field not listed above is rejected with HTTP `400`. This includes card IDs,
card names, orientations, positions, questions, notes, history, raw IP, and
User-Agent.

## Analytics Engine data-point mapping

The worker writes one data point for each accepted event. Arrays are positional:

| Array | Position | Value |
|---|---:|---|
| `blobs` | `blob1` | `event` |
|  | `blob2` | `install_hash` |
|  | `blob3` | `deck_type`, or `""` for non-reading events |
|  | `blob4` | Cloudflare connection country code, or `"??"` |
|  | `blob5` | `app_version` |
|  | `blob6` | `locale` |
| `doubles` | `double1` | `card_count`, or `0` for non-reading events |
|  | `double2` | `android_major` |
| `indexes` | `index1` | `install_hash` — the only index |

Analytics Engine currently accepts an ordered array with one sampling index;
passing multiple indexes prevents the data point from being recorded. See the
[official write and binding documentation](https://developers.cloudflare.com/analytics/analytics-engine/get-started/).

## Privacy contract (enforced in code)

- The UTF-8 encoded request body is capped at **1 KiB** (`413` if exceeded).
- The server temporarily reads the connection IP for rate limiting and abuse
  prevention. It trusts only Cloudflare's `CF-Connecting-IP` header, ignores
  client-controlled `X-Forwarded-For`, and keeps only a process-local rolling
  bucket key. It does not save the raw IP or a persistent IP digest in
  Analytics Engine, D1, logs, or responses.
- Analytics Engine stores only the connection country code; it does not store a
  city, region, coordinate, or IP field.
- Timestamps come from the server clock; client timestamps are not accepted.
- Rate-limit buckets are in-memory only and are not a metering or analytics
  dataset.

## Reproducible local checks

No Cloudflare binding is needed for the test suite; the tests use a mock
Analytics Engine binding and never deploy the worker.

```bash
npm ci
npm test
node --check src/index.js
```

## Deploy (manual, requires Cloudflare access)

Deployment is intentionally outside this task. If an authorized operator later
deploys this worker:

1. Run `npm ci` and `npx wrangler login` in this directory.
2. Keep the `[[analytics_engine_datasets]]` block in `wrangler.toml` and change
   only the dataset name if a different stable name is required. The dataset is
   created automatically by Cloudflare on the first write after the binding is
   configured; do **not** create it manually in the dashboard first.
3. Run `npx wrangler deploy` only in an explicitly authorized deployment window.
4. Bind `telemetry.luotianyi.fun` separately through the Cloudflare Workers
   custom-domain/route UI if that hostname is required.

The [Cloudflare Analytics Engine getting-started guide](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)
documents the current binding, automatic dataset creation, and single-index
rules.

## Querying Analytics Engine

Replace `quareia_telemetry` below if the dataset name in `wrangler.toml` is
changed. Analytics Engine can sample rows. For event counts and numeric sums,
use `_sample_interval` as the row weight; for averages, weight both the sum and
the denominator. The [SQL API documentation](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)
and [sampling guide](https://developers.cloudflare.com/analytics/analytics-engine/sampling/)
describe these rules.

**Daily active-device events (one `daily_active` per install per UTC day)**

```sql
SELECT
  intDiv(toUInt32(timestamp), 86400) AS utc_day,
  SUM(_sample_interval) AS active_devices
FROM quareia_telemetry
WHERE blob1 = 'daily_active'
GROUP BY utc_day
ORDER BY utc_day DESC;
```

**Install events**

```sql
SELECT SUM(_sample_interval) AS installs
FROM quareia_telemetry
WHERE blob1 = 'install_seen';
```

**Completed readings by deck**

```sql
SELECT
  blob3 AS deck_type,
  SUM(_sample_interval) AS readings
FROM quareia_telemetry
WHERE blob1 = 'reading_completed'
GROUP BY deck_type
ORDER BY readings DESC;
```

**Average cards drawn by deck**

```sql
SELECT
  blob3 AS deck_type,
  SUM(_sample_interval * double1) / SUM(_sample_interval) AS avg_card_count
FROM quareia_telemetry
WHERE blob1 = 'reading_completed'
GROUP BY deck_type;
```

**Country-level install events**

```sql
SELECT
  blob4 AS country,
  SUM(_sample_interval) AS installs
FROM quareia_telemetry
WHERE blob1 = 'install_seen'
GROUP BY country
ORDER BY installs DESC;
```

These queries cannot reveal card faces, names, orientations, spread layouts,
questions, notes, history, raw IP, or a persistent IP digest because none of
those values are written.
