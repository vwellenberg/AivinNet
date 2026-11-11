"""
"Remove from Continue listening" (#776): `POST`/`DELETE /nothome/continue/dismiss`
and what Home does with a dismissed entry. Real request cycle on the discover
scenario's library; the entry is put in the store the way the routine leaves it.
"""

import time

import pytest
from test_home_discover_api import (  # noqa: F401 - the imported fixtures
    home,
)


@pytest.fixture()
def dismissing(home, monkeypatch):
    """The scenario's API (the `home` client, which carries its `userid`), acting as its user."""
    import aivinnet.api.home as home_api
    import aivinnet.store.homepage as homepage

    monkeypatch.setattr(home_api, "get_current_userid", lambda: home.userid)
    monkeypatch.setattr(homepage, "get_current_userid", lambda: home.userid)
    return home


@pytest.fixture()
def api(dismissing):
    return dismissing


def album_hash() -> str:
    from aivinnet.store.albums import AlbumStore

    return next(iter(AlbumStore.albummap))


def continue_on(userid: int, albumhash: str, timestamp: int) -> None:
    """Put the album in "Continue listening", as the routine stores it: the newest play decides."""
    from aivinnet.store.homepage import HomepageStore

    HomepageStore.entries["continue_listening"].items[userid] = [
        {
            "type": "album",
            "hash": albumhash,
            "trackhash": "x",
            "track_index": 0,
            "track_total": 5,
            "timestamp": timestamp,
        }
    ]


def shown_continue(api) -> list[dict]:
    res = api.get("/nothome/?limit=9")
    assert res.status_code == 200, res.text
    row = next((r["continue_listening"] for r in res.get_json()["rows"] if "continue_listening" in r), None)
    return [] if row is None else row["items"]


def dismiss(api, type: str, hash: str, status: int = 200):
    res = api.post("/nothome/continue/dismiss", json={"type": type, "hash": hash})
    assert res.status_code == status, res.text
    return res


def undismiss(api, type: str, hash: str):
    res = api.delete("/nothome/continue/dismiss", json={"type": type, "hash": hash})
    assert res.status_code == 200, res.text


def test_a_card_carries_the_key_it_is_dismissed_by(api, dismissing):
    albumhash = album_hash()
    continue_on(dismissing.userid, albumhash, int(time.time()) - 600)

    shown = shown_continue(api)

    assert len(shown) == 1
    assert shown[0]["dismiss"] == {"type": "album", "hash": albumhash}


def test_a_dismissed_entry_leaves_continue_listening(api, dismissing):
    albumhash = album_hash()
    continue_on(dismissing.userid, albumhash, int(time.time()) - 600)

    dismiss(api, "album", albumhash)

    assert shown_continue(api) == []


def test_it_comes_back_on_the_first_play_after_the_dismissal(api, dismissing):
    albumhash = album_hash()
    continue_on(dismissing.userid, albumhash, int(time.time()) - 600)
    dismiss(api, "album", albumhash)

    # A play newer than the dismissal: the routine stores it as the entry's last play.
    continue_on(dismissing.userid, albumhash, int(time.time()) + 60)

    assert len(shown_continue(api)) == 1


def test_undo_brings_it_back_at_once(api, dismissing):
    albumhash = album_hash()
    continue_on(dismissing.userid, albumhash, int(time.time()) - 600)
    dismiss(api, "album", albumhash)
    assert shown_continue(api) == []

    undismiss(api, "album", albumhash)

    assert len(shown_continue(api)) == 1


def test_an_unknown_album_is_refused_and_nothing_is_stored(api, dismissing):
    from aivinnet.db.userdata import ContinueDismissTable

    dismiss(api, "album", "not-an-album", status=404)

    assert ContinueDismissTable.of_user(dismissing.userid) == {}


def test_dismissing_again_keeps_one_mark_and_moves_its_stamp_on(api, dismissing):
    from aivinnet.db.userdata import ContinueDismissTable

    albumhash = album_hash()
    dismiss(api, "album", albumhash)
    first = ContinueDismissTable.of_user(dismissing.userid)[("album", albumhash)]

    time.sleep(1.1)
    dismiss(api, "album", albumhash)

    marks = ContinueDismissTable.of_user(dismissing.userid)
    assert list(marks) == [("album", albumhash)]
    assert marks[("album", albumhash)] > first


def test_a_playlist_is_dismissed_by_its_id_without_a_store_check(api, dismissing):
    from aivinnet.db.userdata import ContinueDismissTable

    dismiss(api, "playlist", "4242")

    assert ("playlist", "4242") in ContinueDismissTable.of_user(dismissing.userid)
