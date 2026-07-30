"""Application configuration.

All runtime configuration is read from environment variables (with sensible
development defaults). No real secrets are hard-coded here or anywhere else in
this codebase — see ``.env.example`` for every supported variable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List, Tuple


def _bool(raw: str | None, default: bool = False) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(raw: str | None, default: int) -> int:
    try:
        return int(raw) if raw not in (None, "") else default
    except (TypeError, ValueError):
        return default


def _csv(raw: str | None) -> List[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # --- Database -----------------------------------------------------------
    # SQLite by default for local dev; switch to a postgres DSN in production.
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "DATABASE_URL", "sqlite:///./dev.db"
        )
    )
    # When True, tables are created on startup if missing. Intended for dev /
    # tests only; production should rely on Alembic migrations.
    create_tables_on_startup: bool = field(
        default_factory=lambda: _bool(os.getenv("CREATE_TABLES_ON_STARTUP"), True)
    )

    # --- App ----------------------------------------------------------------
    app_name: str = "Quareia Companion API"
    environment: str = field(default_factory=lambda: os.getenv("ENVIRONMENT", "dev"))
    # Absolute base URL used to build links (e.g. the mail template). No trailing
    # slash.
    public_base_url: str = field(
        default_factory=lambda: os.getenv(
            "PUBLIC_BASE_URL", "http://localhost:8000"
        )
    )
    cors_allow_origins: Tuple[str, ...] = field(
        default_factory=lambda: tuple(_csv(os.getenv("CORS_ALLOW_ORIGINS")))
    )

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"prod", "production"}

    # --- Auth ---------------------------------------------------------------
    # Bcrypt-style cost is handled by ``passlib``; this only tunes the server.
    # 6-digit code, valid 10 minutes, max 5 wrong attempts.
    email_code_ttl_seconds: int = field(
        default_factory=lambda: _int(os.getenv("EMAIL_CODE_TTL_SECONDS"), 600)
    )
    email_code_length: int = 6
    email_code_max_attempts: int = field(
        default_factory=lambda: _int(os.getenv("EMAIL_CODE_MAX_ATTEMPTS"), 5)
    )
    # Min seconds between two send-code calls for the same email.
    email_resend_min_interval_seconds: int = field(
        default_factory=lambda: _int(os.getenv("EMAIL_RESEND_MIN_INTERVAL_SECONDS"), 60)
    )
    # Rate limit on (email) and (ip): ``count`` sends per ``window_seconds``.
    rate_limit_email_per_window: int = 5
    rate_limit_email_window_seconds: int = 600
    rate_limit_ip_per_window: int = 20
    rate_limit_ip_window_seconds: int = 3600

    # Long-lived opaque device token length (URL-safe, ~ this many bytes).
    device_token_bytes: int = 32

    # --- Mail provider ------------------------------------------------------
    # One of: "devtest" (prints/captures), "resend", "smtp".
    mail_provider: str = field(
        default_factory=lambda: os.getenv("MAIL_PROVIDER", "devtest").lower()
    )
    mail_from_address: str = field(
        default_factory=lambda: os.getenv(
            "MAIL_FROM_ADDRESS", "no-reply@quareia-companion.local"
        )
    )
    mail_from_name: str = field(
        default_factory=lambda: os.getenv("MAIL_FROM_NAME", "Quareia Companion")
    )
    # Resend
    resend_api_key: str = field(default_factory=lambda: os.getenv("RESEND_API_KEY", ""))
    resend_api_url: str = field(
        default_factory=lambda: os.getenv("RESEND_API_URL", "https://api.resend.com/emails")
    )
    # SMTP
    smtp_host: str = field(default_factory=lambda: os.getenv("SMTP_HOST", ""))
    smtp_port: int = field(default_factory=lambda: _int(os.getenv("SMTP_PORT"), 587))
    smtp_username: str = field(default_factory=lambda: os.getenv("SMTP_USERNAME", ""))
    smtp_password: str = field(default_factory=lambda: os.getenv("SMTP_PASSWORD", ""))
    smtp_use_tls: bool = field(default_factory=lambda: _bool(os.getenv("SMTP_USE_TLS"), True))
    smtp_use_ssl: bool = field(default_factory=lambda: _bool(os.getenv("SMTP_USE_SSL"), False))

    # --- Entitlements -------------------------------------------------------
    # Notes is an optional, future-paid feature. In tests/dev we grant access to
    # everyone; production can flip this off and later plug a real entitlement
    # check. Business code must never hard-code "paid => allowed".
    notes_enabled_for_all: bool = field(
        default_factory=lambda: _bool(os.getenv("NOTES_ENABLED_FOR_ALL"), True)
    )

    # --- Notes limits -------------------------------------------------------
    note_title_max_length: int = 200
    note_content_max_length: int = 100_000
    note_tags_max_count: int = 32
    note_tag_max_length: int = 64
    notes_default_page_size: int = 50
    notes_max_page_size: int = 200
    notes_list_default_deleted_filter: str = "exclude"  # exclude|include|only

    # --- Security / misc ----------------------------------------------------
    # Server-wide secret used to HMAC-sign verification-code and device-token
    # digests. MUST be set to a stable, high-entropy value in production (any
    # change invalidates all outstanding codes and tokens). In dev a fixed
    # non-secret default keeps the test suite deterministic; production
    # rejects the dev default via ``validate_for_production()``.
    secret_key: str = field(
        default_factory=lambda: os.getenv(
            "SECRET_KEY", "dev-insecure-secret-key-do-not-use-in-prod"
        )
    )
    # Back-compat alias kept for one release; new code uses ``secret_key``.
    token_hash_pepper: str = field(
        default_factory=lambda: os.getenv("TOKEN_HASH_PEPPER", "")
    )

    def effective_hmac_secret(self) -> str:
        """Secret actually used to sign digests.

        Prefers ``SECRET_KEY``; falls back to the legacy ``TOKEN_HASH_PEPPER``
        for backward compatibility. Never empty.
        """
        return self.secret_key or self.token_hash_pepper

    def validate_for_production(self) -> None:
        """Fail fast if a production environment is missing required config.

        Called at app startup when ``ENVIRONMENT`` is prod/production. Raises
        ``RuntimeError`` with a clear message so a misconfigured instance never
        silently serves weak digests or unsafe dev defaults.
        """
        problems: List[str] = []
        if not self.secret_key or self.secret_key.startswith("dev-insecure"):
            problems.append("SECRET_KEY must be set to a strong, stable value")
        if self.mail_provider == "devtest":
            problems.append(
                "MAIL_PROVIDER=devtest is not allowed in production "
                "(it captures messages in memory and cannot deliver mail)"
            )
        if self.is_sqlite:
            problems.append("DATABASE_URL must point to PostgreSQL in production")
        if problems:
            raise RuntimeError(
                "Refusing to start in production with insecure config: "
                + "; ".join(problems)
            )

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


def get_settings() -> Settings:
    """Return a fresh ``Settings`` built from the current environment.

    We deliberately do not cache, so tests that monkeypatch ``os.environ`` and
    re-create the app see their values immediately.
    """
    return Settings()
