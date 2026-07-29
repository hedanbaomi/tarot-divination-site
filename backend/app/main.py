"""FastAPI application factory.

Run locally:

    uvicorn app.main:app --reload

Or via the ASGI entry point ``app.main:create_app``.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .db import Base, build_engine
from .deps import configure_state
from .logging_setup import configure_logging
from .mail import build_mail_provider
from .ratelimit import reset_limiter
from .routers import auth as auth_router
from .routers import me as me_router
from .routers import notes as notes_router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging("INFO")

    engine, session_factory = build_engine(settings)
    mail_provider = build_mail_provider(settings)
    configure_state(engine, session_factory, settings, mail_provider)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Dev convenience: create tables on startup. Production uses Alembic.
        if settings.create_tables_on_startup:
            Base.metadata.create_all(bind=engine)
        yield

    app = FastAPI(
        title="Quareia Companion API",
        description=(
            "Account login (email verification code -> long-lived device token) "
            "and optional cloud notes for the Quareia Companion Android app. "
            "The core offline divination experience does not depend on this API."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS. Defaults to permissive in dev; configure CORS_ALLOW_ORIGINS in prod.
    allow = list(settings.cors_allow_origins) or ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow,
        allow_credentials=False,  # we use bearer tokens, not cookies
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    app.include_router(auth_router.router)
    app.include_router(me_router.router)
    app.include_router(notes_router.router)

    @app.get("/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok"}

    return app


# Module-level ASGI app for ``uvicorn app.main:app``.
app = create_app()
