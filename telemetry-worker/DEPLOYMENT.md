# Quareia Telemetry Worker deployment record

## 2026-11-09: Cloudflare Web Analytics historical backfill

- Source: `64a2548f5f782f747832eea4d9ecceb86395a287`; deployed Worker version
  `a99bbdb4-5e5d-4367-b510-44cd90a84384` on the existing custom domain, preserving
  existing variables and bindings with `--keep-vars`.
- Applied additive migration `0005_web_analytics_history.sql`, then imported the
  validated aggregate dashboard snapshot. Its day count, page-view total and visit
  total reconciled with the exported source; exactly one snapshot was published.
  Existing per-platform client aggregates and announcement count/revisions matched
  their pre-import values. A D1 Time Travel bookmark was saved before import.
- Export coverage starts on the site-creation UTC day and ends before
  `2026-11-09T00:00:00Z`. Archived figures retain Cloudflare's bot exclusion and
  sampling semantics. The separate admin panel does not combine them with live
  users, installs, visits or readings. Days without returned samples are marked.
- Validation: 171 Worker tests passed after clean `npm ci`; local Wrangler
  migrations, actual aggregate import and deployment dry-run passed. Browser
  inspection verified summary values, all date rows, repeat refresh and independence
  from the live-history filters. DSH / DeepSeek V4.1 Flash completed independent
  source review with no blocking findings; a bounded native follow-up found none
  in the migration/import/auth paths either.
- Production checks: health, admin security headers/inline JavaScript, exact admin
  HTML match, unauthenticated history denial, event preflight, and unchanged iOS
  update response passed. The production D1 snapshot was checked directly; the
  authenticated visual check used the same snapshot and Worker in local preview.
- Export, import SQL, before/after evidence and screenshot remain in ignored local
  files. No source data or credentials were committed. Rollback may unpublish the
  specific archive snapshot or restore the previous Worker; leave live data and
  additive schema intact.

## 2026-11-09: authorized unified telemetry release

- Worker source: `a0df351de0b0a00200893ed8bc9da74377dd41f0`.
- Deployed Worker version: `2230754f-fe46-4c5b-b8f3-e56c0830e154` on the existing
  `telemetry.luotianyi.fun` domain. Existing bindings and variables were preserved.
- Remote migration `0004_web_platform.sql` applied successfully; already-applied
  `0003_ios_platform.sql` was not replayed. Per-platform record counts and the
  iOS-major aggregate were identical immediately before and after migration.
  A pre-deployment D1 Time Travel bookmark was recorded locally.
- Clean release gate: 198 web/Android tests and 148 Worker tests passed, followed
  by local migrations 0001–0004 and a Worker dry-run. DSH / DeepSeek V4.1 Flash
  independently reviewed the reconciled native-platform and migration paths and
  found no blocking issue.
- Live backend checks passed: `/health`, allowed-origin POST preflight, web/iOS
  admin options, admin security headers and JavaScript parsing. The existing
  `/v1/ios-update` unconfigured 404 response is preserved.
- Website delivery uses GitHub Pages from `main` at `/`. Publication and final
  browser acceptance are tracked in [release PR #3](https://github.com/hedanbaomi/tarot-divination-site/pull/3).
  This release does not publish a new Android or iOS binary.

## 2026-11-09: unified web telemetry, pre-release validation

This revision adds `platform=web`, the `web_visit` counter, the guarded web
collector, and combined web/mobile admin displays. The following validation was
completed locally before the authorized production release recorded above.

The authorized release preflight subsequently found that production already
runs the iOS Worker code and `0003_ios_platform.sql`, from the historical
`b228954` source line, while main did not contain them. The matching Worker
modules and original iOS migration were restored before deployment. The web
migration is therefore `0004_web_platform.sql` and preserves `ios_major` and all
native client rows. The existing `/v1/ios-update` route is preserved; its
pre-release production response was the unconfigured `ios_update_unavailable`
404. No iOS application source or signing configuration is part of this change.

After this compatibility reconciliation, 148 Worker tests passed alongside the
198 web/Android JavaScript tests. Production source and schema were checked
read-only before applying any migration.
The downloaded deployed bundle exactly matched a fresh build of `b228954`
after normalizing line endings and the source-map footer, confirming the source
baseline used for this compatibility reconciliation.

Local validation completed on 2026-11-09:

- Web/Android JavaScript suites: 198/198 passed; Worker suites: 132/132 passed.
- A fresh temporary dependency install via `npm ci --no-audit --no-fund`,
  Worker tests, local Wrangler D1 migrations 0001–0003, and `wrangler deploy
  --dry-run` all passed. Populated migration tests preserve Android/WeChat rows,
  timestamps, primary key uniqueness and both indexes.
- A localhost-only preview using synthetic Analytics data and in-memory D1
  verified the real web collector → Worker → admin flow, manual/bulk reveal,
  web platform and 7-day filtering, persistent opt-out and same-document visit
  deduplication after turning statistics back on. The preview substitutes its
  local transport/origin; production CORS is covered by request-level tests.
- Independent read-only DSH / DeepSeek V4.1 Flash review completed. Its confirmed
  same-document duplicate-visit finding was fixed and verified by regression
  tests and the browser preview. No production authenticated API or physical
  device acceptance was performed.

Release procedure:

1. Run the clean-checkout `npm ci` gate and local tests described in README.
2. Verify production has all prior migrations, then apply
   `0004_web_platform.sql` before enabling the new Worker or website collector.
   It copies old install rows and preserves the primary key and both indexes.
3. Deploy the Worker and verify its health and allowed-origin preflight; confirm
   the existing Analytics read configuration is present without exposing secrets.
4. Publish the website assets (`index.html`, `js/app.js`, `js/i18n.js`, and
   `js/web-telemetry.js`) together. The backend must be ready first.
5. The Android JS assets also align manual-flip and Free Board completion. These
   corrections require a future Android app build/release to reach installed apps;
   existing clients' event schema remains compatible throughout.

Rollback: restore the previous Worker and website asset revision; leave the
additive platform migration in place so already collected web rows survive.
Existing Android and WeChat rows remain compatible. Do not remove statistics or
reverse the table migration as part of routine rollback.

## Historical deployment notes (2026-07 / 2026-08)

- Status: first authorized deployment completed; Worker remains deployed.
- Endpoint: `https://telemetry.luotianyi.fun`
- Health check: `GET /health` returns HTTP 200 and the exact JSON `{"ok":true}`.
- Analytics Engine dataset: `quareia_telemetry`
- Analytics Engine binding: `TELEMETRY`
- Historical Analytics API account configuration: ordinary `ACCOUNT_ID` in
  `wrangler.toml`; `ANALYTICS_READ_TOKEN` is a Worker Secret only.
- First deployment date: 2026-07-31
- Data retention: three months; the dataset is suitable for rolling trend
  statistics, not a permanent archive.

> **The current review revision has not been deployed in this task.**
> Evidence refreshed on 2026-08-06 is deliberately narrower: the live
> `/admin` page returns HTTP 200 with the required security headers and a
> parseable inline script, and `wrangler secret list` reports the name
> `ADMIN_TOKEN`. It does not report `ANALYTICS_READ_TOKEN`. No secret value was
> read. The remote D1 migration state and authenticated announcements/stats
> behavior were not re-verified in this phase, so they remain unknown rather
> than being described as absent. The Analytics history code in this review
> revision remains local and undeployed.

The endpoint accepts one event JSON object at a time. It does not accept event
arrays. The fixed Analytics Engine projection remains documented in the main
README and in the Worker source.

## Privacy boundary

The Worker temporarily reads the connection IP for in-memory rate limiting and
abuse prevention. It does not persist the raw IP or an IP digest. Analytics
Engine stores only the Cloudflare-inferred country and first-level subdivision
fields, plus the approved aggregate event fields. It does not store city,
postal code, latitude, longitude, metro code, card faces, card names,
orientations, spreads, questions, notes, or local history. Cloudflare-derived
location can be missing or inaccurate because of VPNs, proxies, and mobile
carrier exits; it is not a user's verified residence.

## Recorded validation

The deployment window used the committed Worker test suite and a clean
dependency install:

```text
npm ci --no-audit --no-fund   passed
npm test                      28/28 passed
node --check src/index.js     passed
npx wrangler deploy --dry-run --outdir dist   passed
```

Production contract checks used the clearly marked app version
`e2e-test-20260731`. The five valid test requests returned HTTP 204. Invalid
arrays, forbidden fields, schema version 2, and an over-1-KiB request returned
the expected 400/413 responses. The test rows are not individually deleted;
they are marked by that app version and will expire with the three-month
Analytics Engine retention period.

The Android UI revision was also verified locally with the full JS contract
suite (5/5), Robolectric tests (7/7), and a successful debug APK build. The
APK is a local build artifact and is not published by this repository.

## Historical Analytics API local contract

The historical endpoint is part of the un-deployed local revision only. It
accepts exactly `window=24h`, `7d`, or `30d`, authenticates with the existing
admin token first, and then sends only fixed SQL templates to
`https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/analytics_engine/sql`
using `POST` and `Authorization: Bearer <ANALYTICS_READ_TOKEN>`. The dataset
is fixed to `quareia_telemetry`; callers cannot provide SQL, field names, or a
table name.

Event totals and distributions use `SUM(_sample_interval)`. Active installs
are an explicitly estimated sampled `DISTINCT` count over both
`daily_active` and `app_active`. App-version, locale, country, and subdivision
distributions are `install_seen` first-report snapshots, not current state.
The daily trend uses UTC-day
buckets inside the rolling window, so its boundary days may be partial. The
response never contains the sampling key or raw install identifier.

The Worker uses an 8-second upstream timeout, at most three concurrent SQL
requests, bounded response bodies and result rows, and `no-store` responses.
Upstream, parsing, and partial failures return `analytics_unavailable` with
affected sections set to `null`; no partial failure is cached, and the D1
stats/announcements routes remain independent. This local contract was not
deployed in this task, and the required `ANALYTICS_READ_TOKEN` name was absent
from the production Worker secret list checked on 2026-08-06.

## Rollback and stop procedure

Only an authorized Cloudflare operator should perform these actions:

1. If a new Worker version is unhealthy, use the Worker version history to
   restore the last known-good version, then rerun `/health` and the single
   event contract check.
2. To stop public ingestion, first remove the Worker Custom Domain
   `telemetry.luotianyi.fun` from this Worker through the Cloudflare Workers
   UI. Do not alter the root domain or unrelated DNS records.
3. Disable Android reporting through the app release/configuration process if
   ingestion is intentionally being retired. Do not delete the Analytics
   Engine dataset as part of routine rollback; its existing rows expire under
   the documented retention policy.

No API token, account identifier, OAuth credential, installation UUID, or full
test install hash is stored in this repository.
