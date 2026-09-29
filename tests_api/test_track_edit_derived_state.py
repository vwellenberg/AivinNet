"""A tag edit rebuilds the track, its album and its artists in the stores.

Favorites, play counts and colours are derived at startup from other tables, so
a rebuilt entry started empty: every edit showed them un-favourited and unplayed
until the next restart. The rebuild must carry that state over.
"""

from types import SimpleNamespace

import pytest

import aivinnet.lib.track_edit as track_edit


def _state(**overrides):
    base = dict(fav_userids=[], playcount=0, playduration=0, lastplayed=0, color="")
    return SimpleNamespace(**{**base, **overrides})


def test_carry_over_copies_favourites_counts_and_colour():
    old = _state(fav_userids=[1, 3], playcount=12, playduration=2400, lastplayed=1_700_000_000, color="#abc")
    new = _state()

    track_edit._carry_over(old, new)

    assert new.fav_userids == [1, 3] and new.fav_userids is not old.fav_userids
    assert (new.playcount, new.playduration, new.lastplayed, new.color) == (12, 2400, 1_700_000_000, "#abc")


def test_an_empty_old_colour_does_not_wipe_a_new_one():
    new = _state(color="#123")

    track_edit._carry_over(_state(), new)

    assert new.color == "#123"


def test_a_track_has_no_colour_and_that_is_fine():
    old = SimpleNamespace(fav_userids=[2], playcount=4, playduration=100, lastplayed=5)
    new = SimpleNamespace(fav_userids=[], playcount=0, playduration=0, lastplayed=0)

    track_edit._carry_over(old, new)

    assert new.fav_userids == [2] and new.playcount == 4


@pytest.fixture()
def artist_store(monkeypatch):
    from aivinnet.store.artists import ArtistMapEntry, ArtistStore

    old = _state(artisthash="a1", fav_userids=[7], playcount=30, playduration=9000, lastplayed=99, color="#f00")
    monkeypatch.setattr(ArtistStore, "artistmap", {"a1": ArtistMapEntry(old, set(), set())})
    return ArtistStore


def test_rebuilding_an_artist_keeps_its_favourites_counts_and_colour(artist_store, monkeypatch):
    fresh = _state(artisthash="a1")
    monkeypatch.setattr(track_edit, "create_artists", lambda hashes: [(fresh, {"t1"}, {"al1"})])

    track_edit._reconcile_artist("a1")

    rebuilt = artist_store.artistmap["a1"].artist
    assert rebuilt is fresh
    assert rebuilt.fav_userids == [7]
    assert (rebuilt.playcount, rebuilt.color) == (30, "#f00")
