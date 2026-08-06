# Quareia Telemetry Worker deployment record

## Current status

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
