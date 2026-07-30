# Backend documentation

- [../README.md](../README.md) — setup, config, migration, deployment notes
- [api-reference.md](api-reference.md) — full endpoint reference with examples
- [android-token-guide.md](android-token-guide.md) — how the Android client
  stores and carries the long-lived device token

## Design summaries

### Email login & long-lived device sessions

- Email is the only account identifier; login and registration are the same
  flow (auto-register on first verify).
- Codes: 6 digits, single-use, 10-minute TTL, ≤5 wrong attempts, ≥60 s resend
  throttle, per-email + per-IP rate limits. A newly delivered code
  **invalidates all earlier challenges** for that email; only the latest,
  unconsumed, unexpired challenge is verifiable. Only the code's **HMAC-SHA256
  digest** (keyed by `SECRET_KEY`) is stored — never the plaintext, and it is
  never printed/logged.
- The send-code response is identical for new vs existing emails (no
  enumeration).
- If the mail provider fails, send-code returns a unified **503** (generic
  message, no provider body) and **no usable challenge is persisted**.
- On verify: register/find the device by the client `installation_id`, mint a
  32-byte opaque token, store its **HMAC digest**, return the raw token
  **exactly once** (never re-issued/listed/logged).
- `installation_id` is scoped per user; the same id may be reused across
  accounts, each with its own device/token/notes.
- No short-lived access/refresh tokens, no rotation. Re-verifying on the same
  installation issues a new token and leaves previous tokens valid (sessions
  additive) until explicitly revoked. Tokens survive restarts and offline
  periods; they die only on logout, device revoke, data clear, or account ban
  (banning a user invalidates all tokens immediately). Revocations are
  transactional (`revoked_at` + digest cleared together).
- devtest mail provider is refused in production (fail-fast).

### Cloud notes sync & conflict strategy

- Client-generated UUID (`id`) enables offline-first creation and idempotent
  sync; re-posting the same id is a no-op.
- Soft delete via `deleted_at`; tombstones ship through `deleted=include`.
- Delta sync via `updated_after`; keyset pagination on `(updated_at, id)`.
- Optimistic concurrency via `version`; `PATCH` with stale `expected_version`
  returns `409` carrying the current version.
- Revoking a device never deletes cloud notes (data outlives sessions).
- Access is gated by a replaceable per-user entitlement service (default
  allow-all in tests/dev, deny-all otherwise); denied access returns **403**.

### Scaling caveat

- The rate limiter and the devtest mail capture are **process-local
  (single-instance only)**. Multi-instance production MUST replace the limiter
  with Redis/shared storage and use a real mail provider.
