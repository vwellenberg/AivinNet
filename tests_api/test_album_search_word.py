"""An album is found by one word of its title, not only by most of it.

Album search scored with `token_sort_ratio`, which compares the whole title
with the query. One word of a long title fell far below the cutoff of 50:
"essentials" against "Kingdom Come: Deliverance II - Soundtrack Essentials"
scored 34, so the album never showed up — neither under "Albums" nor as the
top result — while a track with the same word did (tracks score with WRatio).
"""

from types import SimpleNamespace

import pytest

ALBUM = "Kingdom Come: Deliverance II - Soundtrack Essentials"


@pytest.fixture()
def searchlib(monkeypatch):
    import aivinnet.lib.searchlib as searchlib

    monkeypatch.setattr(searchlib, "_choices", {})
    return searchlib


def _albums(searchlib, monkeypatch, titles):
    albums = [SimpleNamespace(title=t, albumhash=f"a{i}") for i, t in enumerate(titles)]
    monkeypatch.setattr(searchlib.AlbumStore, "get_flat_list", classmethod(lambda cls: list(albums)))
    return albums


@pytest.mark.parametrize("query", ["essentials", "Essentials", "soundtrack", "deliverance", "kingdom come"])
def test_one_word_of_a_long_album_title_finds_it(searchlib, monkeypatch, query):
    albums = _albums(searchlib, monkeypatch, [ALBUM, "Night Woods", "Drum Loop 03"])

    found = searchlib.SearchAlbums(query)()

    assert albums[0] in found


def test_the_full_title_still_ranks_first(searchlib, monkeypatch):
    # The partial comparison must not lift a title that merely contains the
    # query above the one that IS the query.
    albums = _albums(searchlib, monkeypatch, [ALBUM, "Essentials", "The Essentials Collection"])

    found = searchlib.SearchAlbums("essentials")()

    assert found[0] is albums[1]
    assert len(found) == len(albums)


def test_unrelated_titles_stay_out(searchlib, monkeypatch):
    _albums(searchlib, monkeypatch, ["Night Woods", "Drum Loop 03"])

    assert searchlib.SearchAlbums("essentials")() == []


@pytest.mark.parametrize("query", ["a", "o", "the", "essen", "essentials", "kingdom come deliverance"])
def test_albums_score_exactly_like_tracks_with_the_same_title(searchlib, monkeypatch, query):
    # Deliberate: albums now follow the scorer tracks and artists always had,
    # short queries included — one letter lists what contains it in all three
    # sections alike, instead of tracks only. Pinned so a later change to one
    # scorer cannot silently split them again.
    titles = [ALBUM, "Night Woods", "The Other Side", "Drum Loop 03"]
    _albums(searchlib, monkeypatch, titles)
    tracks = [SimpleNamespace(title=t, trackhash=f"t{i}") for i, t in enumerate(titles)]
    monkeypatch.setattr(searchlib.TrackStore, "get_flat_list", classmethod(lambda cls: list(tracks)))
    monkeypatch.setattr(searchlib, "remove_duplicates", lambda found: found)

    albums = [(a.title, round(a._score, 6)) for a in searchlib.SearchAlbums(query)()]
    found_tracks = [(t.title, round(t._score, 6)) for t in searchlib.SearchTracks(query)()]

    assert albums == found_tracks
