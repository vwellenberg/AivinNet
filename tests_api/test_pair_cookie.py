"""Request-cycle tests for the optional cookie set on pair-code redeem.

`GET /auth/pair?code=...` redeems a single-use pair code and returns the token
JSON. The native mobile app parses that plain body. The QR deep-link browser
pairing flow additionally passes `setcookie=true` so the browser session is
logged in via the SAME cookie the login handler sets.

These guards run in the API lane because the cookie behaviour only surfaces
inside a real flask_openapi3 request with flask_jwt_extended initialised.
"""

import pytest
from flask_jwt_extended import JWTManager
from flask_openapi3 import OpenAPI

# Cookie name flask_jwt_extended uses for the access token (config default).
ACCESS_COOKIE = "access_token_cookie"

# Shaped exactly like swingmusic.api.auth.create_new_token()'s return value.
# The token strings are opaque here: with JWT_COOKIE_CSRF_PROTECT off,
# set_access_cookies never decodes them, it only copies them into the cookie.
SEED_TOKEN = {
    "msg": "Logged in as tester",
    "accesstoken": "fake.access.token",
    "refreshtoken": "fake.refresh.token",
    "maxage": 3600,
}
CODE = "ABC123"


@pytest.fixture()
def pair_app():
    """
    A minimal flask_openapi3 app that registers the REAL auth blueprint with
    flask_jwt_extended initialised the same way the production app does
    (app_builder.config_app): cookies+headers token location, CSRF off. This
    is what makes set_access_cookies() work inside the pair route.
    """
    from swingmusic.api.auth import api as auth_bp

    app = OpenAPI(__name__)
    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret"
    app.config["JWT_TOKEN_LOCATION"] = ["cookies", "headers"]
    app.config["JWT_COOKIE_CSRF_PROTECT"] = False
    app.config["JWT_SESSION_COOKIE"] = False
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = SEED_TOKEN["maxage"]

    JWTManager(app)
    app.register_api(auth_bp)

    return app.test_client()


@pytest.fixture()
def seed(monkeypatch):
    """Seed the module-global single-use pair-code store for one test."""

    def _seed():
        from swingmusic.api import auth as auth_module

        monkeypatch.setattr(auth_module, "pair_token", {CODE: dict(SEED_TOKEN)})

    return _seed


def _access_cookie_headers(res):
    return [h for h in res.headers.get_all("Set-Cookie") if ACCESS_COOKIE in h]


def test_pair_with_setcookie_sets_access_cookie(pair_app, seed):
    seed()

    res = pair_app.get(f"/auth/pair?code={CODE}&setcookie=true")

    assert res.status_code == 200
    # Body still carries the token (the native app / client reads it).
    body = res.get_json()
    assert body["accesstoken"] == SEED_TOKEN["accesstoken"]
    # ...and the browser session is now logged in via the access cookie.
    assert _access_cookie_headers(res), "expected a Set-Cookie for the access token"


def test_pair_without_setcookie_sets_no_cookie(pair_app, seed):
    seed()

    res = pair_app.get(f"/auth/pair?code={CODE}")

    assert res.status_code == 200
    # Default path is byte-identical to today: plain JSON body, no auth cookie.
    body = res.get_json()
    assert body["accesstoken"] == SEED_TOKEN["accesstoken"]
    assert not _access_cookie_headers(res), "default path must not set an auth cookie"


def test_pair_invalid_code_is_rejected(pair_app, seed):
    seed()

    res = pair_app.get("/auth/pair?code=NOPE&setcookie=true")

    assert res.status_code == 400
