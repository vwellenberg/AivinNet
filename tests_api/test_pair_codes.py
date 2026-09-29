"""Pair codes: single-use, short-lived, one per account, and not a free oracle.

There used to be one global slot with no expiry: a code shown and never scanned
stayed redeemable for ever, to unlimited guesses, and any other account asking
for a code silently replaced it.
"""

import pytest
from flask_jwt_extended import JWTManager
from flask_openapi3 import OpenAPI

import aivinnet.api.auth as auth

SEED_TOKEN = {"msg": "ok", "accesstoken": "fake.access.token", "refreshtoken": "fake.refresh", "maxage": 3600}


@pytest.fixture()
def pair_app():
    """The REAL auth blueprint in a minimal app, JWT set up like production."""
    app = OpenAPI(__name__)
    app.config.update(
        TESTING=True,
        JWT_SECRET_KEY="test-secret",
        JWT_TOKEN_LOCATION=["cookies", "headers"],
        JWT_COOKIE_CSRF_PROTECT=False,
    )
    JWTManager(app)
    app.register_api(auth.api)
    return app.test_client()


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    monkeypatch.setattr(auth, "pair_codes", {})
    monkeypatch.setattr(auth, "_pair_failures", [])
    monkeypatch.setattr(auth, "create_new_token", lambda identity: {**SEED_TOKEN, "for": identity["id"]})


def _code_for(monkeypatch, userid):
    monkeypatch.setattr(auth, "get_jwt_identity", lambda: {"id": userid, "username": f"u{userid}"})
    return auth.get_pair()["code"]


def test_each_account_keeps_its_own_code(monkeypatch, pair_app):
    first = _code_for(monkeypatch, 1)
    second = _code_for(monkeypatch, 2)

    assert pair_app.get(f"/auth/pair?code={first}").get_json()["for"] == 1
    assert pair_app.get(f"/auth/pair?code={second}").get_json()["for"] == 2


def test_a_new_code_replaces_only_the_same_accounts_old_one(monkeypatch, pair_app):
    old = _code_for(monkeypatch, 1)
    _code_for(monkeypatch, 1)

    assert pair_app.get(f"/auth/pair?code={old}").status_code == 400


def test_a_code_works_once(monkeypatch, pair_app):
    code = _code_for(monkeypatch, 1)

    assert pair_app.get(f"/auth/pair?code={code}").status_code == 200
    assert pair_app.get(f"/auth/pair?code={code}").status_code == 400


def test_an_unused_code_expires(monkeypatch, pair_app):
    code = _code_for(monkeypatch, 1)
    later = auth.time.monotonic() + auth.PAIR_CODE_TTL_S + 1
    monkeypatch.setattr(auth.time, "monotonic", lambda: later)

    assert pair_app.get(f"/auth/pair?code={code}").status_code == 400


def test_guessing_is_throttled(monkeypatch, pair_app):
    code = _code_for(monkeypatch, 1)

    for _ in range(auth.PAIR_MAX_FAILS_PER_MINUTE):
        assert pair_app.get("/auth/pair?code=NOPE00").status_code == 400

    # Even the right code waits now: the limit is on the endpoint, not per guess.
    assert pair_app.get(f"/auth/pair?code={code}").status_code == 429


def test_codes_are_random_not_a_token_tail(monkeypatch):
    codes = {_code_for(monkeypatch, n) for n in range(1, 30)}

    assert len(codes) == 29
    assert all(len(c) == auth.PAIR_CODE_LENGTH and c.isalnum() for c in codes)
