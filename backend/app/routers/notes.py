"""Cloud notes endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import get_db, get_entitlement_service, get_settings, require_user
from ..models import Note, User
from ..schemas import (
    NoteCreate,
    NoteListResponse,
    NoteResponse,
    NoteUpdate,
)
from ..services.notes import (
    EntitlementDeniedError,
    EntitlementService,
    NoteConflictError,
    NoteLimitError,
    NotesService,
)

router = APIRouter(prefix="/api/v1/notes", tags=["notes"])


def _service(settings: Settings, entitlement: EntitlementService) -> NotesService:
    return NotesService(settings=settings, entitlement=entitlement)


def _to_response(note: Note) -> NoteResponse:
    import json

    try:
        tags = json.loads(note.tags_json or "[]")
    except (TypeError, ValueError):
        tags = []
    return NoteResponse(
        id=note.id,
        user_id=note.user_id,
        title=note.title,
        content=note.content,
        tags=tags,
        reading_id=note.reading_id,
        reading_snapshot_ref=note.reading_snapshot_ref,
        created_at=note.created_at,
        updated_at=note.updated_at,
        deleted_at=note.deleted_at,
        version=note.version,
    )


@router.post(
    "",
    response_model=NoteResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"description": "Idempotent re-create returned existing note"},
        401: {"description": "Missing/invalid/revoked device token"},
        403: {"description": "Notes feature not enabled (entitlement denied)"},
        409: {"description": "Client UUID collides with another user's note"},
        422: {"description": "Validation error (oversized payload, too many tags)"},
    },
)
def create_note(
    payload: NoteCreate,
    response: Response,
    user_session=Depends(require_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    entitlement: EntitlementService = Depends(get_entitlement_service),
):
    """Create a note (idempotent on ``id``).

    Re-submitting the same client-generated UUID returns the existing note with
    status 200 and does not create a duplicate or bump the version.
    """
    user, _ = user_session
    svc = _service(settings, entitlement)
    try:
        note, created = svc.create_or_get(
            db,
            user,
            payload.id,
            payload.title,
            payload.content,
            payload.tags,
            payload.reading_id,
            payload.reading_snapshot_ref,
        )
    except NoteLimitError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except NoteConflictError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="id collision") from None

    # 201 on actual create, 200 on idempotent re-create.
    if not created:
        response.status_code = status.HTTP_200_OK
    return _to_response(note)


@router.get(
    "",
    response_model=NoteListResponse,
    responses={
        401: {"description": "Missing/invalid/revoked device token"},
        403: {"description": "Notes feature not enabled (entitlement denied)"},
    },
)
def list_notes(
    user_session=Depends(require_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    entitlement: EntitlementService = Depends(get_entitlement_service),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: Optional[str] = Query(default=None),
    updated_after: Optional[datetime] = Query(default=None),
    deleted: str = Query(default="exclude", pattern="^(exclude|include|only)$"),
):
    """List notes with pagination and optional delta sync.

    * ``limit`` — page size (1..200).
    * ``cursor`` — opaque next-page cursor returned by the previous call.
    * ``updated_after`` — only return notes changed after this UTC time
      (include ``deleted=include`` to also receive tombstones).
    * ``deleted`` — ``exclude`` (default), ``include`` (tombstones too) or
      ``only`` (only tombstones).
    """
    user, _ = user_session
    svc = _service(settings, entitlement)
    rows, next_cursor, has_more = svc.list(
        db,
        user,
        limit=limit,
        updated_after=updated_after,
        deleted=deleted,
        cursor=cursor,
    )
    return NoteListResponse(
        items=[_to_response(r) for r in rows],
        next_cursor=next_cursor,
        has_more=has_more,
        server_time=datetime.now(timezone.utc),
    )


@router.get(
    "/{note_id}",
    response_model=NoteResponse,
    responses={
        401: {"description": "Missing/invalid/revoked device token"},
        403: {"description": "Notes feature not enabled (entitlement denied)"},
        404: {"description": "Note not found / not owned by you / soft-deleted"},
    },
)
def get_note(
    note_id: UUID,
    user_session=Depends(require_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    entitlement: EntitlementService = Depends(get_entitlement_service),
):
    """Fetch a single note. Returns 404 if missing, not yours, or soft-deleted."""
    user, _ = user_session
    note = _service(settings, entitlement).get(db, user, note_id)
    if note is None or note.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="note not found")
    return _to_response(note)


@router.patch(
    "/{note_id}",
    response_model=NoteResponse,
    responses={
        401: {"description": "Missing/invalid/revoked device token"},
        403: {"description": "Notes feature not enabled (entitlement denied)"},
        404: {"description": "Note not found / not owned by you / soft-deleted"},
        409: {"description": "Version conflict (stale expected_version)"},
        422: {"description": "Validation error"},
    },
)
def update_note(
    note_id: UUID,
    payload: NoteUpdate,
    user_session=Depends(require_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    entitlement: EntitlementService = Depends(get_entitlement_service),
):
    """Partially update a note.

    Pass ``expected_version`` for optimistic concurrency; a mismatch returns
    ``409`` with the current version in the detail.
    """
    user, _ = user_session
    svc = _service(settings, entitlement)
    try:
        note = svc.update(
            db,
            user,
            note_id,
            title=payload.title,
            content=payload.content,
            tags=payload.tags,
            reading_id=payload.reading_id,
            reading_snapshot_ref=payload.reading_snapshot_ref,
            expected_version=payload.expected_version,
        )
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="note not found") from None
    except NoteConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"version conflict; current version is {exc.current_version}",
        ) from exc
    except NoteLimitError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _to_response(note)


@router.delete(
    "/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        401: {"description": "Missing/invalid/revoked device token"},
        403: {"description": "Notes feature not enabled (entitlement denied)"},
        404: {"description": "Note not found / not owned by you"},
    },
)
def delete_note(
    note_id: UUID,
    user_session=Depends(require_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    entitlement: EntitlementService = Depends(get_entitlement_service),
):
    """Soft-delete a note (tombstone). Other devices see the deletion via
    ``GET /notes?deleted=include``."""
    user, _ = user_session
    note = _service(settings, entitlement).delete(db, user, note_id)
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="note not found")
    return None
