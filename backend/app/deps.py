"""FastAPI dependencies.

* ``get_db`` — yields a SQLAlchemy session per request.
* ``get_settings`` — fresh settings from env.
* ``get_mail_provider`` — the configured mail provider.
* ``require_device`` — authenticates a request via the long-lived bearer token
  and returns the active ``DeviceSession`` + ``User``.

Auth flow: the raw opaque token comes in the ``Authorization: Bearer <token>``
header. We hash it and look up the matching ``DeviceSession.token_digest``. If
found and not revoked, the request is authenticated. There are no short-lived
access tokens and no refresh tokens; the same device token works until the user
(or an admin) revokes it, regardless of restarts or connectivity.
"""

from __future__ import annotations

from typing import Iterator, Optional

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from .config import Settings
from .db import Session as DBSession
from .mail import MailProvider, build_mail_provider
from .models import DeviceSession, User
from .security import hash_token


# A thread-local-ish app state holder set up in ``create_app``.
class AppState:
    def __init__(self) -> None:
        self.engine = None
        self.session_factory = None
        self.settings: Optional[Settings] = None
        self.mail_provider: Optional[MailProvider] = None
        # Replaceable entitlement service for the (future-paid) notes feature.
        # Defaults to the config-driven allow-all/deny-all; tests or a real
        # payments integration can swap this via ``set_entitlement_service``.
        self.entitlement_service = None


_state = AppState()


def configure_state(engine, session_factory, settings: Settings, mail_provider: MailProvider) -> None:
    _state.engine = engine
    _state.session_factory = session_factory
    _state.settings = settings
    _state.mail_provider = mail_provider
    # Build the default entitlement service from settings on (re)configure.
    from .services.notes import build_default_entitlement_service

    _state.entitlement_service = build_default_entitlement_service(settings)


def set_entitlement_service(service) -> None:
    """Inject a custom per-user entitlement service (tests / future payments)."""
    _state.entitlement_service = service


def get_entitlement_service():
    if _state.entitlement_service is None:
        from .services.notes import build_default_entitlement_service

        _state.entitlement_service = build_default_entitlement_service(get_settings())
    return _state.entitlement_service


def get_app_state() -> AppState:
    return _state


def get_settings() -> Settings:
    if _state.settings is None:
        _state.settings = Settings()
    return _state.settings


def get_mail_provider() -> MailProvider:
    if _state.mail_provider is None:
        _state.mail_provider = build_mail_provider(get_settings())
    return _state.mail_provider


def get_db() -> Iterator[Session]:
    """Yield a DB session and always close it."""
    factory = _state.session_factory
    if factory is None:
        # Should only happen if used outside create_app; build lazily for safety.
        from .db import build_engine

        engine, factory = build_engine(get_settings())
        _state.engine = engine
        _state.session_factory = factory
    db = factory()
    try:
        yield db
    finally:
        db.close()


def _extract_bearer(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return parts[1].strip()


def require_device(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    authorization: Optional[str] = Header(default=None),
) -> DeviceSession:
    """Authenticate a request and return the active ``DeviceSession``."""
    token = _extract_bearer(authorization)
    digest = hash_token(token, settings)
    session = (
        db.query(DeviceSession)
        .filter(DeviceSession.token_digest == digest)
        .one_or_none()
    )
    # Constant-time path: avoid timing differences for missing vs present-but-
    # revoked sessions by always comparing against a fresh digest.
    from .security import verify_token_digest

    ok = session is not None and verify_token_digest(token, session.token_digest or "", settings)
    if not ok or session is None or session.is_revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or revoked device token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(User.id == session.user_id).one_or_none()
    if user is None or user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="account unavailable",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Touch last_used_at so device management can show recent activity.
    from .utc_now import utcnow

    session.last_used_at = utcnow()
    db.commit()
    return session


def require_user(
    session: DeviceSession = Depends(require_device),
    db: Session = Depends(get_db),
) -> tuple[User, DeviceSession]:
    user = db.get(User, session.user_id)
    return user, session
