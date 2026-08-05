"""PostgreSQL integration tests for cross-DB timezone correctness.

These run ONLY when ``DATABASE_URL_PG`` points at a live PostgreSQL instance,
e.g.::

    DATABASE_URL_PG=postgresql+psycopg://test:testpw@127.0.0.1:55432/quareia_test \
        python -m pytest tests/test_postgres_integration.py -v -s

Otherwise they are skipped (no PostgreSQL available in CI). They verify the
``verify_code`` atomic conditional UPDATE behaves identically on PostgreSQL
(tz-aware ``timestamptz`` columns) as on SQLite, plus real 8-way concurrency.

We connect via ``127.0.0.1`` rather than ``localhost`` to avoid the IPv6/AAAA
resolution fallback that can make each connection ~10s slower on some hosts.
"""

from __future__ import annotations

import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest

PG_URL = os.environ.get("DATABASE_URL_PG")


pytestmark = pytest.mark.skipif(
    not PG_URL,
    reason="set DATABASE_URL_PG to a live PostgreSQL DSN to run these tests",
)


def _settings():
    os.environ["DATABASE_URL"] = PG_URL
    os.environ["MAIL_PROVIDER"] = "devtest"
    os.environ["SECRET_KEY"] = "pg-integration-secret"
    os.environ["CREATE_TABLES_ON_STARTUP"] = "false"
    os.environ["EMAIL_CODE_MAX_ATTEMPTS"] = "5"
    from app.config import Settings

    return Settings()


@pytest.fixture(scope="module")
def pg_engine():
    from app.db import Base, build_engine

    settings = _settings()
    engine, factory = build_engine(settings)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine, factory, settings
    Base.metadata.drop_all(engine)
    engine.dispose()


def _seed_challenge(factory, settings, email, *, expired=False, max_attempts=5):
    from app.models import EmailChallenge
    from app.security import generate_email_code, hash_code
    from app.utc_now import utcnow

    code = generate_email_code(6)
    delta = timedelta(seconds=-1) if expired else timedelta(seconds=600)
    with factory() as db:
        db.add(
            EmailChallenge(
                email=email,
                code_digest=hash_code(code, settings),
                expires_at=utcnow() + delta,
                attempts=0,
                consumed_at=None,
                delivered=True,
            )
        )
        db.commit()
    return code


def test_verify_code_succeeds_on_postgres(pg_engine):
    """The atomic conditional UPDATE must accept a valid code on PostgreSQL."""
    engine, factory, settings = pg_engine
    from app.mail import build_mail_provider
    from app.ratelimit import get_limiter, reset_limiter
    from app.services.auth import AuthService

    reset_limiter()
    svc = AuthService(settings, build_mail_provider(settings), get_limiter())
    email = f"pgok-{uuid.uuid4().hex[:6]}@example.com"
    code = _seed_challenge(factory, settings, email)
    with factory() as db:
        device, session, token, is_new = svc.verify_code(
            db, email, code, "install-1", "d", "android"
        )
        db.commit()
    assert is_new is True
    assert token and len(token) >= 32


def test_expired_code_rejected_on_postgres(pg_engine):
    """An expired challenge must not verify on PostgreSQL (expires_at > db_now)."""
    engine, factory, settings = pg_engine
    from app.mail import build_mail_provider
    from app.ratelimit import get_limiter, reset_limiter
    from app.services.auth import CodeVerifyError

    reset_limiter()
    from app.services.auth import AuthService

    svc = AuthService(settings, build_mail_provider(settings), get_limiter())
    email = f"pgexp-{uuid.uuid4().hex[:6]}@example.com"
    code = _seed_challenge(factory, settings, email, expired=True)
    with factory() as db:
        with pytest.raises(CodeVerifyError):
            svc.verify_code(db, email, code, "install-2", "d", "android")
            db.commit()


@pytest.mark.parametrize("round_idx", range(10))
def test_concurrent_verify_single_winner_on_postgres(pg_engine, round_idx):
    """8 threads verify the SAME code; exactly 1 wins, no 500, 1 session."""
    engine, factory, settings = pg_engine
    from app.mail import build_mail_provider
    from app.ratelimit import get_limiter, reset_limiter
    from app.models import DeviceSession, User
    from app.services.auth import AuthService, CodeVerifyError

    reset_limiter()
    svc = AuthService(settings, build_mail_provider(settings), get_limiter())
    email = f"pgrace{round_idx}-{uuid.uuid4().hex[:6]}@example.com"
    code = _seed_challenge(factory, settings, email)
    threads_n = 8
    barrier = threading.Barrier(threads_n)
    results = []

    def worker(i):
        barrier.wait()
        try:
            with factory() as db:
                svc.verify_code(db, email, code, f"i-{i}", "d", "android")
                db.commit()
            results.append((True, 200))
        except CodeVerifyError as exc:
            results.append((False, exc.status_code))
        except Exception:
            results.append((False, 500))

    with ThreadPoolExecutor(max_workers=threads_n) as ex:
        futs = [ex.submit(worker, i) for i in range(threads_n)]
        [f.result() for f in futs]

    wins = sum(1 for ok, _ in results if ok)
    statuses = [s for _, s in results]
    with factory() as db:
        u = db.query(User).filter(User.email == email).one()
        sessions = db.query(DeviceSession).filter(DeviceSession.user_id == u.id).count()
    assert wins == 1, f"round {round_idx}: expected 1 winner, got {wins}"
    assert 500 not in statuses
    assert sessions == 1


def test_concurrent_wrong_codes_no_lost_attempts_on_postgres(pg_engine):
    """Concurrent wrong guesses bump attempts atomically; correct code not consumed."""
    engine, factory, settings = pg_engine
    # Raise the cap above the thread count so the cap can't mask a lost update.
    os.environ["EMAIL_CODE_MAX_ATTEMPTS"] = "50"
    from app.config import Settings

    settings = Settings()
    from app.mail import build_mail_provider
    from app.ratelimit import get_limiter, reset_limiter
    from app.models import EmailChallenge
    from app.services.auth import AuthService, CodeVerifyError

    reset_limiter()
    svc = AuthService(settings, build_mail_provider(settings), get_limiter())
    email = f"pgwrong-{uuid.uuid4().hex[:6]}@example.com"
    real = _seed_challenge(factory, settings, email, max_attempts=50)
    threads_n = 8
    wrong = [f"{i:06d}" for i in range(threads_n)]
    assert real not in wrong
    barrier = threading.Barrier(threads_n)
    results = []

    def worker(i):
        barrier.wait()
        try:
            with factory() as db:
                svc.verify_code(db, email, wrong[i], f"w-{i}", "d", "android")
                db.commit()
            results.append(True)
        except CodeVerifyError:
            results.append(False)
        except Exception:
            results.append(False)

    with ThreadPoolExecutor(max_workers=threads_n) as ex:
        futs = [ex.submit(worker, i) for i in range(threads_n)]
        [f.result() for f in futs]

    assert all(not ok for ok in results)
    with factory() as db:
        ch = (
            db.query(EmailChallenge)
            .filter(EmailChallenge.email == email)
            .order_by(EmailChallenge.created_at.desc())
            .first()
        )
        assert ch.consumed_at is None
        assert ch.attempts == threads_n  # no lost update
    os.environ["EMAIL_CODE_MAX_ATTEMPTS"] = "5"
