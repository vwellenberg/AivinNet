"""Request-cycle guards for the two release blockers in `app_builder`.

Both defects were configuration, and configuration is exactly what a mocked
unit test cannot check: the damage only appears in the HEADERS of a real
response. So these run in the API lane and assert on the wire format.

1. `CORS(..., supports_credentials=True)` made flask-cors echo the REQUESTING
   origin and add `Access-Control-Allow-Credentials: true`, so any website the
   owner visited could read cookie-authenticated responses.
2. The JWT cookie carried no `SameSite`, which left the browser default as the
   only thing standing between a foreign page and a state-changing request.
"""

import pytest
from flask_openapi3 import OpenAPI

from aivinnet.app_builder import config_app, config_jwt

ACCESS_COOKIE = "access_token_cookie"

SEED_TOKEN = {
    "msg": "Logged in as tester",
    "accesstoken": "fake.access.token",
    "refreshtoken": "fake.refresh.token",
    "maxage": 3600,
}
CODE = "ABC123"


@pytest.fixture()
def hardened_app(monkeypatch):
    """
    A real app configured by the REAL `config_app` / `config_jwt`.

    `prefer_ipv4` is stubbed out because it patches address resolution for the
    whole process; the subject under test is the CORS and cookie configuration,
    and leaking that side effect into the rest of the lane buys nothing.
    """
    import aivinnet.app_builder as app_builder

    monkeypatch.setattr(app_builder, "prefer_ipv4", lambda: None)

    class _StubConfig:
        serverId = "test-server-id"

    monkeypatch.setattr(app_builder, "UserConfig", _StubConfig)

    from aivinnet.api.auth import api as auth_bp

    app = OpenAPI(__name__)
    app.config["TESTING"] = True

    config_app(app)
    config_jwt(app)
    app.register_api(auth_bp)

    return app


@pytest.fixture()
def hardened_client(hardened_app):
    return hardened_app.test_client()


@pytest.fixture()
def seed(monkeypatch):
    """Seed the single-use pair-code store so one request emits an auth cookie."""

    def _seed():
        from aivinnet.api import auth as auth_module

        monkeypatch.setattr(auth_module, "pair_token", {CODE: dict(SEED_TOKEN)})

    return _seed


def _access_cookie(res):
    for header in res.headers.get_all("Set-Cookie"):
        if ACCESS_COOKIE in header:
            return header

    raise AssertionError("expected a Set-Cookie for the access token")


class TestCors:
    def test_a_foreign_origin_is_never_echoed_back(self, hardened_client):
        res = hardened_client.options(
            "/auth/user",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
        )

        allowed = res.headers.get("Access-Control-Allow-Origin")
        assert allowed != "https://evil.example", (
            "flask-cors echoes the requesting origin whenever credentials are supported; that is the whole defect"
        )

    def test_credentials_are_not_advertised(self, hardened_client):
        res = hardened_client.options(
            "/auth/user",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
        )

        # Without this header a browser refuses to attach the session cookie to a
        # cross-origin request, no matter what the origin header says.
        assert res.headers.get("Access-Control-Allow-Credentials") is None


class TestAuthCookie:
    def test_cookie_is_samesite_strict(self, hardened_client, seed):
        seed()

        res = hardened_client.get(f"/auth/pair?code={CODE}&setcookie=true")

        assert res.status_code == 200
        assert "SameSite=Strict" in _access_cookie(res)

    def test_cookie_stays_httponly(self, hardened_client, seed):
        seed()

        res = hardened_client.get(f"/auth/pair?code={CODE}&setcookie=true")

        assert "HttpOnly" in _access_cookie(res)

    def test_cookie_is_not_secure_yet(self, hardened_client, seed):
        # Deliberate, and asserted so nobody flips it without reading why: the
        # server is normally reached over plain http:// on the LAN, where a
        # Secure cookie is silently discarded by the browser while login still
        # answers 200 — an endless login loop that looks like a broken app.
        seed()

        res = hardened_client.get(f"/auth/pair?code={CODE}&setcookie=true")

        assert "Secure" not in _access_cookie(res)
