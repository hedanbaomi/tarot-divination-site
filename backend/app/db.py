"""Database engine, session and declarative base.

Works with SQLite (dev/tests, files via ``DATABASE_URL=sqlite:///./dev.db`` or
the special ``sqlite://`` in-memory DB) and is structured to switch to
PostgreSQL by changing ``DATABASE_URL`` only. We configure SQLite for sane
defaults (foreign keys on, check same thread off) and a SQLAlchemy 2 ``Engine``.
"""

from __future__ import annotations

from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import Settings


class Base(DeclarativeBase):
    """Declarative base shared by all models."""


def _make_engine(settings: Settings) -> Engine:
    connect_args: dict = {}
    kwargs: dict = {"echo": False, "future": True}
    if settings.is_sqlite:
        # SQLite needs this to be usable from FastAPI's threadpool / background
        # tasks and to avoid "closed database" errors in tests.
        connect_args["check_same_thread"] = False
        # An in-memory SQLite DB is per-connection by default. To share a single
        # DB across the connection pool (so lifespan-created tables are visible
        # to request threads) we must use StaticPool with a single connection.
        if ":memory:" in settings.database_url:
            kwargs["poolclass"] = StaticPool
            connect_args["check_same_thread"] = False
    engine = create_engine(
        settings.database_url,
        connect_args=connect_args,
        **kwargs,
    )

    if settings.is_sqlite:
        @event.listens_for(engine, "connect")
        def _enable_sqlite_fk(dbapi_connection, _record):  # pragma: no cover - infra
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def make_session_factory(engine: Engine):
    """Return a ``sessionmaker`` bound to ``engine``."""
    return sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
        class_=Session,
        future=True,
    )


def build_engine(settings: Settings) -> tuple[Engine, "sessionmaker[Session]"]:
    """Convenience helper used by the FastAPI app and tests."""
    engine = _make_engine(settings)
    session_factory = make_session_factory(engine)
    return engine, session_factory
