"""Cloud-notes service.

Implements the sync-friendly note API:

* create is idempotent on the client-supplied ``id`` — re-posting the same UUID
  returns the existing note (and never duplicates);
* list supports pagination (keyset on ``updated_at`` + ``id``) and an
  ``updated_after`` delta filter plus a ``deleted`` tombstone filter;
* update checks ``expected_version`` for optimistic concurrency and returns 409
  on conflict;
* delete is a soft delete (sets ``deleted_at`` and bumps ``version``) so other
  devices learn about the deletion via delta sync.

Entitlements: notes are an optional feature. ``EntitlementService`` is the seam
for future paid access; business code asks ``is_notes_allowed(user)`` and never
hard-codes "paid => allowed". In dev/tests ``NOTES_ENABLED_FOR_ALL`` grants all.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import Note, User
from ..utc_now import as_utc, utcnow


def _to_naive_utc(dt: datetime) -> datetime:
    """Strip tz-info, assuming UTC, to match SQLite's naive DATETIME storage.

    On PostgreSQL with a timezone-aware column this is harmless because the
    values are still the same instant. This keeps filter comparisons valid on
    SQLite where mixing aware and naive datetimes raises.
    """
    aware = as_utc(dt)
    return aware.replace(tzinfo=None) if aware is not None else dt


class NoteConflictError(Exception):
    """Raised on optimistic-concurrency conflict (=> HTTP 409)."""

    def __init__(self, current_version: int) -> None:
        super().__init__("note version conflict")
        self.current_version = current_version


class NoteLimitError(Exception):
    """Raised when a payload exceeds configured limits."""


class EntitlementDeniedError(Exception):
    """Raised when the per-user entitlement check denies notes access (=> 403)."""


class EntitlementService:
    """Replaceable per-user entitlement interface for the (future-paid) notes
    feature.

    This is the seam business code depends on. It is intentionally an interface
    (``is_notes_allowed(user, db)``) rather than a hard-coded flag, so that a
    real implementation can consult a subscription/entitlement store per user
    WITHOUT touching the notes service. Payments are out of scope this round.

    The default implementation honours a test/dev global toggle
    (``NOTES_ENABLED_FOR_ALL``); production sets that to ``false`` and injects a
    real per-user implementation. Business code must never assume "paid =>
    allowed".
    """

    def is_notes_allowed(self, user: User, db: Session) -> bool:
        raise NotImplementedError


class AllowAllEntitlementService(EntitlementService):
    """Test/dev fallback: grants notes to everyone via a global config toggle.

    Used when ``NOTES_ENABLED_FOR_ALL`` is true. Not suitable for production
    gating — there is no per-user check.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def is_notes_allowed(self, user: User, db: Session) -> bool:
        return bool(self._settings.notes_enabled_for_all)


class DenyAllEntitlementService(EntitlementService):
    """Default in production: deny unless a real per-user service is wired.

    This makes it impossible to accidentally ship "everyone has paid notes".
    """

    def is_notes_allowed(self, user: User, db: Session) -> bool:
        return False


def build_default_entitlement_service(settings: Settings) -> EntitlementService:
    """Pick the default entitlement service from settings.

    Tests/dev get the allow-all toggle; production (or when the toggle is off)
    gets deny-all, forcing an explicit real implementation to be injected later.
    """
    if settings.notes_enabled_for_all:
        return AllowAllEntitlementService(settings)
    return DenyAllEntitlementService()


class NotesService:
    def __init__(self, settings: Settings, entitlement: EntitlementService) -> None:
        self._settings = settings
        self._entitlement = entitlement

    # ------------------------------------------------------------------ #
    # Create (idempotent)
    # ------------------------------------------------------------------ #
    def create_or_get(
        self,
        db: Session,
        user: User,
        note_id: UUID,
        title: str,
        content: str,
        tags: List[str],
        reading_id: Optional[str],
        reading_snapshot_ref: Optional[str],
    ) -> Tuple[Note, bool]:
        """Create a note, or return the existing one with the same id.

        Returns ``(note, created)``. Re-posting the same id is a no-op: the
        existing note is returned unchanged (no version bump), which makes the
        create endpoint safe to retry.
        """
        self._check_access(db, user)
        self._validate_payload(title, content, tags)

        existing = db.get(Note, note_id)
        if existing is not None:
            # Enforce ownership even on the idempotent path.
            if existing.user_id != user.id:
                # Don't leak existence across users: treat as a fresh create that
                # happens to collide on a global PK -> conflict-ish 409 is wrong
                # here; instead raise so the router returns 403/409 consistently.
                raise NoteConflictError(existing.version)
            return existing, False

        now = utcnow()
        note = Note(
            id=note_id,
            user_id=user.id,
            title=title or "",
            content=content or "",
            tags_json=json.dumps(tags or [], ensure_ascii=False),
            reading_id=reading_id,
            reading_snapshot_ref=reading_snapshot_ref,
            created_at=now,
            updated_at=now,
            version=1,
        )
        db.add(note)
        db.commit()
        db.refresh(note)
        return note, True

    # ------------------------------------------------------------------ #
    # Read
    # ------------------------------------------------------------------ #
    def get(self, db: Session, user: User, note_id: UUID) -> Optional[Note]:
        self._check_access(db, user)
        note = db.get(Note, note_id)
        if note is None or note.user_id != user.id:
            return None
        return note

    def list(
        self,
        db: Session,
        user: User,
        *,
        limit: int,
        updated_after: Optional[datetime] = None,
        deleted: str = "exclude",
        cursor: Optional[str] = None,
    ) -> Tuple[List[Note], Optional[str], bool]:
        """List notes for delta sync / pagination.

        Pagination is keyset on ``(updated_at, id)`` so results are stable
        across concurrent writes. ``updated_after`` returns only notes changed
        since that time (including tombstones when ``deleted='include'``).
        """
        self._check_access(db, user)
        limit = max(1, min(limit, self._settings.notes_max_page_size))

        conds = [Note.user_id == user.id]
        if deleted == "exclude":
            conds.append(Note.deleted_at.is_(None))
        elif deleted == "only":
            conds.append(Note.deleted_at.is_not(None))
        # 'include' => no filter on deleted_at

        if updated_after is not None:
            conds.append(Note.updated_at > _to_naive_utc(updated_after))

        # Keyset cursor: "<updated_at iso>||<id>".
        if cursor:
            try:
                ts_str, id_str = cursor.split("||", 1)
                ts = _to_naive_utc(datetime.fromisoformat(ts_str))
                cid = UUID(id_str)
                conds.append(
                    or_(
                        Note.updated_at > ts,
                        and_(Note.updated_at == ts, Note.id > cid),
                    )
                )
            except (ValueError, TypeError):
                # Bad cursor -> ignore (start from beginning).
                pass

        q = (
            db.query(Note)
            .filter(*conds)
            .order_by(Note.updated_at.asc(), Note.id.asc())
            .limit(limit + 1)
        )
        rows = q.all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            next_cursor = f"{last.updated_at.isoformat()}||{last.id}"
        return rows, next_cursor, has_more

    # ------------------------------------------------------------------ #
    # Update
    # ------------------------------------------------------------------ #
    def update(
        self,
        db: Session,
        user: User,
        note_id: UUID,
        *,
        title: Optional[str],
        content: Optional[str],
        tags: Optional[List[str]],
        reading_id: Optional[str],
        reading_snapshot_ref: Optional[str],
        expected_version: Optional[int],
    ) -> Note:
        self._check_access(db, user)
        note = db.get(Note, note_id)
        if note is None or note.user_id != user.id:
            raise LookupError("note not found")
        # Only live notes can be edited; restoring a deleted note is out of
        # scope for this round (client should recreate with a new id).
        if note.deleted_at is not None:
            raise LookupError("note not found")

        # Optimistic concurrency check.
        if expected_version is not None and expected_version != note.version:
            raise NoteConflictError(note.version)

        # Validate the parts being changed.
        new_title = title if title is not None else note.title
        new_content = content if content is not None else note.content
        new_tags = tags if tags is not None else self._tags_of(note)
        self._validate_payload(new_title, new_content, new_tags)

        changed = False
        if title is not None and note.title != title:
            note.title = title
            changed = True
        if content is not None and note.content != content:
            note.content = content
            changed = True
        if tags is not None:
            new_tags_json = json.dumps(tags, ensure_ascii=False)
            if note.tags_json != new_tags_json:
                note.tags_json = new_tags_json
                changed = True
        if reading_id is not None and note.reading_id != reading_id:
            note.reading_id = reading_id
            changed = True
        if reading_snapshot_ref is not None and note.reading_snapshot_ref != reading_snapshot_ref:
            note.reading_snapshot_ref = reading_snapshot_ref
            changed = True

        if changed:
            note.version += 1
            note.updated_at = utcnow()
            db.commit()
            db.refresh(note)
        return note

    # ------------------------------------------------------------------ #
    # Soft delete (tombstone)
    # ------------------------------------------------------------------ #
    def delete(self, db: Session, user: User, note_id: UUID) -> Optional[Note]:
        self._check_access(db, user)
        note = db.get(Note, note_id)
        if note is None or note.user_id != user.id:
            return None
        if note.deleted_at is None:
            note.deleted_at = utcnow()
            note.version += 1
            db.commit()
            db.refresh(note)
        return note

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _tags_of(self, note: Note) -> List[str]:
        try:
            return json.loads(note.tags_json or "[]")
        except (TypeError, ValueError):
            return []

    def _check_access(self, db: Session, user: User) -> None:
        if not self._entitlement.is_notes_allowed(user, db):
            raise EntitlementDeniedError(
                "notes feature is not enabled for this account"
            )

    def _validate_payload(self, title: str, content: str, tags: List[str]) -> None:
        if title is not None and len(title) > self._settings.note_title_max_length:
            raise NoteLimitError("title too long")
        if content is not None and len(content) > self._settings.note_content_max_length:
            raise NoteLimitError("content too long")
        if tags is not None:
            if len(tags) > self._settings.note_tags_max_count:
                raise NoteLimitError("too many tags")
            for t in tags:
                if len(t) > self._settings.note_tag_max_length:
                    raise NoteLimitError("tag too long")
