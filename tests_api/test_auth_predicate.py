"""Which endpoints may be reached without a token.

This is the only module that builds the app through `app_builder.build()`, and
it has to be: the `verify_auth` before_request hook is installed there, and most
handlers carry no decorator of their own. `/auth/user` is the clearest case —
nothing on the function requires a JWT, so the hook is the entire access
control. A fixture that registers blueprints bare (like `api_client`) cannot see
any of this, which is why nothing covered it before.

The defect being pinned: the hook used to decide by matching STRINGS against
`request.path`, with the suffix list built by walking the client directory at
request time. Any path ending in an extension that happened to be on disk
skipped authentication entirely — `GET /file/x.js` reached the route untouched
while `GET /file/x` answered 401.

⚠️ Exact status codes throughout. flask_openapi3 validates the request model
before the view runs, so a malformed parameter answers 422 without the handler
executing; a test written as "not 200" would pass against a wide-open server.
"""

import pytest


@pytest.fixture(scope="module")
def app_client():
    """The real app, hook and all. Module-scoped: `build()` is not cheap."""
    from aivinnet.app_builder import build

    app = build()
    app.config["TESTING"] = True

    return app.test_client()


# Paths that must answer 401 without a token. The `.js`/`.webp` variants are the
# regression: same route, one extra suffix, and the old predicate waved them past.
PROTECTED = [
    "/getall/albums?start=0&limit=1",
    "/getall/albums.js",
    "/file/aaaa",
    "/file/aaaa.js",
    "/file/aaaa.webp",
    "/auth/user",
    "/auth/user.png",
    "/notsettings",
    "/notsettings.css",
    "/playlists",
    "/playlists.txt",
    "/img/thumbnail/small/anything.webp",
    "/img/user/anything.webp",
    "/docs/openapi.json",
]


@pytest.mark.parametrize("path", PROTECTED)
def test_a_token_is_required(app_client, path):
    assert app_client.get(path).status_code == 401


def test_the_suffix_trick_no_longer_changes_the_answer(app_client):
    """
    The defect in one assertion: the same route answered differently depending
    on a suffix the caller appended.
    """
    plain = app_client.get("/file/aaaa").status_code
    suffixed = app_client.get("/file/aaaa.js").status_code

    assert plain == suffixed == 401


class TestStillPublic:
    def test_the_client_itself_loads(self, app_client):
        """Without this the login screen can never render."""
        assert app_client.get("/").status_code == 200

    @pytest.mark.parametrize("path", ["/auth/login", "/auth/logout", "/auth/users", "/auth/pair"])
    def test_the_login_screens_own_routes_are_reachable(self, app_client, path):
        """
        Reachable, not necessarily happy: a GET on a POST route is 405 and a
        pair redeem without a code is 400. What matters is that none is 401.
        """
        assert app_client.get(path).status_code != 401


def test_an_unrouted_path_is_404_not_401(app_client):
    """
    A token cannot make a route exist, and answering 401 to unrouted paths turns
    the 404 into an oracle for which endpoints are real.
    """
    assert app_client.get("/no/such/endpoint/at/all").status_code == 404
