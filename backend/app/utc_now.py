"""Timezone helpers. All timestamps in the DB and API are UTC."""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Return a timezone-aware UTC ``datetime``."""
    return datetime.now(timezone.utc)


def as_utc(dt: datetime | None) -> datetime | None:
    """Coerce a datetime to timezone-aware UTC.

    SQLite does not preserve timezone info on ``DATETIME`` columns, so values
    read back from the DB are naive even though we wrote them as UTC. This helper
    assumes naive DB values are UTC (which is our convention everywhere) and
    stamps them, making comparisons safe across SQLite and PostgreSQL.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
