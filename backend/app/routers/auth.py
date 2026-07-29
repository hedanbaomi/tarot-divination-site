"""Authentication & device endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import get_db, get_mail_provider, get_settings, require_device, require_user
from ..mail import MailProvider
from ..models import Device, DeviceSession, User
from ..normalize import client_ip
from ..ratelimit import get_limiter
from ..schemas import (
    DevicesListResponse,
    DeviceResponse,
    LogoutRequest,
    MeResponse,
    SendCodeRequest,
    SendCodeResponse,
    VerifyCodeRequest,
    VerifyCodeResponse,
)
from ..services.auth import AuthService, CodeVerifyError, MailSendFailedError, SendCodeError

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _service(settings: Settings, mail: MailProvider) -> AuthService:
    return AuthService(settings=settings, mail_provider=mail, limiter=get_limiter())


@router.post(
    "/email/send-code",
    response_model=SendCodeResponse,
    responses={
        429: {"description": "Rate limited / resend throttle"},
        503: {"description": "Email delivery temporarily unavailable"},
    },
)
def send_code(
    payload: SendCodeRequest,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    mail: MailProvider = Depends(get_mail_provider),
) -> SendCodeResponse:
    """Request a 6-digit email verification code.

    The response is identical whether or not the email is already registered, so
    this endpoint cannot be used to enumerate accounts. If the mail provider
    fails to deliver, a unified **503** is returned (without the provider's
    response body) and no usable challenge is stored.
    """
    svc = _service(settings, mail)
    try:
        return svc.send_code(db, str(payload.email), client_ip(request))
    except SendCodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=exc.detail,
            headers={"Retry-After": str(max(1, int(exc.retry_after)))},
        ) from exc
    except MailSendFailedError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
            headers={"Retry-After": "60"},
        ) from exc


@router.post(
    "/email/verify-code",
    response_model=VerifyCodeResponse,
    responses={
        400: {"description": "Invalid / expired / used code"},
        429: {"description": "Too many attempts"},
    },
)
def verify_code(
    payload: VerifyCodeRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    mail: MailProvider = Depends(get_mail_provider),
) -> VerifyCodeResponse:
    """Verify the code and obtain a long-lived device token.

    If the email is new, an account is created automatically. The returned
    ``device_token`` is shown exactly once — store it securely on the client.
    """
    svc = _service(settings, mail)
    try:
        device, session, raw_token, is_new = svc.verify_code(
            db,
            str(payload.email),
            payload.code,
            payload.installation_id,
            payload.device_name,
            payload.platform,
        )
    except CodeVerifyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return VerifyCodeResponse(
        device_token=raw_token,
        device_id=device.id,
        is_new_user=is_new,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    _: LogoutRequest = None,
    session: DeviceSession = Depends(require_device),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    mail: MailProvider = Depends(get_mail_provider),
):
    """Revoke the device token used for this request only."""
    _service(settings, mail).logout(db, session)
    return None


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
def logout_all(
    user_session=Depends(require_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    mail: MailProvider = Depends(get_mail_provider),
):
    """Revoke every active session for the current user."""
    user, _ = user_session
    _service(settings, mail).logout_all(db, user.id)
    return None
