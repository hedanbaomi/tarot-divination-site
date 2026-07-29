"""Current-user and device-management endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import get_db, get_mail_provider, get_settings, require_device, require_user
from ..mail import MailProvider
from ..models import Device, DeviceSession, User
from ..ratelimit import get_limiter
from ..schemas import DeviceResponse, DevicesListResponse, MeResponse
from ..services.auth import AuthService

router = APIRouter(prefix="/api/v1/me", tags=["me"])


def _service(settings: Settings, mail: MailProvider) -> AuthService:
    return AuthService(settings=settings, mail_provider=mail, limiter=get_limiter())


@router.get("", response_model=MeResponse)
def me(user_session=Depends(require_user)):
    """Return the authenticated user's profile (id, email, status)."""
    user, _ = user_session
    return user


@router.get("/devices", response_model=DevicesListResponse)
def list_devices(
    user_session=Depends(require_user),
    db: Session = Depends(get_db),
):
    """List all devices bound to this account, marking the current one."""
    user, current_session = user_session
    devices = (
        db.query(Device)
        .filter(Device.user_id == user.id)
        .order_by(Device.created_at.asc())
        .all()
    )
    out = []
    for d in devices:
        # A device is "active" if it has at least one non-revoked session.
        active = any(not s.is_revoked for s in d.sessions)
        out.append(
            DeviceResponse(
                id=d.id,
                installation_id=d.installation_id,
                name=d.name,
                platform=d.platform,
                created_at=d.created_at,
                last_seen_at=max(
                    (s.last_seen_at for s in d.sessions if s.last_seen_at is not None),
                    default=None,
                ),
                is_current=d.id == current_session.device_id,
                session_active=active,
            )
        )
    return DevicesListResponse(devices=out)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_device(
    device_id: UUID,
    user_session=Depends(require_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    mail: MailProvider = Depends(get_mail_provider),
):
    """Revoke all sessions for a device.

    The device row and its notes are intentionally **not** deleted: revoking a
    session must never destroy cloud data.
    """
    user, _ = user_session
    count = _service(settings, mail).revoke_device(db, user.id, device_id)
    if count == 0:
        # Could be no sessions, or the device isn't owned by this user. Either
        # way, return 404 to avoid leaking device existence across users.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
    return None
