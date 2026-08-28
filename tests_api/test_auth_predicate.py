"""Which endpoints may be reached without a token.

The only module that builds the app through `app_builder.build()`, and it has to
be: the `verify_auth` before_request hook is installed there, and most handlers
carry no decorator of their own. `/auth/user` is the clearest case — nothing on
the function requires a JWT, so the hook IS the access control. A fixture that
registers blueprints bare (like `api_client`) cannot see any of this, which is
why nothing covered it before.

The defect being pinned: the hook decided by matching STRINGS against
`request.path`, and the suffix list came from walking the client directory at
request time. Any path ending in an extension that happened to be on disk
skipped `verify_jwt_in_request()` entirely.

⚠️ Two different outcomes are correct here, and conflating them is how the first
version of this file got itself wrong:

* A path that still matches an API route must answer **401** — `/getall/albums.js`
  matches `/getall/<itemtype>` with `itemtype="albums.js"`, so the handler really
  did run unauthenticated. That is the concrete hole.
* A path that no longer matches any API route must answer **404**, because it
  falls through to the static catch-all. `/auth/user.png` is not a route at all;
  under the old predicate it merely skipped the JWT check on its way to that same
  404. Asserting 401 there would be asserting the wrong thing.

⚠️ Exact status codes throughout. flask_openapi3 validates the request model
before the view runs, so a malformed parameter answers 422 without the handler
executing; a test written as "not 200" would pass against a wide-open server.
"""

import pytest


@pytest.fixture(scope="module")
def app_client():
    """
    The real app, hook and all.

    An `index.html` is planted in the client directory first: `tests_api`
    redirects the config root to a temp dir, so the static folder is empty and
    `GET /` would 404 for reasons that have nothing to do with authentication.
    """
    from aivinnet.app_builder import build
    from aivinnet.settings import Paths

    client_dir = Paths().client_path
    client_dir.mkdir(parents=True, exist_ok=True)
    (client_dir / "index.html").write_text("<!doctype html><title>test</title>")

    app = build()
    app.config["TESTING"] = True

    return app.test_client()


# Real API routes. Every one of these must demand a token.
PROTECTED = [
    "/getall/albums?start=0&limit=1",
    # THE regression: `/getall/<itemtype>` still matches with the suffix glued on,
    # so the old predicate let the handler run without any token at all.
    "/getall/albums.js",
    "/auth/user",
    "/notsettings",
    "/playlists",
    "/file/aaaa/legacy",
    # Cover art and — the part that matters — every user's profile picture.
    "/img/thumbnail/small/anything.webp",
    "/img/user/anything.webp",
    # The full API map, previously readable by anyone who could reach the port.
    "/docs/openapi.json",
]


@pytest.mark.parametrize("path", PROTECTED)
def test_a_token_is_required(app_client, path):
    assert app_client.get(path).status_code == 401


# Suffixed paths that stop matching their API route. They reach the static
# catch-all instead, which is public by design and only serves files.
NEVER_REACHES_THE_API = [
    "/auth/user.png",
    "/notsettings.css",
    "/playlists.txt",
    "/file/aaaa",
    "/file/aaaa.js",
]


@pytest.mark.parametrize("path", NEVER_REACHES_THE_API)
def test_a_suffix_cannot_smuggle_a_request_into_a_handler(app_client, path):
    assert app_client.get(path).status_code == 404


def test_the_suffix_no_longer_decides_whether_auth_happens(app_client):
    """
    The defect in one assertion: the same route, one appended extension, and the
    answer used to differ because the JWT check was skipped for one of them.
    """
    plain = app_client.get("/getall/albums?start=0&limit=1").status_code
    suffixed = app_client.get("/getall/albums.js").status_code

    assert plain == suffixed == 401


class TestStillPublic:
    def test_the_client_itself_loads(self, app_client):
        """Without this the login screen can never render."""
        assert app_client.get("/").status_code == 200

    @pytest.mark.parametrize("path", ["/auth/login", "/auth/logout", "/auth/users", "/auth/pair"])
    def test_the_login_screens_own_routes_are_reachable(self, app_client, path):
        """
        Reachable, not necessarily happy: a GET on a POST route is 405 and a pair
        redeem without a code is 400. What matters is that none of them is 401.
        """
        assert app_client.get(path).status_code != 401


def test_an_unrouted_path_is_404_not_401(app_client):
    """
    A token cannot make a route exist, and answering 401 to unrouted paths would
    turn the 404 into an oracle for which endpoints are real.
    """
    assert app_client.get("/no/such/endpoint/at/all").status_code == 404
