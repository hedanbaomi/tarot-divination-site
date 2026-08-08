# Quareia Companion Backend

A standalone FastAPI backend providing **email login with long-lived device
tokens** and an **optional cloud-notes** API for the future Quareia Companion
Android app.

> This backend is **independent** of the static tarot site and GitHub Pages.
> The core offline divination experience (decks, spreads, history) does **not**
> depend on this API. Cloud notes are an optional, future-paid feature; this
> round implements everything **except** payments.

## Licence and status

This is an optional/legacy local-development backend and is not required by the
current static website, Android application, or telemetry Worker. Its
project-authored software is licensed under `AGPL-3.0-only`; third-party
dependencies and separately copyrighted content retain their own terms. See
[`LICENSE.md`](LICENSE.md) and the repository-level
[`LICENSE.md`](../LICENSE.md).

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
├── tests/                   # pytest suite (95 tests; 82 always run on SQLite + 13 PostgreSQL-gated)
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

With `MAIL_PROVIDER=devtest`, verification codes are **only captured in memory**
(no real email is sent, and the code is **never** written to stdout, stderr, or
logs). To read the code during local development, use the in-memory capture from
a Python shell or test:

```python
from app.mail import get_captured_mails
print(get_captured_mails()[-1].to)   # recipient
# The body contains the code; inspect it only in a trusted dev shell.
```

## Running tests

```bash
cd backend
set DATABASE_URL=sqlite:///:memory:
set MAIL_PROVIDER=devtest
pytest -v
```

The suite is **95 tests**: 82 run unconditionally on SQLite, and 13 more run
only when `DATABASE_URL_PG` points at a live PostgreSQL instance (they verify
cross-DB timezone correctness and 8-way concurrency on real PostgreSQL). They
cover the full auth + notes flow, security invariants, session persistence
across simulated restarts, code supersession/concurrency, the device-session
contract, installation account-switching, cross-user isolation, and
PostgreSQL-specific behaviour. To run the PostgreSQL tests:

```bash
set DATABASE_URL_PG=postgresql+psycopg://test:testpw@127.0.0.1:55432/quareia_test
pytest tests/test_postgres_integration.py -v
```

## Configuration

See [`.env.example`](.env.example) for every variable. Highlights:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./dev.db` | DB URL. Use a PG DSN in prod. |
| `ENVIRONMENT` | `dev` | `production` triggers startup fail-fast checks. |
| `SECRET_KEY` | dev default | HMAC secret for code/token digests. **Set strong in prod.** |
| `CREATE_TABLES_ON_STARTUP` | `true` | Dev helper; use Alembic in prod. |
| `MAIL_PROVIDER` | `devtest` | `devtest` / `resend` / `smtp` (devtest refused in prod) |
| `EMAIL_CODE_TTL_SECONDS` | `600` | Code lifetime (10 min). |
| `EMAIL_RESEND_MIN_INTERVAL_SECONDS` | `60` | Min gap between sends/email. |
| `NOTES_ENABLED_FOR_ALL` | `true` | Test/dev global entitlement toggle. Prod should inject a real per-user service. |

## Mail provider configuration

### devtest (default, local only)
Captures mail **in memory only** and never sends anything. It does **not** write
the code (or any message body) to stdout, stderr, or logs — tests read the
captured message via `get_captured_mails()`. Refused when `ENVIRONMENT=production`.

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

> **Failure handling:** if the provider fails to deliver, send-code returns a
> unified **503** (generic message, no provider response body) and **no usable
> challenge is persisted** — a delivery outage never leaves a valid code state
> and never leaks whether the email is registered.

## API surface (12 endpoints under `/api/v1`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/auth/email/send-code` | Request a 6-digit code |
| POST | `/api/v1/auth/email/verify-code` | Verify code, get a device token |
| POST | `/api/v1/auth/logout` | Revoke the current token |
| POST | `/api/v1/auth/logout-all` | Revoke every session |
| GET | `/api/v1/me` | Current user profile |
| GET | `/api/v1/me/devices` | List devices |
| DELETE | `/api/v1/me/devices/{device_id}` | Revoke a device |
| POST | `/api/v1/notes` | Create note (idempotent) |
| GET | `/api/v1/notes` | List / delta-sync / paginate |
| GET | `/api/v1/notes/{note_id}` | Fetch one note |
| PATCH | `/api/v1/notes/{note_id}` | Update (optimistic concurrency) |
| DELETE | `/api/v1/notes/{note_id}` | Soft-delete (tombstone) |

(Plus `/health` and auto-generated `/docs`, `/redoc`, `/openapi.json`.)

## Database migrations

```bash
alembic upgrade head      # apply all migrations
alembic downgrade base    # roll all back
alembic check             # verify migrations match the models
alembic revision --autogenerate -m "describe change"   # new migration
```

`alembic/env.py` reads `DATABASE_URL` from the environment and uses
`render_as_batch=True` on SQLite (so `ALTER TABLE` works portably). On
PostgreSQL the same migration runs unchanged.

## Deployment notes (not done in this round)

- Set `ENVIRONMENT=production` — the app **fails fast at startup** unless
  `SECRET_KEY` is strong, `MAIL_PROVIDER` is not `devtest`, and `DATABASE_URL`
  is PostgreSQL (see `Settings.validate_for_production`).
- Set `CREATE_TABLES_ON_STARTUP=false` and run `alembic upgrade head` on deploy.
- Point `DATABASE_URL` at PostgreSQL.
- Configure `CORS_ALLOW_ORIGINS` to your app/web origins.
- Provide a stable, high-entropy `SECRET_KEY` (rotate via env only; rotation
  invalidates all outstanding codes and device tokens).
- Put the service behind TLS and a reverse proxy that forwards `X-Forwarded-For`
  so per-IP rate limiting uses the real client address.
- **Single-instance only by default:** the rate limiter and the devtest mail
  capture are process-local. For multi-instance production you MUST replace the
  in-memory limiter with Redis (or another shared store) and use a real mail
  provider.
- **Do not** commit `.env`, real API keys, or SMTP passwords.

## Security model summary

- **Email is the only account identifier.** Login == registration.
- **6-digit codes:** single-use, 10-minute expiry, ≤5 wrong attempts,
  ≥60 s resend throttle, per-email and per-IP rate limits. A newly delivered
  code **invalidates all earlier challenges**; only the latest is verifiable.
  Only the code **HMAC digest** (keyed by `SECRET_KEY`) is stored.
- **Long-lived opaque device tokens** (32 random bytes, URL-safe). The server
  stores only the **HMAC digest**; the raw token is returned **once** at
  verification and never re-issued, listed, or logged. No short-lived
  access/refresh tokens, no rotation. Re-verifying on the same installation
  issues a **new** token and leaves previous tokens valid (sessions are
  additive) until explicitly revoked. Tokens survive restarts and offline
  periods; they die only on logout, device revoke, data clear, or account ban
  (banning a user invalidates **all** their tokens immediately). Revocations
  are transactional (`revoked_at` set AND `token_digest` cleared together).
- **No hardware identifiers** (IMEI/MAC/Android ID) are used. Devices are keyed
  by a client-generated `installation_id`, scoped per **user**: the same
  installation id may be reused across different accounts, each getting its own
  device/token/notes; revoking under one account never affects another.
- **Logs** never contain tokens, codes, or mail secrets (a redacting filter
  strips token-like substrings; SQL parameter logging is off; the devtest mail
  provider never prints the code — it only captures in memory for tests).
- **Notes** are strictly scoped to the owning user; cross-user access returns
  404 (no existence leak). Notes access is gated by a **replaceable per-user
  entitlement service** (default: allow-all in tests/dev, deny-all otherwise);
  payments are out of scope this round.
- **devtest mail provider** is refused in production (fail-fast at startup and
  in the factory); it only captures messages in memory and cannot deliver.

See [docs/android-token-guide.md](docs/android-token-guide.md) for the client
side, and [docs/api-reference.md](docs/api-reference.md) for endpoint details.
