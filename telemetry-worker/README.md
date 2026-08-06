# Quareia Telemetry Worker

Anonymous, opt-out usage-statistics ingest for the **Quareia Divination Android
app**. It stores aggregate signals only: active-device events, deck usage, and
completed-reading counts. It never stores raw IP addresses, request bodies,
card faces, card names, orientations, spread layouts, questions, notes, or
local history.

> **Status: deployed.** The first authorized deployment record is in
> [`DEPLOYMENT.md`](DEPLOYMENT.md). No deployment is performed automatically by
> this repository, and nothing here touches the existing website, R2, VPS, or
> Cloudflare configuration outside this worker's binding.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/v1/events` | Accepts exactly one JSON event object, validates the closed schema, writes one Analytics Engine data point, returns `204`. `app_active` additionally upserts the anonymous install state in D1. Arrays, invalid requests, and oversized requests return `400`/`413`; rate-limited requests return `429`; a missing binding or synchronous write failure returns `503`. |
| `GET` | `/v1/announcements` | Public announcements for a platform/version/locale; ETag + `If-None-Match` (`304`) and short `public` caching. Never requires an install_hash and never writes per-device state. |
| `GET` | `/admin` | Same-origin admin page (announcements CRUD + active-install statistics). HTML only; all API calls use the token from `sessionStorage`. |
| `POST` | `/admin/verify` | `204`-class token check (`200 {"ok":true}`); `401` on a bad token. |
| `*` | `/admin/api/*` | Token-authenticated announcements CRUD, publish/withdraw, and statistics. All responses are `Cache-Control: no-store` and default to deny. |
| `GET` | `/health` | Returns `200 {"ok":true}`. |
| cron | `0 3 * * *` | Deletes `install_state` rows inactive for more than 90 days. |

The POST body is one event object, never an array. Rejecting arrays prevents a
partially written batch if a later event is invalid or the Analytics Engine
binding fails during a batch.

## Event schema (closed allow-list)

Every event must carry these fields:

| Field | Type | Notes |
|---|---|---|
| `schema_version` | int | Must be exactly `1`. |
| `event` | string | `install_seen`, `daily_active`, `reading_completed`, or `app_active`. |
| `install_hash` | string | 64-character lowercase hexadecimal SHA-256 of a random per-install UUID; the raw UUID is never sent. |
| `app_version` | string | Android app version name. |
| `locale` | string | BCP-47 language tag, such as `zh-CN`. |
| `android_major` | int | Inclusive range `1..100`. |

`reading_completed` additionally carries:

| Field | Type | Notes |
|---|---|---|
| `deck_type` | string | `tarot`, `mystagogus`, or `lxxxi`. |
| `card_count` | int | Number of cards in the finished spread, `1..81`. |

`app_active` additionally carries:

| Field | Type | Notes |
|---|---|---|
| `version_code` | int | Android `versionCode`, inclusive range `1..2147483647`. |

Any field not listed above is rejected with HTTP `400`. This includes card IDs,
card names, orientations, positions, questions, notes, history, raw IP, and
User-Agent.

`app_active` is emitted by the Android app on first launch, on returning to the
foreground, and immediately when the installed version changes. The client
sends it at most once per 6 hours for the same version. `app_active` and the
legacy `daily_active` are the only events that write to D1: the install is
upserted into `install_state` (new installs get `first_seen_at`/`last_seen_at`;
upgrades move the row to the new version group while preserving
`first_seen_at`). Legacy `daily_active` events from v1.1 clients carry no
`version_code` and are stored as `0` ("unknown/legacy" in the admin console) —
they still count towards the active-install windows and the per-`app_version`
distribution. A later `app_active` from the same install overwrites the row
with the real `version_code`, so upgraded installs move out of the legacy
group. A row with the same `version_code` seen less than 6 hours ago is not
written again, which keeps D1 writes low. `install_seen` and
`reading_completed` never touch D1 (old clients cannot break and no
reading/install metadata is retained beyond the approved columns).

## D1 schema

See `migrations/0001_init.sql`. Two tables:

- `announcements` — id, revision (incremented on every edit/publish/withdraw),
  status (`draft`/`published`/`withdrawn`), severity
  (`info`/`important`/`update`), zh/en title/body/button, optional HTTPS-only
  `action_url`, platform (`all`/`android`/`web`), min/max `version_code`,
  `starts_at`/`ends_at` (epoch seconds, `0` = unlimited), `created_at`,
  `updated_at`. All content is plain text; the client never renders HTML.
- `install_state` — `install_hash` (primary key), `app_version`,
  `version_code`, `locale`, `android_major`, `first_seen_at`, `last_seen_at`.
  No raw IP, IP digest, User-Agent, device model, city, card, spread, question,
  note, or history is ever stored. The daily cron deletes rows inactive for
  more than 90 days.

## Announcements API

```text
GET /v1/announcements?platform=android&version_code=4&locale=zh-CN
```

Returns only announcements that are `published`, already started, not expired,
and matching the platform (`android`/`web`, plus `all`) and version range.
Results are ordered by severity (`update` > `important` > `info`), then publish
time, then id. The response is a stable schema:

```json
{
  "announcements": [
    {
      "id": 1, "revision": 2, "severity": "update",
      "title": "...", "body": "...", "button": "立即更新",
      "action_url": "https://example.com/update",
      "platform": "all", "min_version_code": 0,
      "max_version_code": 2147483647, "starts_at": 0, "ends_at": 0,
      "updated_at": 1754300000
    }
  ],
  "locale": "zh-CN"
}
```

The `ETag` is a content hash over `(id, revision, updated_at)`, so any edit or
withdrawal changes it and busts the short `public, max-age=300` cache. The
client tracks reads locally as `id + revision`, so an edited announcement
reappears.

## Admin API

All admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>`; the token
is compared in constant time and the endpoints default to deny (401 on a bad
token, 503 when the secret is unset). It is never accepted in URLs, query
strings, logs, or client storage other than `sessionStorage` in the admin page.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/admin/api/announcements` | List all announcements, newest first. |
| `POST` | `/admin/api/announcements` | Create (revision 1; closed allow-list, length/range bounds, HTTPS-only `action_url`). |
| `GET` | `/admin/api/announcements/:id` | Fetch one announcement. |
| `PUT` | `/admin/api/announcements/:id` | Update; `revision` and `updated_at` bump. |
| `POST` | `/admin/api/announcements/:id/publish` | Set `published`; `revision` bumps. |
| `POST` | `/admin/api/announcements/:id/withdraw` | Set `withdrawn`; `revision` bumps. |
| `GET` | `/admin/api/stats` | Active installs in the last 24h/7d/30d windows, total installs, and the per-version distribution grouped by each install's most recently reported version with percentages, plus `generated_at` and window sizes. Rows with `version_code 0` are legacy v1.1 clients without a known version code; they are labelled "未知/旧客户端" in the console and still counted under their `app_version`. |

Statistics wording is always "活跃安装数/活跃设备数" (active installs /
active devices), never exact user counts: the numbers come from 6-hourly
anonymous `app_active` and `daily_active` reports and are an estimate, not a
precise audience.

Every admin response is `Cache-Control: no-store` with a strict
`Content-Security-Policy` (`frame-ancestors 'none'`, no third-party scripts),
`Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. The admin
page is served same-origin at `/admin`, loads no third-party JS or CSS, renders
announcement content with DOM/text APIs — never `innerHTML` — and never puts
the token in console output, error strings, or the page source; the token lives
only in `sessionStorage` and is cleared on logout.

## Analytics Engine data-point mapping

The worker writes one data point for each accepted event. Arrays are positional:

| Array | Position | Value |
|---|---:|---|
| `blobs` | `blob1` | `event` |
|  | `blob2` | `install_hash` |
|  | `blob3` | `deck_type`, or `""` for non-reading events |
|  | `blob4` | Cloudflare connection country code, or `""` |
|  | `blob5` | `subdivision_code`, `country-regionCode`, or `""` |
|  | `blob6` | Cloudflare first-level subdivision name, capped at 64 characters, or `""` |
|  | `blob7` | `app_version` |
|  | `blob8` | `locale` |
| `doubles` | `double1` | `card_count`, or `0` for non-reading events |
|  | `double2` | `android_major` |
| `indexes` | `index1` | `install_hash` — the only index |

Analytics Engine currently accepts an ordered array with one sampling index;
passing multiple indexes prevents the data point from being recorded. See the
[official write and binding documentation](https://developers.cloudflare.com/analytics/analytics-engine/get-started/).

The Analytics Engine dataset currently retains data for **three months**, so it
is suitable for rolling trend statistics rather than a historical archive; see
Cloudflare's [current limits and retention documentation](https://developers.cloudflare.com/analytics/analytics-engine/limits/).
The worker sends exactly one index and the fixed blob/double order above.

## Privacy contract (enforced in code)

- The UTF-8 encoded request body is capped at **1 KiB** (`413` if exceeded).
- The server temporarily reads the connection IP for rate limiting and abuse
  prevention. It trusts only Cloudflare's `CF-Connecting-IP` header, ignores
  client-controlled `X-Forwarded-For`, and keeps only process-local rolling
  buckets. It does not save the raw IP or a persistent IP digest in Analytics
  Engine, D1, logs, or responses.
- Cloudflare derives the country and first-level subdivision fields from the
  connection IP. Analytics Engine stores only the country code, the combined
  `subdivision_code`, and the capped first-level `region_name`; it does not
  store city, postal code, latitude, longitude, metro code, or any IP field.
  `region` and `regionCode` may be missing. VPNs, proxies, and mobile-carrier
  exits can make the inferred location inaccurate; these fields must not be
  interpreted as the user's precise residence.
- No client-supplied country, region, or subdivision field is accepted, and no
  third-party IP geolocation service is called.
- Timestamps come from the server clock; client timestamps are not accepted.
- Rate-limit buckets are in-memory only and are not a metering or analytics
  dataset.
- D1 stores only the anonymous per-install state listed under "D1 schema" and
  the admin-authored announcements; it never receives an IP, User-Agent,
  device model, city, card, spread, question, note, or history value, and rows
  older than 90 days are deleted daily.
- Announcement content is plain text end to end: the admin page writes it with
  DOM APIs, the worker passes it through verbatim, and the Android client
  renders it as plain text (never HTML).

## Reproducible local checks

No Cloudflare binding is needed for the test suite; the tests run the real
migration SQL against an in-memory SQLite database and mock the Analytics
Engine binding. They never deploy the worker or touch production data.

```bash
# Mandatory clean-environment gate before any authorized deployment:
npm ci
npm test
node --check src/index.js
npx wrangler d1 migrations apply quareia --local
```

`npm ci` must be run from a clean checkout or temporary clean directory using
the committed `package-lock.json`; do not substitute `npm install`.

## Deployment (manual, requires Cloudflare access)

The production endpoint and custom-domain state are recorded in
[`DEPLOYMENT.md`](DEPLOYMENT.md). If an authorized operator deploys a later
worker revision:

1. Run `npm ci` and `npx wrangler login` in this directory.
2. Keep the `[[analytics_engine_datasets]]` block in `wrangler.toml` and change
   only the dataset name if a different stable name is required. The dataset is
   created automatically by Cloudflare on the first write after the binding is
   configured; do **not** create it manually in the dashboard first.
3. Create the D1 database with `npx wrangler d1 create quareia`, replace the
   placeholder `database_id` in `wrangler.toml` with the returned id, and apply
   the committed migrations with `npx wrangler d1 migrations apply quareia`.
4. Set the admin secret with `npx wrangler secret put ADMIN_TOKEN`; the token
   is never stored in the repository, wrangler.toml, URLs, or logs.
5. Run `npx wrangler deploy` only in an explicitly authorized deployment window.
6. Keep the existing `telemetry.luotianyi.fun` Custom Domain attached to this
   worker; do not add a broad route or change other DNS records.

Run the clean-environment `npm ci` gate before every authorized deployment.
Do not place API tokens, account identifiers, OAuth credentials, or local
`.env`/`.dev.vars` files in this repository.

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

**First-level subdivision install events**

```sql
SELECT
  blob5 AS subdivision_code,
  SUM(_sample_interval) AS installs
FROM quareia_telemetry
WHERE blob1 = 'install_seen' AND blob5 <> ''
GROUP BY subdivision_code
ORDER BY installs DESC;
```

**First-level subdivision active-device events**

`daily_active` is emitted at most once per install hash per UTC day by the
Android client. The query therefore counts sampled daily-active events by
subdivision; it is not a deduplicated historical residence count.

```sql
SELECT
  blob5 AS subdivision_code,
  SUM(_sample_interval) AS active_device_events
FROM quareia_telemetry
WHERE blob1 = 'daily_active' AND blob5 <> ''
GROUP BY subdivision_code
ORDER BY active_device_events DESC;
```

**Completed readings by first-level subdivision and deck**

```sql
SELECT
  blob5 AS subdivision_code,
  blob3 AS deck_type,
  SUM(_sample_interval) AS readings
FROM quareia_telemetry
WHERE blob1 = 'reading_completed' AND blob5 <> ''
GROUP BY subdivision_code, deck_type
ORDER BY readings DESC;
```

These queries cannot reveal card faces, names, orientations, spread layouts,
questions, notes, history, raw IP, or a persistent IP digest because none of
those values are written. All event counts use `SUM(_sample_interval)` because
Analytics Engine may sample rows; see the [sampling guide](https://developers.cloudflare.com/analytics/analytics-engine/sampling/).
