"""
"Not interested" on Home (#531): `GET`/`POST`/`DELETE /nothome/not-interested`,
and what "Never played" and "Artists you might like" do with a mark.

Real request cycle, real routines, on the scenario of `test_home_discover_api`
(Primus, Fishbone and Miles Davis never played; Primus and Fishbone make the
"funk rock" chip).
"""

import pytest
from test_home_discover_api import (  # noqa: F401 - the imported fixtures
    FISHBONE,
    FNM,
    MILES,
    PRIMUS,
    RHCP,
    artisthash,
    history,
    home,
    rows,
    run_newer_routines,
    run_routines,
    th,
)


@pytest.fixture()
def marks(home, monkeypatch):  # noqa: F811 - the imported fixture
    """The discover scenario's API, with the endpoints acting as its user."""
    import aivinnet.api.home as home_api

    monkeypatch.setattr(home_api, "get_current_userid", lambda: home.userid)
    return home


def mark(api, type, hash, status=200):
    res = api.post("/nothome/not-interested", json={"type": type, "hash": hash})
    assert res.status_code == status, res.text


def unmark(api, type, hash):
    res = api.delete("/nothome/not-interested", json={"type": type, "hash": hash})
    assert res.status_code == 200, res.text


def listed(api):
    res = api.get("/nothome/not-interested")
    assert res.status_code == 200, res.text
    return res.get_json()["items"]


def never_played(api, limit=9):
    res = api.get(f"/nothome/?limit={limit}")
    assert res.status_code == 200, res.text
    row = next((r["never_played"] for r in res.get_json() if "never_played" in r), None)
    if row is None:
        return [], []
    chips = [[i["item"]["albumhash"] for i in c["items"]] for c in row.get("chips", [])]
    return [i["item"]["albumhash"] for i in row["items"]], chips


def with_playlist():
    """Primus and Miles Davis next to Red Hot Chili Peppers in a playlist: "Artists you might like"."""
    from sqlalchemy import insert

    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import PlaylistTable

    trackhashes = [th(RHCP, 1), th(FNM, 1), th(PRIMUS, 1), th(MILES, 2)]
    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(PlaylistTable).values(
                id=3, name="Mixtape", last_updated=0, image=None, userid=1, settings={}, trackhashes=trackhashes
            )
        )


def might_like(api):
    data, _ = rows(api)
    return {i["item"]["artisthash"] for i in data.get("artists_you_might_like", {}).get("items", [])}


def test_a_marked_album_leaves_never_played_at_once(marks, history):
    run_routines()

    mark(marks, "album", PRIMUS)

    items, chips = never_played(marks)
    assert items == [FISHBONE, MILES]
    # The "funk rock" chip is down to one album: no choice, so no chip — as
    # the routine would decide.
    assert chips == []


def test_the_rows_that_can_be_marked_say_so(marks, history):
    with_playlist()
    run_routines()
    run_newer_routines()

    data, _ = rows(marks)

    assert data["never_played"]["markable"] == "album"
    assert data["artists_you_might_like"]["markable"] == "artist"
    assert "markable" not in data["on_repeat"]


def test_the_row_stays_full_until_its_routine_runs(marks, history):
    run_routines()

    mark(marks, "album", PRIMUS)

    # Two asked for, one of the first two marked: the third moves up.
    items, _ = never_played(marks, limit=2)
    assert items == [FISHBONE, MILES]


def test_taking_it_back_brings_the_card_back_at_once(marks, history):
    run_routines()
    mark(marks, "album", PRIMUS)

    unmark(marks, "album", PRIMUS)

    items, _ = never_played(marks)
    assert set(items[:2]) == {PRIMUS, FISHBONE} and items[2:] == [MILES]
    assert listed(marks) == []


def test_the_routine_leaves_the_album_out_too(marks, history):
    from aivinnet.store.homepage import HomepageStore

    mark(marks, "album", PRIMUS)
    run_routines()

    entry = HomepageStore.entries["never_played"]
    assert [i["hash"] for i in entry.items[1]] == [FISHBONE, MILES]
    # One unplayed Funk Rock album left: no choice, so no chip.
    assert entry.chips[1] == []


def test_a_marked_artist_leaves_artists_you_might_like(marks, history):
    from aivinnet.store.homepage import HomepageStore

    with_playlist()
    run_newer_routines()
    assert might_like(marks) == {artisthash(PRIMUS), artisthash(MILES)}

    mark(marks, "artist", artisthash(PRIMUS))

    assert might_like(marks) == {artisthash(MILES)}
    run_newer_routines()
    assert [i["hash"] for i in HomepageStore.entries["artists_you_might_like"].items[1]] == [artisthash(MILES)]


def test_a_mark_is_one_users(marks, history):
    run_routines()

    marks.userid = 2
    mark(marks, "album", PRIMUS)
    marks.userid = 1

    items, _ = never_played(marks)
    assert PRIMUS in items
    assert listed(marks) == []


def test_settings_list_the_marks_newest_first(marks, history, monkeypatch):
    from aivinnet.store.albums import AlbumStore

    mark(marks, "album", PRIMUS)
    mark(marks, "artist", artisthash(MILES))
    mark(marks, "album", PRIMUS)  # again: no second row

    items = listed(marks)

    assert [(i["type"], i["hash"]) for i in items] == [("artist", artisthash(MILES)), ("album", PRIMUS)]
    artist, album = items
    assert artist["title"] == "Miles Davis"
    assert album["title"] == "Frizzle Fry"
    assert album["subtitle"] == "Primus"
    assert album["image"] == f"{PRIMUS}.webp?pathhash=ph-Frizzle Fry"

    # Gone from the library (moved away, retagged elsewhere): still listed, so
    # it can be taken back, but without a name to show.
    monkeypatch.delitem(AlbumStore.albummap, PRIMUS)
    assert listed(marks)[1]["title"] is None
    unmark(marks, "album", PRIMUS)
    assert [i["type"] for i in listed(marks)] == ["artist"]


def test_the_guest_account_cannot_mark(marks, history):
    from aivinnet.db.userdata import UserTable

    created = UserTable.get_by_username("guest") is None
    if created:
        UserTable.insert_guest_user()
    marks.userid = UserTable.get_by_username("guest").id
    try:
        mark(marks, "album", PRIMUS, status=403)
        res = marks.delete("/nothome/not-interested", json={"type": "album", "hash": PRIMUS})
        assert res.status_code == 403
        assert listed(marks) == []
    finally:
        if created:
            UserTable.remove_by_username("guest")


def test_what_is_no_album_or_artist_is_refused(marks, history):
    mark(marks, "album", "0" * 16, status=404)
    # An artist hash is no album.
    mark(marks, "album", artisthash(PRIMUS), status=404)
    mark(marks, "track", th(PRIMUS, 1), status=422)
    mark(marks, "album", "short", status=422)

    assert listed(marks) == []


def test_a_retag_moves_the_mark_along(marks, history):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import NotInterestedTable
    from aivinnet.lib.reference_migration import migrate_identity_references

    mark(marks, "album", PRIMUS)
    mark(marks, "album", MILES)
    marks.userid = 2
    mark(marks, "album", PRIMUS)
    mark(marks, "album", FISHBONE)

    # Primus' album becomes Fishbone's identity: user 2 marked both and keeps one.
    with DbEngine.manager(commit=True) as session:
        migrate_identity_references("album", {PRIMUS: FISHBONE}, session)

    assert NotInterestedTable.hashes(1) == {"album": {FISHBONE, MILES}}
    assert NotInterestedTable.hashes(2) == {"album": {FISHBONE}}
    assert len(NotInterestedTable.of_user(2)) == 1


def test_a_deleted_user_takes_the_marks_along(marks, history):
    from aivinnet.db.userdata import NotInterestedTable, UserTable

    UserTable.insert_one({"username": "leaving", "password": "x", "roles": ["user"]})
    leaving = UserTable.get_by_username("leaving").id
    NotInterestedTable.add(leaving, "album", PRIMUS)

    UserTable.remove_by_username("leaving")

    # SQLite gives the next new user this id again: it must start clean.
    assert NotInterestedTable.of_user(leaving) == []


def test_only_marks_still_in_the_row_make_it_ask_for_more(marks, history, monkeypatch):
    from aivinnet.store.homepage import HomepageStore

    mark(marks, "album", PRIMUS)
    run_routines()  # the routine has left Primus out already
    entry = HomepageStore.entries["never_played"]
    asked = []
    get_items = entry.get_items
    monkeypatch.setattr(entry, "get_items", lambda userid, limit: asked.append(limit) or get_items(userid, limit))

    never_played(marks, limit=2)

    assert asked == [2]
