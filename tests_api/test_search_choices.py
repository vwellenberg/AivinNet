"""Search normalises each title once, not on every keystroke (#295).

Transliterating every title of the library with `unidecode` was most of a
search's time, on the single request thread, for every keystroke and every
"load more". The choice strings are now kept; the results must not change.
"""

from types import SimpleNamespace

import pytest
from rapidfuzz import fuzz, process, utils
from unidecode import unidecode

TITLES = [
    "Night Woods",
    "Nïght Wööds (Extended)",
    "night-woods 2",
    "Mötley Crüe",
    "日本の夜",
    "Ночной лес",
    "Drum Loop 03",
    "The Guild 2 — Main Theme",
    "",
]


@pytest.fixture()
def searchlib(monkeypatch):
    import aivinnet.lib.searchlib as searchlib

    monkeypatch.setattr(searchlib, "_choices", {})
    monkeypatch.setattr(searchlib, "remove_duplicates", lambda tracks: tracks)
    return searchlib


def _old(query, titles, scorer, cutoff=50, limit=150):
    """The formula before the cache, as the reference."""
    choices = [unidecode(t).lower() for t in titles]
    return [
        (i, round(score, 6))
        for _c, score, i in process.extract(
            query, choices, score_cutoff=cutoff, limit=limit, processor=utils.default_process, scorer=scorer
        )
    ]


@pytest.mark.parametrize("query", ["night woods", "NIGHT", "motley", "drum loop", "guild theme", "x"])
def test_tracks_artists_and_albums_rank_as_the_uncached_formula(searchlib, monkeypatch, query):
    tracks = [SimpleNamespace(title=t, trackhash=f"t{i}") for i, t in enumerate(TITLES)]
    artists = [SimpleNamespace(name=t) for t in TITLES]
    albums = [SimpleNamespace(title=t) for t in TITLES]
    monkeypatch.setattr(searchlib.TrackStore, "get_flat_list", classmethod(lambda cls: list(tracks)))
    monkeypatch.setattr(searchlib.ArtistStore, "get_flat_list", classmethod(lambda cls: list(artists)))
    monkeypatch.setattr(searchlib.AlbumStore, "get_flat_list", classmethod(lambda cls: list(albums)))

    got = [(tracks.index(t), round(t._score, 6)) for t in searchlib.SearchTracks(query)()]
    assert got == _old(query, TITLES, fuzz.WRatio)

    got = [(artists.index(a), round(a._score, 6)) for a in searchlib.SearchArtists(query)()]
    assert got == _old(query, TITLES, fuzz.WRatio)

    # Albums score with WRatio too (formerly token_sort_ratio, see test_album_search_word.py).
    got = [(albums.index(a), round(a._score, 6)) for a in searchlib.SearchAlbums(query)()]
    assert got == _old(query, TITLES, fuzz.WRatio)


def test_a_second_search_does_not_transliterate_again(searchlib, monkeypatch):
    tracks = [SimpleNamespace(title=t, trackhash=f"t{i}") for i, t in enumerate(TITLES)]
    monkeypatch.setattr(searchlib.TrackStore, "get_flat_list", classmethod(lambda cls: list(tracks)))
    calls = []
    monkeypatch.setattr(searchlib, "unidecode", lambda text: calls.append(text) or unidecode(text))

    searchlib.SearchTracks("night")()
    first = len(calls)
    searchlib.SearchTracks("nigh")()
    searchlib.SearchTracks("night w")()

    assert first == len(set(TITLES))
    assert len(calls) == first, "the titles were transliterated again"


def test_a_track_gone_from_the_store_is_not_found(searchlib, monkeypatch):
    tracks = [SimpleNamespace(title="Night Woods", trackhash="t1")]
    monkeypatch.setattr(searchlib.TrackStore, "get_flat_list", classmethod(lambda cls: list(tracks)))
    assert searchlib.SearchTracks("night woods")()

    tracks.clear()

    assert searchlib.SearchTracks("night woods")() == []
