"""The privilege boundary between an ordinary user and an admin.

This lane is the only place the boundary can be checked honestly. `admin_required()`
is applied at import time and reads `current_user` out of the `aivinnet.api.auth`
module namespace, so only a real request through a really-registered blueprint
proves that a given route carries the guard.

Two things are under test, and the first one is why the file exists:

1. **`GET /notsettings` must not hand out `serverId`.** That value is the JWT
   signing key *and* the password salt (`app_builder.config_app`,
   `utils.auth.hash_password`). While it was in the response, every logged-in
   account could read it and mint itself an admin token — which made every
   `@admin_required()` in the app decorative. Verified live against the running
   server before the fix: HTTP 200, `serverId` present and equal to the config
   secret.

2. **The library-mutating routes reject a non-admin.** Cover writes, the
   MusicBrainz fetches, the tag editor and the scan trigger all change files or
   state that every user of the server shares.

⚠️ Send a VALID body. flask_openapi3 validates the request model *before* the
view function runs, so the guard never sees a malformed request: an incomplete
body answers 422 and the test would pass without the decorator being there at
all. Each entry below therefore carries a body its model accepts.
"""

import io

import pytest

# Hashes are the real width (`Defaults.HASH_LENGTH`): `AlbumHashSchema` pins
# albumhash to exactly that many characters, and a short one answers 422 from the
# request model — the very false green the docstring warns about. It cost a red
# run here, which is the cheapest possible place to pay for it.
ALBUM_HASH = "bfe300e966a1b2c3"
TRACK_HASH = "a1b2c3d4e5f60718"

# (method, path, json body) — the body only has to satisfy the request model;
# no handler ever runs, because a non-admin is turned away first.
GUARDED_ROUTES = [
    ("GET", "/notsettings/trigger-scan", None),
    ("POST", "/coverart/album", {"albumhash": ALBUM_HASH, "url": "http://example.invalid/c.jpg"}),
    ("POST", "/coverart/album/remove", {"albumhash": ALBUM_HASH}),
    ("POST", "/coverart/album/undo", {"albumhash": ALBUM_HASH}),
    ("POST", "/coverart/album/embed", {"albumhash": ALBUM_HASH}),
    ("POST", "/musicbrainz/fetch-cover", {"albumhash": ALBUM_HASH}),
    ("POST", "/musicbrainz/fetch-missing-covers", {"limit": 1}),
    ("PUT", f"/track/{TRACK_HASH}/tags", {"title": "renamed"}),
    # ⚠️ `/folder/show-in-files` is NOT in this table: it answers 403 on its own
    # when the path is outside the root dirs, and the fixture has none — so every
    # entry here would pass without the decorator. It gets its own test below,
    # where the path check is stubbed out and the 403 can only come from the guard.
]

BLUEPRINTS = (
    "aivinnet.api.settings",
    "aivinnet.api.coverart",
    "aivinnet.api.musicbrainz",
    "aivinnet.api.track",
    "aivinnet.api.auth",
    "aivinnet.api.folder",
)


@pytest.fixture()
def as_role(monkeypatch):
    """Set the acting user's roles for `admin_required()`.

    The decorator resolves `current_user` from its module globals at call time,
    so replacing the module attribute is enough — no JWT context needed.
    """

    def _set(*roles: str):
        monkeypatch.setattr("aivinnet.api.auth.current_user", {"roles": list(roles)})

    return _set


@pytest.mark.parametrize("method,path,body", GUARDED_ROUTES)
def test_non_admin_is_refused(api_client, as_role, method, path, body):
    as_role("user")
    api = api_client(*BLUEPRINTS)

    res = api.client.open(path, method=method, json=body)

    # 403 specifically — a 422 would mean the request model rejected us first and
    # the guard was never reached, which is exactly the false green this file guards against.
    assert res.status_code == 403, f"{method} {path} answered {res.status_code}, not 403"


def test_admin_passes_the_guard(api_client, as_role, monkeypatch):
    """The mirror image: the decorator must let an admin through.

    Without this, guarding every route with a broken decorator would look just as
    green as guarding it correctly. `index_everything` is stubbed because the real
    one walks the library.
    """
    import aivinnet.api.settings as settings_api

    calls = []
    monkeypatch.setattr(settings_api, "index_everything", lambda *a, **k: calls.append(1))
    as_role("admin")
    api = api_client(*BLUEPRINTS)

    res = api.get("/notsettings/trigger-scan")

    assert res.status_code == 200
    assert calls == [1], "the admin request did not reach the handler"


def test_non_admin_scan_does_not_reach_the_indexer(api_client, as_role, monkeypatch):
    """403 *and* nothing happened.

    A scan is not a read: it walks the root dirs and can drop tracks from the
    library. Asserting only the status code would miss a guard that returns 403
    after doing the work.
    """
    import aivinnet.api.settings as settings_api

    calls = []
    monkeypatch.setattr(settings_api, "index_everything", lambda *a, **k: calls.append(1))
    as_role("user")
    api = api_client(*BLUEPRINTS)

    res = api.get("/notsettings/trigger-scan")

    assert res.status_code == 403
    assert calls == [], "the indexer ran despite the request being refused"


def test_non_admin_cannot_spawn_a_file_manager(api_client, as_role, monkeypatch, tmp_path):
    """403 *and* no process started.

    This route runs a program on the SERVER, which is meaningless for a remote
    listener. The path check is stubbed to succeed on purpose: it returns 403 by
    itself for anything outside the root dirs, so without the stub this test
    would pass with the guard removed — the false green the module docstring
    warns about, in its other shape.
    """
    import aivinnet.api.folder as folder_api

    spawned = []
    real_dir = tmp_path
    monkeypatch.setattr(folder_api, "is_path_within_root_dirs", lambda *a, **k: True)
    monkeypatch.setattr(folder_api, "show_in_file_manager", lambda *a, **k: spawned.append(1))
    as_role("user")
    api = api_client(*BLUEPRINTS)

    res = api.get(f"/folder/show-in-files?path={real_dir}")

    assert res.status_code == 403
    assert spawned == [], "the server opened a file manager for a non-admin"


def test_admin_may_still_spawn_a_file_manager(api_client, as_role, monkeypatch, tmp_path):
    """The mirror image — the guard must not break the admin's own use of it."""
    import aivinnet.api.folder as folder_api

    spawned = []
    real_dir = tmp_path
    monkeypatch.setattr(folder_api, "is_path_within_root_dirs", lambda *a, **k: True)
    monkeypatch.setattr(folder_api, "show_in_file_manager", lambda *a, **k: spawned.append(1))
    as_role("admin")
    api = api_client(*BLUEPRINTS)

    res = api.get(f"/folder/show-in-files?path={real_dir}")

    assert res.status_code == 200
    assert spawned == [1]


def test_non_admin_cover_upload_is_refused(api_client, as_role):
    """The multipart sibling of the routes above — same guard, different body type."""
    as_role("user")
    api = api_client(*BLUEPRINTS)

    res = api.post(
        "/coverart/album/upload",
        data={"albumhash": ALBUM_HASH, "image": (io.BytesIO(b"not-a-real-image"), "cover.png")},
        content_type="multipart/form-data",
    )

    assert res.status_code == 403


def test_settings_response_never_carries_the_server_secret(api_client, as_role, monkeypatch):
    """The leak itself: no key of the settings payload may hold `serverId`.

    Checked against the raw response text rather than `body["serverId"]`, so the
    test still fails if the value reappears under a different key — the danger is
    the secret leaving the server, not the name it travels under.
    """
    import aivinnet.api.settings as settings_api
    from aivinnet.config import UserConfig

    sentinel = "sentinel-server-secret-8c1f"
    monkeypatch.setattr(UserConfig(), "serverId", sentinel)
    monkeypatch.setattr(settings_api, "get_current_userid", lambda: 1)
    monkeypatch.setattr(settings_api.Metadata, "version", "9.9.9")

    as_role("admin")  # even the highest privilege must not receive it
    api = api_client(*BLUEPRINTS)

    res = api.get("/notsettings")

    assert res.status_code == 200
    assert "serverId" not in res.get_json()
    assert sentinel not in res.get_data(as_text=True)


def test_a_user_cannot_rewrite_another_users_password(api_client, as_role, monkeypatch):
    """The escalation that made every other guard in this file pointless.

    `PUT /auth/profile/update` takes the target `id` from the request body. The
    roles branch is skipped whenever `roles` is absent (it defaults to None), and
    the self-scoping only fires for an *empty* id — so any logged-in account could
    send `{"id": <admin>, "password": "..."}`, take the admin's login and walk
    straight through every `@admin_required()` the rest of this file checks.
    """
    from aivinnet.db.userdata import UserTable

    # spec-user-1 is the admin here; spec-user-2 is the ordinary account attacking it.
    monkeypatch.setattr(
        "aivinnet.api.auth.current_user",
        {"id": 2, "username": "spec-user-2", "roles": ["user"]},
    )
    api = api_client(*BLUEPRINTS)
    before = UserTable.get_by_id(1).password

    res = api.put("/auth/profile/update", json={"id": 1, "password": "attacker-chosen"})

    assert res.status_code == 403
    assert UserTable.get_by_id(1).password == before, "another user's password was rewritten"


def test_a_user_can_still_update_their_own_profile(api_client, as_role, monkeypatch):
    """The guard must not lock people out of their own profile screen.

    ⚠️ `conftest` deliberately never wipes the `user` table (it is fixture
    scaffolding for the foreign keys), so this write outlives the test — restore it.
    """
    from aivinnet.db.userdata import UserTable

    monkeypatch.setattr(
        "aivinnet.api.auth.current_user",
        {"id": 2, "username": "spec-user-2", "roles": ["user"]},
    )
    api = api_client(*BLUEPRINTS)
    before = UserTable.get_by_id(2).password

    try:
        res = api.put("/auth/profile/update", json={"id": 2, "password": "my-new-password"})

        assert res.status_code == 200
        assert UserTable.get_by_id(2).password != before
    finally:
        UserTable.update_one({"id": 2, "password": before})


def test_an_unknown_key_cannot_shadow_a_config_method(api_client, as_role):
    """`setattr` takes any name, including one that is already a method.

    Writing `write_to_file` replaces the config object's own method on the
    process-wide singleton; every later config write in the running server then
    raises TypeError until someone restarts it. A deny-list of secrets does not
    catch this — only an allow-list of declared fields does.
    """
    from aivinnet.config import UserConfig

    as_role("admin")
    api = api_client(*BLUEPRINTS)

    res = api.put("/notsettings/update", json={"key": "write_to_file", "value": 1})

    assert res.status_code == 400
    assert callable(UserConfig().write_to_file), "the config method was overwritten"


def test_the_secret_cannot_be_written_either(api_client, as_role):
    """Closing the read path is only half of it.

    `PUT /notsettings/update` sets any attribute the caller names. Writing
    `serverId` invalidates every password hash (it is the salt) and every issued
    token in one request, and the old value is gone — there is no undo. Admin-only
    is not enough protection for something with no recovery path.
    """
    from aivinnet.config import UserConfig

    before = UserConfig().serverId
    as_role("admin")
    api = api_client(*BLUEPRINTS)

    res = api.put("/notsettings/update", json={"key": "serverId", "value": "attacker-chosen"})

    assert res.status_code == 400
    assert UserConfig().serverId == before, "the server identity was overwritten"


def test_ordinary_settings_still_write(api_client, as_role):
    """The mirror image: the deny list must not turn into a wall.

    `usersOnLogin` is what the accounts screen toggles — if this breaks, the
    settings UI silently stops saving.

    ⚠️ `UserConfig` is a process-wide Singleton and `api_client` only wipes DB
    tables, so a real write here outlives the test. This file sorts first in
    `tests_api/`, which would hand every later test a changed config — restore it.
    """
    from aivinnet.config import UserConfig

    as_role("admin")
    api = api_client(*BLUEPRINTS)
    before = UserConfig().usersOnLogin

    try:
        res = api.put("/notsettings/update", json={"key": "usersOnLogin", "value": not before})

        assert res.status_code == 200
        assert UserConfig().usersOnLogin is (not before)
    finally:
        UserConfig().usersOnLogin = before
