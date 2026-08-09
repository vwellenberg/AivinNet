"""Request-cycle cover for the two auth fixes in this round.

Both are about an answer that did not describe what happened: a delete that
matched nobody and still said "deleted", and a login that accepted guesses
without end.
"""

import pytest

BLUEPRINTS = ("aivinnet.api.auth",)


@pytest.fixture()
def as_admin(monkeypatch):
    """`admin_required` resolves `current_user` from its module globals at call
    time, so replacing the attribute is enough — no JWT context needed."""
    monkeypatch.setattr(
        "aivinnet.api.auth.current_user",
        {"id": 1, "username": "spec-user-1", "roles": ["admin"]},
    )


def test_deleting_a_missing_user_is_404_not_a_cheerful_200(api_client, as_admin):
    """The handler deletes BY USERNAME. A request naming someone who is not there
    removed nothing and answered 200 — which is how a verification account
    survived a cleanup that reported success."""
    api = api_client(*BLUEPRINTS)

    res = api.delete("/auth/profile/delete", json={"username": "nobody-by-that-name"})

    assert res.status_code == 404


def test_deleting_without_a_username_is_rejected(api_client, as_admin):
    """`{"id": 2}` used to sail through: the field defaulted to "", matched
    nobody, and the response read "User  deleted"."""
    api = api_client(*BLUEPRINTS)

    res = api.delete("/auth/profile/delete", json={"id": 2})

    # The request model refuses it before the handler runs.
    assert res.status_code == 422


def test_deleting_an_existing_user_still_works(api_client, as_admin):
    """The guard must not break the real path — spec-user-2 exists in the fixture."""
    from aivinnet.db.userdata import UserTable

    api = api_client(*BLUEPRINTS)
    try:
        res = api.delete("/auth/profile/delete", json={"username": "spec-user-2"})

        assert res.status_code == 200
        assert UserTable.get_by_username("spec-user-2") is None
    finally:
        # `user` is fixture scaffolding the conftest never wipes — put it back.
        from sqlalchemy import insert

        from aivinnet.db.engine import DbEngine

        if UserTable.get_by_username("spec-user-2") is None:
            with DbEngine.manager(commit=True) as session:
                session.execute(
                    insert(UserTable).values(id=2, username="spec-user-2", password="x", roles=[], extra={})
                )


def test_repeated_wrong_passwords_get_locked_out(api_client):
    """The endpoint answered 401 for ever, at whatever rate a client could ask."""
    from aivinnet.lib import loginguard

    loginguard.reset_all()
    api = api_client(*BLUEPRINTS)

    try:
        for _ in range(loginguard.MAX_ATTEMPTS):
            res = api.post("/auth/login", json={"username": "spec-user-1", "password": "wrong"})
            assert res.status_code in (401, 404), f"unexpected {res.status_code} before the lockout"

        locked = api.post("/auth/login", json={"username": "spec-user-1", "password": "wrong"})

        assert locked.status_code == 429
        # The wait belongs in the message — otherwise the user is left guessing.
        assert "seconds" in locked.get_json()["msg"]
    finally:
        loginguard.reset_all()


def test_the_lockout_does_not_spill_onto_other_accounts(api_client):
    """Counting by username (not by address) is what makes this safe behind a
    reverse proxy, where everyone shares one IP."""
    from aivinnet.lib import loginguard

    loginguard.reset_all()
    api = api_client(*BLUEPRINTS)

    try:
        for _ in range(loginguard.MAX_ATTEMPTS + 2):
            api.post("/auth/login", json={"username": "spec-user-1", "password": "wrong"})

        other = api.post("/auth/login", json={"username": "spec-user-2", "password": "wrong"})

        assert other.status_code != 429
    finally:
        loginguard.reset_all()
