"""Authentication & device-session service.

Encapsulates all the rules from the spec:

* auto-register on first verify (login == registration);
* 6-digit, single-use, 10-min, ≤5 wrong attempts codes;
* ≥60s resend throttle + per-email/per-IP rate limiting;
* only the code digest is persisted, and only if delivery succeeded;
* on verify: register/find the device by ``installation_id`` and mint a new
  long-lived opaque device token (we store its digest, return the raw token
  exactly once);
* logout / revoke set ``revoked_at`` and clear the digest so the token dies.

Security: we never raise an error distinguishing "email exists" from "doesn't"
on send-code; failures there return the same generic response.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Optional

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..mail import MailDeliveryError, MailMessage, MailProvider
from ..models import Device, DeviceSession, EmailChallenge, User
from ..normalize import normalize_email
from ..ratelimit import RateLimiter
from ..schemas import SendCodeResponse
from ..security import (
    generate_device_token,
    generate_email_code,
    hash_code,
    hash_token,
)
from ..utc_now import as_utc, utcnow


class SendCodeError(Exception):
    """Raised for rate-limit / resend-throttle violations.

    These are NOT surfaced as email-existence leaks; they're plain 429s.
    """

    def __init__(self, detail: str, retry_after: int = 60) -> None:
        super().__init__(detail)
        self.detail = detail
        self.retry_after = retry_after


class CodeVerifyError(Exception):
    """Raised for bad/expired/used codes or too many attempts."""

    def __init__(self, detail: str, status_code: int = 400) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class AuthService:
    def __init__(
        self,
        settings: Settings,
        mail_provider: MailProvider,
        limiter: RateLimiter,
    ) -> None:
        self._settings = settings
        self._mail = mail_provider
        self._limiter = limiter

    # ------------------------------------------------------------------ #
    # Send code
    # ------------------------------------------------------------------ #
    def send_code(
        self,
        db: Session,
        email: str,
        client_ip: str,
    ) -> SendCodeResponse:
        email = normalize_email(email)

        # Per-email resend throttle: ≥60s between any two successful sends.
        last = (
            db.query(EmailChallenge)
            .filter(EmailChallenge.email == email)
            .order_by(desc(EmailChallenge.created_at))
            .first()
        )
        if last is not None and last.created_at is not None:
            elapsed = (utcnow() - as_utc(last.created_at)).total_seconds()
            remaining = self._settings.email_resend_min_interval_seconds - elapsed
            if remaining > 0:
                raise SendCodeError(
                    f"please wait {int(remaining)} seconds before requesting again",
                    retry_after=int(remaining),
                )

        # Windowed rate limits on (email) and (client_ip).
        if not self._limiter.allow(
            email,
            self._settings.rate_limit_email_per_window,
            self._settings.rate_limit_email_window_seconds,
        ):
            raise SendCodeError(
                "too many code requests for this email",
                retry_after=self._settings.rate_limit_email_window_seconds,
            )
        if not self._limiter.allow(
            client_ip,
            self._settings.rate_limit_ip_per_window,
            self._settings.rate_limit_ip_window_seconds,
        ):
            raise SendCodeError(
                "too many code requests from this network",
                retry_after=self._settings.rate_limit_ip_window_seconds,
            )

        code = generate_email_code(self._settings.email_code_length)
        expires_at = utcnow() + timedelta(seconds=self._settings.email_code_ttl_seconds)

        # Try to deliver FIRST. Only if it succeeds do we persist a usable
        # challenge, so a provider failure leaves no valid code state.
        try:
            self._mail.send(self._build_mail(email, code))
        except MailDeliveryError:
            # Do not persist anything; surface a generic message to the client.
            return SendCodeResponse(
                message="If this email is valid, a verification code is on its way.",
                resend_in_seconds=self._settings.email_resend_min_interval_seconds,
            )

        challenge = EmailChallenge(
            email=email,
            code_digest=hash_code(code, self._settings),
            expires_at=expires_at,
            attempts=0,
            consumed_at=None,
            delivered=True,
        )
        db.add(challenge)
        db.commit()

        # Record sends AFTER success so a failed delivery doesn't consume quota.
        self._limiter.record(email)
        self._limiter.record(client_ip)

        return SendCodeResponse(
            resend_in_seconds=self._settings.email_resend_min_interval_seconds
        )

    def _build_mail(self, email: str, code: str) -> MailMessage:
        minutes = self._settings.email_code_ttl_seconds // 60
        body = (
            f"Your Quareia Companion verification code is {code}.\n\n"
            f"It expires in {minutes} minutes. If you didn't request this, "
            f"you can safely ignore this email."
        )
        return MailMessage(
            to=email,
            subject="Your Quareia Companion sign-in code",
            body=body,
        )

    # ------------------------------------------------------------------ #
    # Verify code -> mint device token
    # ------------------------------------------------------------------ #
    def verify_code(
        self,
        db: Session,
        email: str,
        code: str,
        installation_id: str,
        device_name: Optional[str],
        platform: Optional[str],
    ) -> tuple[Device, DeviceSession, str, bool]:
        """Return ``(device, session, raw_token, is_new_user)``.

        Raises ``CodeVerifyError`` for any invalid/expired/used/over-attempt code.
        """
        email = normalize_email(email)

        # Pick the most recent non-consumed, non-expired challenge for this email.
        now = utcnow()
        challenges = (
            db.query(EmailChallenge)
            .filter(EmailChallenge.email == email)
            .order_by(desc(EmailChallenge.created_at))
            .limit(20)
            .all()
        )
        # Prefer a delivered, unconsumed, unexpired one; fall back to the latest
        # so we can give the right error (expired / too many attempts).
        challenge = next(
            (
                c
                for c in challenges
                if c.delivered
                and c.consumed_at is None
                and as_utc(c.expires_at) is not None
                and as_utc(c.expires_at) > now
            ),
            challenges[0] if challenges else None,
        )

        if challenge is None:
            raise CodeVerifyError("invalid or expired code", 400)

        # Enforce attempts BEFORE checking the code, to bound brute force.
        if challenge.consumed_at is not None:
            raise CodeVerifyError("code already used; request a new one", 400)
        if as_utc(challenge.expires_at) <= now:
            raise CodeVerifyError("code expired; request a new one", 400)
        if challenge.attempts >= self._settings.email_code_max_attempts:
            raise CodeVerifyError("too many incorrect attempts; request a new code", 429)

        from ..security import verify_code_digest

        if not verify_code_digest(code, challenge.code_digest, self._settings):
            challenge.attempts += 1
            db.commit()
            raise CodeVerifyError("invalid code", 400)

        # Success: consume the code (single use).
        challenge.consumed_at = now
        db.flush()

        # Auto-register if needed.
        is_new_user = False
        user = db.query(User).filter(User.email == email).one_or_none()
        if user is None:
            user = User(email=email, status="active")
            db.add(user)
            db.flush()
            is_new_user = True
        elif user.is_banned:
            raise CodeVerifyError("account unavailable", 403)

        # Find or create the device by (user, installation_id).
        device = (
            db.query(Device)
            .filter(
                Device.user_id == user.id,
                Device.installation_id == installation_id,
            )
            .one_or_none()
        )
        if device is None:
            device = Device(
                user_id=user.id,
                installation_id=installation_id,
                name=device_name,
                platform=platform,
            )
            db.add(device)
            db.flush()
        else:
            if device_name:
                device.name = device_name
            if platform:
                device.platform = platform

        # Mint a brand-new long-lived token. Any previous session for this
        # device is left intact (multi-session allowed); the spec only requires
        # that revocation/logout invalidates the specific token used.
        raw_token = generate_device_token(self._settings.device_token_bytes)
        session = DeviceSession(
            device_id=device.id,
            user_id=user.id,
            token_digest=hash_token(raw_token, self._settings),
            created_at=now,
            last_seen_at=now,
        )
        db.add(session)
        db.commit()
        db.refresh(device)
        db.refresh(session)
        return device, session, raw_token, is_new_user

    # ------------------------------------------------------------------ #
    # Logout / revoke
    # ------------------------------------------------------------------ #
    def logout(self, db: Session, session: DeviceSession) -> None:
        """Revoke only the supplied device session."""
        session.revoked_at = utcnow()
        session.token_digest = None
        db.commit()

    def logout_all(self, db: Session, user_id) -> int:
        """Revoke every active session for a user. Returns the count revoked."""
        rows = (
            db.query(DeviceSession)
            .filter(
                DeviceSession.user_id == user_id,
                DeviceSession.revoked_at.is_(None),
            )
            .all()
        )
        now = utcnow()
        for s in rows:
            s.revoked_at = now
            s.token_digest = None
        db.commit()
        return len(rows)

    def revoke_device(self, db: Session, user_id, device_id) -> int:
        """Revoke all sessions belonging to ``device_id`` owned by ``user_id``."""
        device = (
            db.query(Device)
            .filter(Device.id == device_id, Device.user_id == user_id)
            .one_or_none()
        )
        if device is None:
            return 0
        now = utcnow()
        count = 0
        for s in device.sessions:
            if s.revoked_at is None:
                s.revoked_at = now
                s.token_digest = None
                count += 1
        db.commit()
        # NOTE: we intentionally do NOT delete the device row or its notes.
        return count
