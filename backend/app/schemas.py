"""Pydantic request/response schemas.

A few notes on security-by-design:

* Auth responses never echo the email-registered vs not-registered distinction:
  ``SendCodeResponse`` is identical for new and existing users.
* Device token is returned exactly once, at verification time. It is never
  returned again by any endpoint.
* Note bodies are bounded in size at validation time (before reaching the DB) to
  reject oversized payloads early.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
class SendCodeRequest(BaseModel):
    email: EmailStr = Field(..., examples=["alice@example.com"])
    # Optional client hints for device bookkeeping at verify time.
    installation_id: Optional[str] = Field(default=None, max_length=64, examples=["550e8400-e29b-41d4-a716-446655440000"])
    device_name: Optional[str] = Field(default=None, max_length=128, examples=["Pixel 8"])
    platform: Optional[str] = Field(default=None, max_length=64, examples=["android"])


class SendCodeResponse(BaseModel):
    # Generic, non-leaky response. Same shape whether or not the email exists.
    message: str = "If this email is valid, a verification code is on its way."
    # Seconds the client should wait before requesting again (rate-limit hint).
    resend_in_seconds: int = Field(..., examples=[60])


class VerifyCodeRequest(BaseModel):
    email: EmailStr = Field(..., examples=["alice@example.com"])
    code: str = Field(min_length=6, max_length=6, examples=["482915"])
    installation_id: str = Field(min_length=1, max_length=64, examples=["550e8400-e29b-41d4-a716-446655440000"])
    device_name: Optional[str] = Field(default=None, max_length=128, examples=["Pixel 8"])
    platform: Optional[str] = Field(default=None, max_length=64, examples=["android"])


class VerifyCodeResponse(BaseModel):
    device_token: str = Field(..., examples=["v3ryL0ng0p4queU_r_lSafeToken..."])
    device_id: UUID
    is_new_user: bool


class LogoutRequest(BaseModel):
    # When true, revoke only the current device token; when false is ignored.
    pass


class MeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    status: str
    created_at: datetime


class DeviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    installation_id: str
    name: Optional[str]
    platform: Optional[str]
    created_at: datetime
    last_used_at: Optional[datetime] = None
    is_current: bool = False
    session_active: bool = False


class DevicesListResponse(BaseModel):
    devices: List[DeviceResponse]


# --------------------------------------------------------------------------- #
# Notes
# --------------------------------------------------------------------------- #
class NoteBase(BaseModel):
    title: str = Field(default="", max_length=200)
    content: str = Field(default="", max_length=100_000)
    tags: List[str] = Field(default_factory=list)
    reading_id: Optional[str] = Field(default=None, max_length=128)
    reading_snapshot_ref: Optional[str] = Field(default=None, max_length=255)

    @field_validator("tags")
    @classmethod
    def _validate_tags(cls, v: List[str]) -> List[str]:
        if len(v) > 32:
            raise ValueError("too many tags (max 32)")
        out: List[str] = []
        for t in v:
            if not isinstance(t, str):
                raise ValueError("tags must be strings")
            t2 = t.strip()
            if not t2:
                continue
            if len(t2) > 64:
                raise ValueError("tag too long (max 64)")
            out.append(t2)
        return out


class NoteCreate(NoteBase):
    # Client-generated UUID enables offline-first creation + later sync, and
    # powers idempotency: re-posting the same id returns the existing note.
    id: UUID = Field(..., examples=["6ba7b810-9dad-11d1-80b4-00c04fd430c8"])


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    content: Optional[str] = Field(default=None, max_length=100_000)
    tags: Optional[List[str]] = None
    reading_id: Optional[str] = Field(default=None, max_length=128)
    reading_snapshot_ref: Optional[str] = Field(default=None, max_length=255)
    # If provided, server checks it equals the current version; else 409.
    expected_version: Optional[int] = None

    @field_validator("tags")
    @classmethod
    def _validate_tags(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return None
        if len(v) > 32:
            raise ValueError("too many tags (max 32)")
        out: List[str] = []
        for t in v:
            if not isinstance(t, str):
                raise ValueError("tags must be strings")
            t2 = t.strip()
            if not t2:
                continue
            if len(t2) > 64:
                raise ValueError("tag too long (max 64)")
            out.append(t2)
        return out


class NoteResponse(NoteBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None
    version: int


class NoteListResponse(BaseModel):
    items: List[NoteResponse]
    next_cursor: Optional[str] = None
    has_more: bool = False
    server_time: datetime


# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #
class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
