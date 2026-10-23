"""
`GET`/`PUT /nothome/layout` and what Home does with it (#532): rows hidden
and reordered per user.

Real request cycle and real `UserTable.extra` (where the layout is stored), on
the scenario of `test_home_rows_api` (two albums, five rows with something in
them). The `user` rows survive between tests, so the fixture clears what it
wrote: a layout left behind would hide rows from every later Home test.
"""

import pendulum
import pytest
from test_home_rows_api import ALBUM_A, ALBUM_B, DAY, _trackhash, home, rows, run_routines, scrobble  # noqa: F401

from aivinnet.lib.home.layout import COLLECTIONS, DEFAULT_ORDER

FILLED = ["continue_listening", "recently_played", "rediscover", "on_this_day", "recently_added"]


def _reset_users():
    from sqlalchemy import update

    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import UserTable

    with DbEngine.manager(commit=True) as session:
        session.execute(update(UserTable).values(extra={}))


@pytest.fixture()
def layout_api(home, monkeypatch):  # noqa: F811 - the imported fixture
    """The Home tests' library and rows, the layout endpoints, no saved layout."""
    import aivinnet.api.home as home_api
    from aivinnet.store.homepage import HomepageStore

    monkeypatch.setattr(home_api, "get_current_userid", lambda: home.userid)
    monkeypatch.setattr(HomepageStore, "layouts", {})
    _reset_users()
    yield home
    _reset_users()


def fill_rows():
    """Plays that give Home the five rows of FILLED."""
    from aivinnet.store.homepage import HomepageStore

    now = int(pendulum.now().timestamp())
    year_ago = int(pendulum.now().subtract(years=1).start_of("day").add(hours=12).timestamp())
    for i in range(6):
        scrobble(_trackhash(ALBUM_A, 1 + i % 5), now - 200 * DAY + i, f"al:{ALBUM_A}")
    scrobble(_trackhash(ALBUM_A, 2), year_ago, f"al:{ALBUM_A}")
    scrobble(_trackhash(ALBUM_B, 4), now - 60, f"al:{ALBUM_B}")
    HomepageStore.entries["recently_added"].items[0] = [{"type": "album", "hash": ALBUM_B, "timestamp": now}]
    run_routines()


def full(*front):
    """A whole order, as the client sends it: `front` first, the rest as by default."""
    return list(front) + [k for k in DEFAULT_ORDER if k not in front]


def layout(api):
    res = api.get("/nothome/layout")
    assert res.status_code == 200, res.text
    return res.get_json()["rows"]


def save(api, order=(), hidden=()):
    res = api.put("/nothome/layout", json={"order": list(order), "hidden": list(hidden)})
    assert res.status_code == 200, res.text
    return res.get_json()["rows"]


def test_without_a_saved_layout_every_row_is_shown_in_homes_order(layout_api):
    listed = layout(layout_api)

    assert [r["key"] for r in listed] == list(DEFAULT_ORDER)
    assert all(r["visible"] for r in listed)
    names = {r["key"]: r for r in listed}
    assert names["recently_played"]["title"] == "Recently played"
    assert names[COLLECTIONS]["title"] == "Collections"
    # Drawn above every row by the client, wherever it stands: shown or not, never moved.
    assert [r["key"] for r in listed if r["pinned"]] == ["continue_listening"]


def test_a_hidden_row_is_not_served(layout_api):
    fill_rows()

    save(layout_api, hidden=["recently_played", "on_this_day"])

    assert rows(layout_api)[1] == ["continue_listening", "rediscover", "recently_added"]


def test_a_hidden_row_is_not_even_assembled(layout_api, monkeypatch):
    from aivinnet.store.homepage import HomepageStore

    def refuse(*_):
        raise AssertionError("a hidden row was assembled")

    fill_rows()
    monkeypatch.setattr(HomepageStore.entries["rediscover"], "get_items", refuse)
    monkeypatch.setattr(HomepageStore, "_collections", classmethod(lambda cls: refuse()))

    save(layout_api, hidden=["rediscover", COLLECTIONS])

    assert "rediscover" not in rows(layout_api)[1]


def test_home_follows_the_saved_order(layout_api):
    fill_rows()

    save(layout_api, order=full("recently_added", "on_this_day", "rediscover", "recently_played"))

    assert rows(layout_api)[1] == [
        "continue_listening",
        "recently_added",
        "on_this_day",
        "rediscover",
        "recently_played",
    ]


def test_the_collections_move_as_one_block(layout_api, monkeypatch):
    from aivinnet.store.homepage import HomepageStore

    pages = [{"page-1": {"title": "Page one", "items": [{"type": "album"}]}}]
    monkeypatch.setattr(HomepageStore, "_collections", classmethod(lambda cls: pages))
    fill_rows()

    save(layout_api, order=full(COLLECTIONS))

    assert rows(layout_api)[1] == ["continue_listening", "page-1", *FILLED[1:]]


def test_what_is_stored_is_the_layout_home_can_use(layout_api):
    listed = save(layout_api, order=["recently_added", "no-such-row", "recently_added"], hidden=["bogus"])

    keys = [r["key"] for r in listed]
    assert keys[0] == "continue_listening"
    assert sorted(keys) == sorted(DEFAULT_ORDER)  # every row once, the stray key gone
    assert all(r["visible"] for r in listed)


def test_an_empty_layout_is_the_default(layout_api):
    save(layout_api, order=["recently_added"], hidden=["rediscover"])

    listed = save(layout_api)

    assert [r["key"] for r in listed] == list(DEFAULT_ORDER)
    assert all(r["visible"] for r in listed)


def test_the_layout_is_kept_across_a_restart_and_keeps_the_rest_of_extra(layout_api):
    from aivinnet.db.userdata import UserTable
    from aivinnet.store.homepage import HomepageStore

    UserTable.set_extra(1, "firstname", "Ada")
    save(layout_api, hidden=["rediscover"])

    HomepageStore.layouts.clear()  # what a restart leaves: nothing in RAM

    assert {r["key"] for r in layout(layout_api) if not r["visible"]} == {"rediscover"}
    assert UserTable.get_extra(1)["firstname"] == "Ada"


def test_each_user_has_their_own_home(layout_api):
    save(layout_api, hidden=["rediscover"])

    layout_api.userid = 2

    assert all(r["visible"] for r in layout(layout_api))


def test_an_oversized_body_is_refused(layout_api):
    res = layout_api.put("/nothome/layout", json={"order": ["x"] * 101, "hidden": []})

    assert res.status_code == 422


def test_the_guest_account_keeps_the_default_home(layout_api):
    """One guest account is shared by every guest: its layout would be all of theirs."""
    from aivinnet.db.userdata import UserTable

    created = UserTable.get_by_username("guest") is None
    if created:
        UserTable.insert_guest_user()
    layout_api.userid = UserTable.get_by_username("guest").id
    try:
        res = layout_api.put("/nothome/layout", json={"order": [], "hidden": ["rediscover"]})

        assert res.status_code == 403
        assert all(r["visible"] for r in layout(layout_api))
        assert "home_layout" not in UserTable.get_extra(layout_api.userid)
    finally:
        if created:
            UserTable.remove_by_username("guest")


def test_a_saved_layout_leaves_the_login_list_working(layout_api, api_client, monkeypatch):
    """The login screen's user list read `extra["firstname"]` whenever `extra` was
    filled, and a saved layout is the first thing that fills it for an account
    without a first name: KeyError, 500, nobody can pick their account."""
    save(layout_api, hidden=["rediscover"])
    monkeypatch.setattr("aivinnet.api.auth.current_user", None)
    auth = api_client("aivinnet.api.auth")

    res = auth.get("/auth/users?simplified=true")

    assert res.status_code == 200, res.text
    me = next(u for u in res.get_json()["users"] if u["id"] == layout_api.userid)
    assert me["firstname"] == ""


def test_the_layout_stays_out_of_tokens_and_auth_answers(layout_api):
    """`todict()` is what every token and every `/auth/user*` answer carries."""
    from aivinnet.db.userdata import UserTable

    UserTable.set_extra(layout_api.userid, "firstname", "Ada")
    save(layout_api, hidden=["rediscover"])

    assert UserTable.get_by_id(layout_api.userid).todict()["extra"] == {"firstname": "Ada"}
    assert "home_layout" in UserTable.get_extra(layout_api.userid)  # still stored, only not sent


def test_settings_name_a_row_by_what_it_is_not_what_it_shows_now(layout_api, monkeypatch):
    """ "For this time" is retitled every hour with the slot it is in."""
    from aivinnet.store.homepage import HomepageStore

    monkeypatch.setattr(HomepageStore.entries["for_this_time"], "title", "Your weekday evenings")

    names = {r["key"]: r["title"] for r in layout(layout_api)}

    assert names["for_this_time"] == "For this time"


@pytest.mark.parametrize("saved", [{"order": 5, "hidden": True}, {"order": None}, "a string"])
def test_a_layout_in_a_shape_it_never_had_reads_as_none(layout_api, saved):
    from aivinnet.db.userdata import UserTable

    UserTable.set_extra(layout_api.userid, "home_layout", saved)

    listed = layout(layout_api)

    assert [r["key"] for r in listed] == list(DEFAULT_ORDER)
    assert all(r["visible"] for r in listed)


def test_a_deleted_users_layout_is_not_handed_to_the_next_one(layout_api, api_client, monkeypatch):
    """SQLite reuses the newest id once it is deleted; the cache must not."""
    from aivinnet.db.userdata import UserTable
    from aivinnet.store.homepage import HomepageStore

    UserTable.insert_one({"username": "leaving", "password": "x", "roles": ["user"]})
    leaving = UserTable.get_by_username("leaving").id
    layout_api.userid = leaving
    save(layout_api, hidden=["rediscover"])
    monkeypatch.setattr("aivinnet.api.auth.current_user", {"username": "spec-admin", "roles": ["admin"]})
    auth = api_client("aivinnet.api.auth")

    res = auth.delete("/auth/profile/delete", json={"username": "leaving"})

    assert res.status_code == 200, res.text
    assert leaving not in HomepageStore.layouts
