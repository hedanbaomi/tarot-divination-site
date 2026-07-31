# Quareia Telemetry Worker

Anonymous, opt-out usage-statistics ingest for the **Quareia Divination Android
app**. Stores aggregate signals only — active-device counts, deck usage,
readings completed — in **Cloudflare Analytics Engine**. Never stores raw IP
addresses, request bodies, card faces, card names, orientations, spread layouts,
questions, notes, or local history.

> **Status: code only — not deployed.** This directory contains the worker code
> and deployment notes. Deploying it (and binding `telemetry.luotianyi.fun`) must
> be performed by someone with Cloudflare access. No deployment is performed
> automatically and nothing here touches the existing site, R2, or VPS.

## Endpoints

| Method | Path           | Behaviour                                                        |
|--------|----------------|------------------------------------------------------------------|
| POST   | `/v1/events`   | Accepts one event or a small array. Validates strictly, writes to Analytics Engine, returns **204**. Invalid/oversized → 400/413. Over rate limit → 429. |
| GET    | `/health`      | Returns `200 {"ok":true}`.                                       |

## Event schema (closed allow-list)

Every event carries these base fields:

| field            | type   | notes                                                |
|------------------|--------|------------------------------------------------------|
| `schema_version` | int    | `1` (server-controlled on write)                     |
| `event`          | string | `install_seen` / `daily_active` / `reading_completed`|
| `install_hash`   | string | 64-char lowercase hex SHA-256 of a random per-install UUID (raw UUID never sent) |
| `app_version`    | string | app version name                                     |
| `locale`         | string | BCP-47 language tag, e.g. `zh-CN`                    |
| `android_major`  | int    | Android release major version                        |

`reading_completed` additionally carries:

| field        | type   | notes                                              |
|--------------|--------|----------------------------------------------------|
| `deck_type`  | string | `tarot` / `mystagogus` / `lxxxi`                   |
| `card_count` | int    | number of cards in the finished spread (1–81)      |

**Any field not listed above is rejected with HTTP 400.** This includes — and
therefore blocks — card ids, card names, orientations, positions, questions,
notes, history, raw IP, and User-Agent.

## Privacy contract (enforced in code)

- Body is capped at **1 KB** (`413` if exceeded).
- The raw client IP is read **only** for in-memory rate limiting. It is never
  written to Analytics Engine, D1, logs, or any response.
- Only the connection **country** (`request.cf.country`, ISO code) is stored, at
  country granularity — never city, region, or coordinates.
- Timestamps use the **server** clock; client timestamps are ignored.
- Rate-limit/security entries retain only an **irreversible digest** of the IP,
  held in memory for at most **7 days**.

## Deploy (manual, requires Cloudflare access)

```bash
cd telemetry-worker
npm install
npx wrangler login                       # authenticate to Cloudflare
```

1. **Create the Analytics Engine dataset** in the Cloudflare dashboard
   (Analytics & Logs → Analytics Engine → Create dataset). Note the dataset name.
2. Edit `wrangler.toml`: uncomment the `[[analytics_engine_datasets]]` block and
   set `dataset` to the name from step 1.
3. Deploy:

   ```bash
   npx wrangler deploy
   ```
4. **Bind the custom domain** in the dashboard: Workers & Pages → this worker →
   Settings → Triggers → Custom Domains → add `telemetry.luotianyi.fun`.
   (Equivalently, add a Workers Route under the `luotianyi.fun` zone.)

> If you prefer environment-variable-driven limits, set them under
> `[vars]` in `wrangler.toml` and redeploy.

## Querying Analytics Engine

Analytics Engine is queried with SQL via the Cloudflare API / GraphQL or the
dashboard SQL API. Examples (column names follow the `blobs`/`indexes` written in
`src/index.js` — `blob1=event, blob2=install_hash, blob3=deck_type, blob4=country`;
`index1=event, index2=deck_type, index3=country, index4=app_version`;
`double1=card_count`):

**DAU — active devices per UTC day**
```sql
SELECT timestamp_ns / 1000000000 / 86400 AS day,
       COUNT(DISTINCT blob2) AS active_devices
FROM telemetry
WHERE blob1 = 'daily_active'
GROUP BY day
ORDER BY day DESC;
```

**MAU — distinct installs active in the last 30 days**
```sql
SELECT COUNT(DISTINCT blob2) AS mau
FROM telemetry
WHERE blob1 = 'daily_active'
  AND timestamp_ns >= (:cutoff_30d_ns);
```

**Install count**
```sql
SELECT COUNT(*) AS installs FROM telemetry WHERE blob1 = 'install_seen';
```

**Readings completed (total)**
```sql
SELECT COUNT(*) AS readings FROM telemetry WHERE blob1 = 'reading_completed';
```

**Deck usage — readings per deck**
```sql
SELECT blob3 AS deck_type, COUNT(*) AS readings
FROM telemetry
WHERE blob1 = 'reading_completed'
GROUP BY blob3
ORDER BY readings DESC;
```

**Average cards drawn per deck**
```sql
SELECT blob3 AS deck_type, AVG(double1) AS avg_card_count
FROM telemetry
WHERE blob1 = 'reading_completed'
GROUP BY blob3;
```

**Geographic spread (country-level only)**
```sql
SELECT blob4 AS country, COUNT(DISTINCT blob2) AS installs
FROM telemetry
WHERE blob1 = 'install_seen'
GROUP BY blob4
ORDER BY installs DESC;
```

None of these queries can reveal card faces, names, orientations, spread layouts,
questions, notes, history, or raw IP — none of that data is ever stored.
