"""
"Recently added" stamps "NEW" on the albums the user has not played (#533).

The row is one for everyone (kept under user 0, filled by the scan); the stamp
is each user's own. Real request cycle and real scrobbles, on the library of
`test_home_discover_api`.
"""

import pytest
from test_home_discover_api import (  # noqa: F401
    FNM,
    PRIMUS,
    history,
    home,
    rows,
    scrobble,
    th,
)


@pytest.fixture()
def added(home, monkeypatch):  # noqa: F811 - the imported fixture
    import aivinnet.lib.first_play_cache as first_play_cache
    from aivinnet.store.homepage import HomepageStore

    # A fresh cache per test: its key is the user's play count and last id,
    # which a later test may repeat.
    monkeypatch.setattr(first_play_cache, "_first_plays", {})
    # As the scan stores them (`recentlyadded.py`): albums and a folder.
    HomepageStore.entries["recently_added"].items[0] = [
        {"type": "album", "hash": PRIMUS, "timestamp": 1_700_000_300, "help_text": "NEW ALBUM"},
        {"type": "album", "hash": FNM, "timestamp": 1_700_000_200, "help_text": "NEW TRACKS"},
        {"type": "folder", "hash": "/music/Singles", "timestamp": 1_700_000_100, "help_text": "NEW MUSIC"},
    ]
    return home


def stamps(api):
    row, _ = rows(api)
    cards = row["recently_added"]["items"]
    return {c["item"].get("albumhash", c["item"].get("path")): c["item"].get("home") for c in cards}


def test_an_album_without_a_play_is_stamped_one_heard_is_not(added, history):
    shown = stamps(added)

    # Faith No More has a long history, Primus was never played.
    assert shown[PRIMUS] == {"unheard": True}
    assert shown[FNM] is None
    # A folder is no album: it never gets the stamp.
    assert shown["/music/Singles"] is None


def test_one_track_is_enough_and_it_shows_at_once(added, history):
    assert stamps(added)[PRIMUS] == {"unheard": True}

    scrobble(th(PRIMUS, 3), history - 60)

    assert stamps(added)[PRIMUS] is None


def test_the_stamp_is_each_users_own(added, history):
    scrobble(th(PRIMUS, 1), history - 60, userid=2)

    assert stamps(added)[PRIMUS] == {"unheard": True}
    added.userid = 2
    shown = stamps(added)
    assert shown[PRIMUS] is None
    # User 2 never heard Faith No More.
    assert shown[FNM] == {"unheard": True}


def test_the_row_itself_stays_the_same_for_everyone(added, history):
    first = [c["item"]["help_text"] for c in rows(added)[0]["recently_added"]["items"]]
    added.userid = 2
    second = [c["item"]["help_text"] for c in rows(added)[0]["recently_added"]["items"]]

    assert first == second == ["NEW ALBUM", "NEW TRACKS", "NEW MUSIC"]


def test_a_stamp_never_leaks_into_the_stored_row(added, history):
    from aivinnet.store.homepage import HomepageStore

    stamps(added)

    assert all("home" not in item for item in HomepageStore.entries["recently_added"].items[0])


def test_a_deleted_user_leaves_no_first_plays_behind(added, history):
    import aivinnet.lib.first_play_cache as first_play_cache
    from aivinnet.store.homepage import HomepageStore

    scrobble(th(PRIMUS, 1), history - 60, userid=2)
    added.userid = 2
    stamps(added)
    assert 2 in first_play_cache._first_plays

    # SQLite gives the newest user's id to the next one created.
    HomepageStore.forget_user(2)

    assert 2 not in first_play_cache._first_plays
