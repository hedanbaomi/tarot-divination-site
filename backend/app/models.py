"""SQLAlchemy 2 ORM models.

Tables
------
users
    One row per email. ``status`` supports banning (``banned``). Email is stored
    normalised and unique.
email_challenges
    Outstanding verification challenges. Only the code *digest* and attempt
    counters are stored. Single-use, with expiry. We also track the last send
    time and per-(email/ip) send counters for rate limiting.
devices
    A physical/installation identity. We never store hardware IDs; an
    ``installation_id`` is a client-generated opaque UUID the app invents.
device_sessions
    The long-lived session for a device: a *digest* of the opaque device token.
    Revoking a device or logging out sets ``revoked_at``; the token digest is
    also wiped so it cannot be reused. Survives server restarts (it is just a
    DB row). Deleting a device session never touches notes.
notes
    Cloud notes owned by a user. Client-supplied UUID makes offline-first sync
    possible. Soft-deleted via ``deleted_at``; optimistic concurrency via
    ``version``.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import CHAR, TypeDecorator

from .db import Base
from .utc_now import utcnow


class GUID(TypeDecorator):
    """Platform-independent UUID type.

    Uses PostgreSQL's native UUID when available, otherwise stores as CHAR(36).
    This keeps the same model usable on SQLite (dev) and Postgres (prod) without
    code changes.
    """

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import UUID as PG_UUID

            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            if isinstance(value, uuid.UUID):
                return value
            return uuid.UUID(str(value))
        if isinstance(value, uuid.UUID):
            return str(value)
        return str(uuid.UUID(str(value)))

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))


def _guid() -> uuid.UUID:
    return uuid.uuid4()


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=_guid)
    # Normalised, lower-cased, unique email.
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    # One of: active, banned.
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    devices: Mapped[List["Device"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    notes: Mapped[List["Note"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def is_banned(self) -> bool:
        return self.status == "banned"


class EmailChallenge(Base):
    __tablename__ = "email_challenges"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=_guid)
    email: Mapped[str] = mapped_column(String(254), nullable=False, index=True)
    # SHA-256 digest of the 6-digit code. Never the plain code.
    code_digest: Mapped[str] = mapped_column(String(128), nullable=False)
    # 6-digit plain code is deliberately NOT stored.

    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Single-use flag.
    consumed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # Audit-ish fields; never log secrets, but these help rate-limit logic.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    # Was the code successfully delivered? When the provider fails, this stays
    # False so the challenge never becomes usable.
    delivered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("ix_email_challenges_email_created", "email", "created_at"),
    )


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=_guid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Client-generated stable opaque UUID per install. Not a hardware ID.
    installation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    # Coarse client-supplied platform string (e.g. "android"). Optional.
    platform: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    user: Mapped["User"] = relationship(back_populates="devices")
    sessions: Mapped[List["DeviceSession"]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # One logical device row per (user, installation_id).
        UniqueConstraint("user_id", "installation_id", name="uq_devices_user_install"),
    )


class DeviceSession(Base):
    """Long-lived bearer session.

    The raw token lives only in the client. We store ``token_digest`` and match
    incoming tokens by hashing them (constant-time compare in the auth layer).
    Revocation sets ``revoked_at`` and clears the digest, so the token can never
    authenticate again even if the row remains (for audit history).
    """

    __tablename__ = "device_sessions"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=_guid)
    device_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_digest: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    device: Mapped["Device"] = relationship(back_populates="sessions")

    @property
    def is_revoked(self) -> bool:
        return self.revoked_at is not None or self.token_digest is None


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Tags stored as a JSON array string to stay portable across SQLite/PG.
    tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    reading_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    reading_snapshot_ref: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)

    user: Mapped["User"] = relationship(back_populates="notes")

    __table_args__ = (
        # Client-supplied UUID must be globally unique across users (offline sync).
        UniqueConstraint("id", name="uq_notes_id"),
        Index("ix_notes_user_updated", "user_id", "updated_at"),
    )
