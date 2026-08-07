"""Fixtures for the API-layer test lane.

Unlike tests/ (fast lane, heavy deps mocked), this lane runs with the FULL
dependency stack (`uv sync`) and exercises the real flask_openapi3 request
cycle. It exists because the request-model layer broke twice in one day
(vwellenberg/AivinNet#36 -> #167/#39) in ways no mocked unit test could see:
required-vs-optional multipart fields and flask_openapi3's file mapping only
misbehave inside a real request.

The app config dir is pointed at a temp directory BEFORE anything from
aivinnet is imported, so no test ever touches a real library.
"""

import importlib
import os
import sys
import tempfile
from pathlib import Path

import pytest

# Must happen before any aivinnet import resolves Paths.
_config_root = tempfile.mkdtemp(prefix="aivinnet-apitests-")
os.environ["XDG_CONFIG_HOME"] = _config_root
os.environ.setdefault("SWINGMUSIC_CLIENT_DIR", _config_root)

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

# The two owners every foreign key in the user tables points at. They are
# created once per test and kept across the between-tests wipe, because
# PRAGMA foreign_keys=ON refuses an insert whose owner does not exist yet.
SPEC_USERS = ((1, "spec-user-1"), (2, "spec-user-2"))


def _register_all_models():
    """
    Import every module that declares a table BEFORE `create_all_tables()`.

    `Base.metadata` only knows the models that have actually been imported, and
    `create_all` writes nothing for the rest. A fixture that imports just what it
    needs therefore creates a partial database, and whether a table exists ends
    up depending on which OTHER test module pytest collected first — the whole
    suite is green, the single module is `no such table: user`.
    """
    importlib.import_module("aivinnet.db.libdata")
    importlib.import_module("aivinnet.db.metadata")
    importlib.import_module("aivinnet.db.userdata")


def _create_spec_users():
    from sqlalchemy import insert, select

    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import UserTable

    with DbEngine.manager(commit=True) as session:
        for uid, name in SPEC_USERS:
            exists = session.execute(select(UserTable.id).where(UserTable.id == uid)).first()
            if not exists:
                session.execute(insert(UserTable).values(id=uid, username=name, password="x", roles=[], extra={}))


@pytest.fixture()
def playlist_db():
    """
    A real SQLite database with the real PlaylistTable, wiped between tests.

    The playlist write paths are the least covered and the most dangerous code in
    the app: two data-loss bugs shipped from them (AivinNet#51), and the ~760
    lines of tests that exist all cover the *pure list helpers* — nothing
    exercised PlaylistTable against an actual database. So the SQL is where the
    coverage was zero and the incidents came from.

    The module-level XDG_CONFIG_HOME above already points the app at a temp
    directory, so DbEngine opens a throwaway file and no test can reach a real
    library. `get_current_userid` is patched rather than faking a JWT context —
    the subject under test is the table, not auth — but it stays a *parameter*
    of the fixture so multi-user isolation can be tested too.
    """
    from unittest.mock import patch

    from sqlalchemy import delete

    from aivinnet.db import create_all_tables
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import PlaylistTable

    create_all_tables()

    # `playlist.userid` is a foreign key to `user.id` and the engine runs with
    # PRAGMA foreign_keys=ON, so a playlist cannot be inserted before its owner
    # exists. Without this the module passed only when some OTHER test module
    # happened to create a user first — green for the wrong reason, and red the
    # moment it ran alone.
    _create_spec_users()

    with patch("aivinnet.db.userdata.get_current_userid", return_value=1) as userid:
        yield PlaylistTable, userid

    # Leave no rows behind for the next test.
    with DbEngine.manager(commit=True) as session:
        session.execute(delete(PlaylistTable))


class ApiHandle:
    """What `api_client` hands a test: a Flask test client plus the knobs the
    handlers read from outside the request (currently only the acting user)."""

    def __init__(self, client, app, userid_mock):
        self.client = client
        self.app = app
        self._userid_mock = userid_mock

    @property
    def userid(self) -> int:
        return self._userid_mock.return_value

    @userid.setter
    def userid(self, value: int):
        self._userid_mock.return_value = value

    def get(self, *args, **kwargs):
        return self.client.get(*args, **kwargs)

    def post(self, *args, **kwargs):
        return self.client.post(*args, **kwargs)

    def put(self, *args, **kwargs):
        return self.client.put(*args, **kwargs)

    def delete(self, *args, **kwargs):
        return self.client.delete(*args, **kwargs)


@pytest.fixture()
def api_client():
    """
    Build a real flask_openapi3 app around REAL API blueprints, talking to a
    real (throwaway) SQLite database.

    Use it as a factory inside the test::

        def test_something(api_client):
            api = api_client("aivinnet.api.playlist")
            assert api.put("/playlists/1/reorder", json={...}).status_code == 200

    Why a full request cycle and not a direct handler call: the handler is only
    half the endpoint. Pydantic validation, flask_openapi3's body/path mapping
    and the status code an error tuple actually produces live in the framework,
    and each of those has already shipped a bug that a direct call could not see
    (AivinNet#36 -> #167/#39). Why a real database and not mocks: mocking the
    table hid a 500 on every repeat device registration for a whole release
    (AivinNet#43) — see `.claude/rules/tests.md`.

    Deliberately NOT included:

    - **No auth hooks.** `app_builder.build()` installs the JWT before-request
      guard; here the blueprints are registered bare, so tests exercise handler
      behaviour instead of re-testing flask-jwt-extended. `get_current_userid`
      (as the DB layer imports it) is patched to user 1; `handle.userid = 2`
      switches actor mid-test for isolation checks. An endpoint behind
      `@admin_required()` still needs its own patch of
      `aivinnet.api.auth.current_user` — that decorator is applied at import
      time and cannot be undone by a fixture.
    - **No RAM stores.** The library stores stay empty on purpose, so a test that
      needs them patches the store attribute *on the API module under test*
      (`monkeypatch.setattr(playlist_api.TrackStore, ...)`). Filling them here
      would make every test depend on a global the app populates only at boot.

    Every table except `user` is wiped after each test, so state cannot leak
    between tests in either direction.
    """
    from unittest.mock import patch

    from flask_openapi3 import OpenAPI
    from sqlalchemy import inspect

    from aivinnet.db import Base, create_all_tables
    from aivinnet.db.engine import DbEngine

    _register_all_models()
    create_all_tables()
    _create_spec_users()

    userid_patch = patch("aivinnet.db.userdata.get_current_userid", return_value=1)
    userid_mock = userid_patch.start()

    def build_app(*blueprints: str, userid: int = 1) -> ApiHandle:
        """`blueprints` are module paths whose `api` attribute is the blueprint,
        e.g. "aivinnet.api.playlist"."""
        app = OpenAPI(__name__)
        app.config["TESTING"] = True

        with app.app_context():
            for module_path in blueprints:
                app.register_api(importlib.import_module(module_path).api)

        userid_mock.return_value = userid
        return ApiHandle(app.test_client(), app, userid_mock)

    try:
        yield build_app
    finally:
        userid_patch.stop()
        # Reverse dependency order so a child table goes before its parent.
        # `user` survives: it is fixture scaffolding, not test data. Only tables
        # that really exist are touched — a model imported after
        # `create_all_tables()` ran is in the metadata but not in the file.
        existing = set(inspect(DbEngine.engine).get_table_names())
        with DbEngine.manager(commit=True) as session:
            for table in reversed(Base.metadata.sorted_tables):
                if table.name != "user" and table.name in existing:
                    session.execute(table.delete())


@pytest.fixture()
def form_app():
    """
    A minimal flask_openapi3 app exposing endpoints built from the REAL
    request models of the playlist API. No auth hooks, no stores, no DB —
    the subject under test is the model <-> request mapping.
    """
    from flask_openapi3 import OpenAPI

    from aivinnet.api.playlist import PlaylistIDPath, UpdatePlaylistForm

    app = OpenAPI(__name__)

    @app.put("/playlists/<playlistid>/update")
    def update_stub(path: PlaylistIDPath, form: UpdatePlaylistForm):
        image = form.image
        return {
            "playlistid": str(path.playlistid),
            "name": form.name,
            "settings": form.settings,
            "has_file": bool(image),
            "filename": image.filename if image else None,
        }

    app.config["TESTING"] = True
    return app.test_client()
