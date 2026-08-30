"""A session has to be endable.

Tokens live 30 days and renew themselves while they are used, so before this
there was no way to end one. Logging out deleted the browser's cookie and left
the token valid; changing a password left every token minted under the old one
working. A token that leaked once was good indefinitely.

`user.token_version` is written into the token and compared against the database
on every request, so bumping the row invalidates every token carrying an older
number — without the server keeping session state of its own.
"""

import pytest


@pytest.fixture()
def users(api_client):
    """Two accounts, and a handle acting as the first."""
    from aivinnet.db.userdata import UserTable

    handle = api_client("aivinnet.api.auth")
    handle.userid = 1

    return handle, UserTable


# ⚠️ Every assertion here is RELATIVE to the value already in the row. conftest
# deliberately never wipes the `user` table — it is the foreign-key scaffolding
# every other table hangs off — so a bump in one test is still there in the next.
# Asserting `== 1` passes alone and fails in the suite, which is the worst kind
# of test.
class TestTheColumn:
    def test_a_fresh_column_defaults_to_zero(self, users):
        """The migration backfills existing rows rather than leaving them NULL."""
        _handle, table = users

        assert table.get_by_id(1).token_version >= 0

    def test_bumping_moves_only_that_account(self, users):
        _handle, table = users
        before_self = table.get_by_id(1).token_version
        before_other = table.get_by_id(2).token_version

        table.bump_token_version(1)

        assert table.get_by_id(1).token_version == before_self + 1
        assert table.get_by_id(2).token_version == before_other

    def test_bumps_accumulate(self, users):
        """Two revocations in a row must not land on the same number."""
        _handle, table = users
        before = table.get_by_id(1).token_version

        table.bump_token_version(1)
        table.bump_token_version(1)

        assert table.get_by_id(1).token_version == before + 2

    def test_the_counter_never_leaves_the_server(self, users):
        """
        It is internal. `todict()` is what `/auth/user` and `/auth/users` return,
        and an extra field there would be noise at best.
        """
        _handle, table = users

        assert "token_version" not in table.get_by_id(1).todict()
        assert "password" not in table.get_by_id(1).todict()


class TestTheLookup:
    """
    The comparison itself, exercised through `user_lookup_callback` rather than a
    live request: building a real signed token needs the full app, and the
    decision being tested is entirely inside this callback.
    """

    @staticmethod
    def _callback(monkeypatch):
        from flask_openapi3 import OpenAPI

        import aivinnet.app_builder as app_builder

        class _StubConfig:
            serverId = "test-server-id"

        monkeypatch.setattr(app_builder, "UserConfig", _StubConfig)

        app = OpenAPI(__name__)
        captured = {}

        class _Recorder:
            def user_lookup_loader(self, fn):
                captured["fn"] = fn
                return fn

        monkeypatch.setattr(app_builder, "JWTManager", lambda _app: _Recorder())
        app_builder.config_jwt(app)

        return captured["fn"]

    def _identity(self, userid, version=None):
        sub = {"id": userid, "username": "x", "roles": [], "image": None, "extra": None}

        if version is not None:
            sub["token_version"] = version

        return {"sub": sub}

    def test_a_matching_version_is_accepted(self, users, monkeypatch):
        _handle, table = users
        callback = self._callback(monkeypatch)
        current = table.get_by_id(1).token_version

        assert callback(None, self._identity(1, current)) is not None

    def test_an_older_version_is_rejected(self, users, monkeypatch):
        """THE guard: this is what revocation means."""
        _handle, table = users
        callback = self._callback(monkeypatch)
        stale = table.get_by_id(1).token_version

        table.bump_token_version(1)

        assert callback(None, self._identity(1, stale)) is None

    def test_a_token_minted_after_the_bump_still_works(self, users, monkeypatch):
        _handle, table = users
        callback = self._callback(monkeypatch)

        table.bump_token_version(1)
        fresh = table.get_by_id(1).token_version

        assert callback(None, self._identity(1, fresh)) is not None

    def test_a_token_from_before_the_feature_keeps_working(self, users, monkeypatch):
        """
        ⚠️ Deliberate. Tokens minted before this existed carry no version claim,
        and adding revocation should not log the whole household out during an
        upgrade. From the next login onwards every token carries it.
        """
        callback = self._callback(monkeypatch)

        assert callback(None, self._identity(1)) is not None

    def test_a_deleted_user_is_still_rejected(self, users, monkeypatch):
        callback = self._callback(monkeypatch)

        assert callback(None, self._identity(9999, 0)) is None


class TestChangingYourOwnPassword:
    """
    Revoking on a password change must not revoke the person doing it.

    Their current token carries the old version, so one request later every
    guard in the app would reject it — indistinguishable, from the outside, from
    the app being broken. The handler mints a replacement in the same response.
    """

    @pytest.fixture()
    def as_self(self, monkeypatch):
        monkeypatch.setattr(
            "aivinnet.api.auth.current_user",
            {"id": 1, "username": "spec-user-1", "roles": ["user"]},
        )

    def test_the_caller_gets_a_replacement_both_ways(self, users, as_self):
        """
        Cookie AND body. The web client reads the cookie; the mobile app and
        scripts authenticate with a header and cannot see one, so a
        cookie-only answer would log exactly them out.
        """
        handle, table = users
        before = table.get_by_id(1).password

        try:
            res = handle.put("/auth/profile/update", json={"password": "a-new-one"})

            assert res.status_code == 200
            assert res.get_json()["accesstoken"], "header clients need the token in the body"
            assert any("access_token_cookie" in h for h in res.headers.get_all("Set-Cookie"))
        finally:
            table.update_one({"id": 1, "password": before})

    def test_the_sessions_are_revoked(self, users, as_self):
        handle, table = users
        before_pw = table.get_by_id(1).password
        before_version = table.get_by_id(1).token_version

        try:
            handle.put("/auth/profile/update", json={"password": "a-new-one"})

            assert table.get_by_id(1).token_version == before_version + 1
        finally:
            table.update_one({"id": 1, "password": before_pw})

    def test_a_change_without_a_password_revokes_nothing(self, users, as_self):
        """Renaming yourself is not a reason to log your other devices out."""
        handle, table = users
        before_version = table.get_by_id(1).token_version

        handle.put("/auth/profile/update", json={"email": "x@example.com"})

        assert table.get_by_id(1).token_version == before_version
