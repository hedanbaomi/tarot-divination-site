# Quareia Companion Backend

A standalone FastAPI backend providing **email login with long-lived device
tokens** and an **optional cloud-notes** API for the future Quareia Companion
Android app.

> This backend is **independent** of the static tarot site and GitHub Pages.
> The core offline divination experience (decks, spreads, history) does **not**
> depend on this API. Cloud notes are an optional, future-paid feature; this
> round implements everything **except** payments.

## Tech stack

- **FastAPI** (ASGI) + **SQLAlchemy 2** ORM + **Alembic** migrations
- **Pydantic v2** for request/response validation
- **SQLite** for local dev/tests, **PostgreSQL-ready** (change `DATABASE_URL`)
- Pluggable **mail providers**: devtest (local), Resend, SMTP

## Layout

```
backend/
├── app/
│   ├── main.py              # FastAPI app factory + ASGI entry
│   ├── config.py            # env-driven Settings
│   ├── db.py                # engine, session, Base (SQLite/PG portable)
│   ├── models.py            # users, email_challenges, devices, device_sessions, notes
│   ├── schemas.py           # Pydantic request/response models
│   ├── security.py          # code/token generation + digests (no plaintext stored)
│   ├── normalize.py         # email normalization + client IP
│   ├── ratelimit.py         # in-memory sliding-window limiter
│   ├── logging_setup.py     # redacts token-like strings from logs
│   ├── deps.py              # FastAPI deps: db, settings, require_device auth
│   ├── mail/                # provider abstraction (devtest/resend/smtp)
│   ├── services/            # auth + notes business logic
│   └── routers/             # auth, me, notes endpoints
├── alembic/                 # migrations (env.py + versions/)
├── tests/                   # pytest suite (40 tests)
├── alembic.ini
├── requirements.txt
├── requirements-dev.txt
├── pytest.ini
└── .env.example
```

## Quick start (local)

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate          # Windows
# python -m venv .venv && source .venv/bin/activate     # macOS/Linux
pip install -r requirements-dev.txt

# Dev defaults are fine; .env is optional.
set DATABASE_URL=sqlite:///./dev.db                     # Windows
set MAIL_PROVIDER=devtest
# export DATABASE_URL=sqlite:///./dev.db                # macOS/Linux
# export MAIL_PROVIDER=devtest

# Run migrations (optional in dev; create_tables_on_startup also works):
alembic upgrade head

# Start the API:
uvicorn app.main:app --reload
# OpenAPI docs: http://localhost:8000/docs
```

With `MAIL_PROVIDER=devtest`, verification codes are printed to the console and
captured in memory (no real email is sent). Look for a line like:

```
[devtest-mail] to=alice@example.com subject=Your Quareia Companion sign-in code
```

## Running tests

```bash
cd backend
set DATABASE_URL=sqlite:///:memory:
set MAIL_PROVIDER=devtest
pytest -v
```

All 40 tests pass and cover the full auth + notes flow, security invariants,
session persistence across simulated restarts, and cross-user isolation.

## Configuration

See [`.env.example`](.env.example) for every variable. Highlights:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./dev.db` | DB URL. Use a PG DSN in prod. |
| `CREATE_TABLES_ON_STARTUP` | `true` | Dev helper; use Alembic in prod. |
| `MAIL_PROVIDER` | `devtest` | `devtest` / `resend` / `smtp` |
| `EMAIL_CODE_TTL_SECONDS` | `600` | Code lifetime (10 min). |
| `EMAIL_RESEND_MIN_INTERVAL_SECONDS` | `60` | Min gap between sends/email. |
| `NOTES_ENABLED_FOR_ALL` | `true` | Grant notes access in dev/tests. |
| `TOKEN_HASH_PEPPER` | (empty) | Optional digest pepper. |

## Mail provider configuration

### devtest (default, local only)
Captures mail in memory and prints a line to stdout. Never sends anything.

### Resend
```env
MAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxx
MAIL_FROM_ADDRESS=no-reply@your-domain.example
```
Sends via `POST https://api.resend.com/emails`.

### SMTP
```env
MAIL_PROVIDER=smtp
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_USE_TLS=true
```

> **Failure handling:** if the provider raises, no usable challenge is persisted
> — the user simply receives the same generic "code is on its way" response, so
> a delivery outage never leaves a valid code state and never leaks that fact.

## Database migrations

```bash
alembic upgrade head      # apply all migrations
alembic downgrade base    # roll all back
alembic revision --autogenerate -m "describe change"   # new migration
```

`alembic/env.py` reads `DATABASE_URL` from the environment and uses
`render_as_batch=True` on SQLite (so `ALTER TABLE` works portably). On
PostgreSQL the same migration runs unchanged.

## Deployment notes (not done in this round)

- Set `CREATE_TABLES_ON_STARTUP=false` and run `alembic upgrade head` on deploy.
- Point `DATABASE_URL` at PostgreSQL.
- Configure `CORS_ALLOW_ORIGINS` to your app/web origins.
- Provide a stable `TOKEN_HASH_PEPPER` (rotate via env only).
- Put the service behind TLS and a reverse proxy that forwards `X-Forwarded-For`
  so per-IP rate limiting uses the real client address.
- For multi-instance deployments, replace the in-memory rate limiter with Redis.
- **Do not** commit `.env`, real API keys, or SMTP passwords.

## Security model summary

- **Email is the only account identifier.** Login == registration.
- **6-digit codes:** single-use, 10-minute expiry, ≤5 wrong attempts,
  ≥60 s resend throttle, per-email and per-IP rate limits. Only the code
  **digest** is stored.
- **Long-lived opaque device tokens** (32 random bytes, URL-safe). The server
  stores only the digest; the raw token is returned **once** at verification.
  No short-lived access/refresh tokens, no rotation. Tokens survive restarts
  and offline periods; they die only on logout, device revoke, data clear, or
  account ban.
- **No hardware identifiers** (IMEI/MAC/Android ID) are used. Devices are keyed
  by a client-generated `installation_id`.
- **Logs** never contain tokens, codes, or secrets (a redacting filter strips
  token-like substrings; SQL parameter logging is off).
- **Notes** are strictly scoped to the owning user; cross-user access returns
  404 (no existence leak).

See [docs/android-token-guide.md](docs/android-token-guide.md) for the client
side, and [docs/api-reference.md](docs/api-reference.md) for endpoint details.
