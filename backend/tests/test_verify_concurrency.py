"""Real concurrency tests for verification-code single-use (P0).

These do NOT use the in-memory StaticPool (which serialises on one connection).
Instead they spin up a file-backed SQLite database and give each thread its own
engine/session, so writes genuinely contend. We then fire N verify requests at
the same valid code simultaneously through a ``threading.Barrier`` and assert
that exactly ONE wins per round — no double-spend, no 500s.

Run standalone too:

    python tests/test_verify_concurrency.py
"""

from __future__ import annotations

import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.config import Settings
from app.db import Base, build_engine
from app.deps import configure_state
from app.mail import reset_captured_mails
from app.main import create_app
from app.models import DeviceSession, EmailChallenge
from app.ratelimit import reset_limiter
from app.services.auth import AuthService, CodeVerifyError
from app.security import generate_email_code, hash_code
from app.utc_now import utcnow
from datetime import timedelta


def _file_settings(path: str, max_attempts: int = 5) -> Settings:
    import os

    os.environ["DATABASE_URL"] = f"sqlite:///{path}"
    os.environ["CREATE_TABLES_ON_STARTUP"] = "true"
    os.environ["MAIL_PROVIDER"] = "devtest"
    os.environ["SECRET_KEY"] = "concurrency-test-secret"
    os.environ["EMAIL_CODE_MAX_ATTEMPTS"] = str(max_attempts)
    return Settings()


def _make_service(settings: Settings) -> AuthService:
    from app.mail import build_mail_provider
    from app.ratelimit import get_limiter

    return AuthService(settings, build_mail_provider(settings), get_limiter())


def _seed_valid_challenge(db_path: str, email: str, max_attempts: int = 5) -> str:
    """Plant a fresh, delivered, unconsumed challenge and return the plaintext."""
    import os

    settings = _file_settings(db_path, max_attempts=max_attempts)
    engine, factory = build_engine(settings)
    code = generate_email_code(6)
    with factory() as db:
        ch = EmailChallenge(
            email=email,
            code_digest=hash_code(code, settings),
            expires_at=utcnow() + timedelta(seconds=600),
            attempts=0,
            consumed_at=None,
            delivered=True,
        )
        db.add(ch)
        db.commit()
    engine.dispose()
    return code


def _verify_once(db_path: str, email: str, code: str, installation_id: str, max_attempts: int = 5):
    """One verify attempt on its own engine/session. Returns (ok, status)."""
    settings = _file_settings(db_path, max_attempts=max_attempts)
    engine, factory = build_engine(settings)
    svc = _make_service(settings)
    try:
        with factory() as db:
            device, session, token, is_new = svc.verify_code(
                db, email, code, installation_id, "dev", "android"
            )
            return True, 200
    except CodeVerifyError as exc:
        return False, exc.status_code
    except Exception:
        return False, 500
    finally:
        engine.dispose()


def _count_sessions(db_path: str, email: str, max_attempts: int = 5) -> int:
    settings = _file_settings(db_path, max_attempts=max_attempts)
    engine, factory = build_engine(settings)
    try:
        with factory() as db:
            from app.models import User

            u = db.query(User).filter(User.email == email).one_or_none()
            if u is None:
                return 0
            return db.query(DeviceSession).filter(DeviceSession.user_id == u.id).count()
    finally:
        engine.dispose()


ROUNDS = 20
THREADS = 8


@pytest.mark.parametrize("round_idx", range(ROUNDS))
def test_concurrent_verify_single_winner_per_round(tmp_path, round_idx):
    """8 threads verify the SAME valid code at once; exactly 1 must win.

    Repeated 20 rounds. No round may produce a 500 or >1 device session.
    """
    db_path = str(tmp_path / f"concur_{round_idx}.db")
    # Build schema once per round (fresh DB).
    settings = _file_settings(db_path)
    engine, _ = build_engine(settings)
    Base.metadata.create_all(engine)
    engine.dispose()
    reset_limiter()

    email = f"race{round_idx}@example.com"
    code = _seed_valid_challenge(db_path, email)

    barrier = threading.Barrier(THREADS)
    results: list = []

    def worker(i):
        barrier.wait()  # release all threads simultaneously
        results.append(_verify_once(db_path, email, code, f"install-{i}"))

    with ThreadPoolExecutor(max_workers=THREADS) as ex:
        futures = [ex.submit(worker, i) for i in range(THREADS)]
        for f in futures:
            f.result()

    wins = sum(1 for ok, _ in results if ok)
    statuses = [s for _, s in results]
    sessions = _count_sessions(db_path, email)

    # Exactly one winner; the rest are 400/429; never a 500.
    assert wins == 1, f"round {round_idx}: expected 1 winner, got {wins}"
    assert all(s in (400, 429, 200) for s in statuses), f"unexpected status: {statuses}"
    assert 200 in statuses and statuses.count(200) == 1
    assert sessions == 1, f"round {round_idx}: expected 1 session, got {sessions}"


def test_concurrent_wrong_codes_do_not_lose_attempts(tmp_path):
    """Concurrent WRONG guesses must each bump attempts (no lost update).

    8 threads submit 8 distinct wrong codes against one valid challenge; the
    attempts counter must reach 8 (not less), and the correct code is NOT
    consumed. We raise the attempt cap above the thread count so the cap does
    not mask a lost update.
    """
    max_attempts = 50  # well above THREADS so the cap can't hide a lost update
    db_path = str(tmp_path / "wrong.db")
    settings = _file_settings(db_path, max_attempts=max_attempts)
    engine, _ = build_engine(settings)
    Base.metadata.create_all(engine)
    engine.dispose()
    reset_limiter()

    email = "wrongrace@example.com"
    real_code = _seed_valid_challenge(db_path, email, max_attempts=max_attempts)

    barrier = threading.Barrier(THREADS)
    wrong_codes = [f"{i:06d}" for i in range(THREADS)]
    # Ensure none of the wrong codes accidentally equals the real code.
    assert real_code not in wrong_codes
    results: list = []

    def worker(i):
        barrier.wait()
        results.append(
            _verify_once(db_path, email, wrong_codes[i], f"install-{i}", max_attempts=max_attempts)
        )

    with ThreadPoolExecutor(max_workers=THREADS) as ex:
        futures = [ex.submit(worker, i) for i in range(THREADS)]
        for f in futures:
            f.result()

    # All wrong -> all fail.
    assert all(not ok for ok, _ in results)
    # The correct code was NOT consumed by any wrong attempt.
    settings2 = _file_settings(db_path, max_attempts=max_attempts)
    engine2, factory2 = build_engine(settings2)
    try:
        with factory2() as db:
            ch = (
                db.query(EmailChallenge)
                .filter(EmailChallenge.email == email)
                .order_by(EmailChallenge.created_at.desc())
                .first()
            )
            assert ch.consumed_at is None, "wrong code must not consume the challenge"
            # Every concurrent wrong guess must be counted (no lost update).
            # With the cap far above THREADS, the counter must equal THREADS.
            assert ch.attempts == THREADS, (
                f"lost update: attempts={ch.attempts} expected {THREADS}"
            )
    finally:
        engine2.dispose()


if __name__ == "__main__":
    # Standalone probe (no pytest): print a 20-round double-spend summary.
    import tempfile
    import os

    tmp = tempfile.mkdtemp()
    double_spend = 0
    fives = 0
    for r in range(ROUNDS):
        db_path = os.path.join(tmp, f"probe_{r}.db")
        s = _file_settings(db_path)
        eng, _ = build_engine(s)
        Base.metadata.create_all(eng)
        eng.dispose()
        reset_limiter()
        email = f"probe{r}@example.com"
        code = _seed_valid_challenge(db_path, email)
        barrier = threading.Barrier(THREADS)
        results = []

        def worker(i):
            barrier.wait()
            results.append(_verify_once(db_path, email, code, f"i-{i}"))

        with ThreadPoolExecutor(max_workers=THREADS) as ex:
            fs = [ex.submit(worker, i) for i in range(THREADS)]
            [f.result() for f in fs]
        wins = sum(1 for ok, _ in results if ok)
        statuses = [st for _, st in results]
        if wins != 1:
            double_spend += 1
        if 500 in statuses:
            fives += 1
        print(f"round {r}: wins={wins} statuses={sorted(set(statuses))}")
    print(f"\nSUMMARY rounds={ROUNDS} double_spend_rounds={double_spend} rounds_with_500={fives}")
    assert double_spend == 0 and fives == 0, "CONCURRENCY FAILURE"
    print("PROBE OK: 0 double-spend, 0 server errors")
