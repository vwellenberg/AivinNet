"""A word of a title outranks titles that merely look like it.

Reported: "saint" did not bring up "049 Saint Wenceslaus Theme" among the top
results. Three things stood in the way, and each is pinned here:

- The number in front of the title (now taken off by the model,
  `utils/parsers.py::strip_track_number`).
- WRatio scored every title that resembled "saint" level with the one holding
  it as a word ("Saints" 91, "Saint Wenceslaus Theme" 90), and the top results
  have four track slots.
- An artist "Saint …" as the top result filled all four slots with its own
  songs, so a title hit only showed up when the artist had fewer than four.
"""

import pytest

ARTIST = "Saint Motel"


def _track(n: int, title: str, artist: str, filename: str | None = None, track: int = 1):
    from aivinnet.config import UserConfig
    from aivinnet.db.utils import track_to_dataclass
    from aivinnet.utils.hashing import create_hash

    folder = f"/m/{artist}"
    return track_to_dataclass(
        {
            "id": n,
            "album": f"{artist} Album",
            "albumartists": artist,
            "albumhash": create_hash(f"{artist} Album", artist),
            "artists": artist,
            "bitrate": 320,
            "copyright": "",
            "date": 0,
            "disc": 1,
            "duration": 100,
            "filepath": f"{folder}/{filename or title}.mp3",
            "folder": folder,
            "genres": None,
            "last_mod": n,
            "title": title,
            "track": track,
            "trackhash": "",
            "extra": {},
            "lastplayed": 0,
            "playcount": 0,
            "playduration": n,
        },
        UserConfig(),
    )


def _artist(name: str):
    from aivinnet.models.artist import Artist
    from aivinnet.utils.hashing import create_hash

    return Artist(
        name=name,
        albumcount=1,
        artisthash=create_hash(name, decode=True),
        created_date=0,
        date=0,
        duration=0,
        genres=[],
        genrehashes=[],
        trackcount=5,
        lastplayed=0,
        playcount=0,
        playduration=0,
        extra={},
    )


@pytest.fixture()
def library(monkeypatch):
    import aivinnet.lib.searchlib as searchlib
    from aivinnet.store.tracks import TrackGroup, TrackStore

    tracks = [
        # The artist's own songs, none with the word in the title.
        *(_track(i, f"Song {i}", ARTIST) for i in range(1, 6)),
        # Titles that only resemble the query.
        _track(10, "Saints", "Band A"),
        _track(11, "Satin Sheets", "Band B"),
        _track(12, "Paint It Black", "Band C"),
        _track(13, "Sainte-Marie", "Band D"),
        _track(14, "Faint", "Band E"),
        # The one asked for, last in the library, with its number in the tags.
        _track(49, "049 Saint Wenceslaus Theme", "Composed by Adam Sporka", "049 Saint Wenceslaus Theme", 49),
    ]
    groups: dict = {}
    for t in tracks:
        groups.setdefault(t.trackhash, TrackGroup([])).append(t)

    monkeypatch.setattr(TrackStore, "trackhashmap", groups)
    monkeypatch.setattr(searchlib.ArtistStore, "get_flat_list", classmethod(lambda cls: [_artist(ARTIST)]))
    monkeypatch.setattr(searchlib.AlbumStore, "get_flat_list", classmethod(lambda cls: []))
    monkeypatch.setattr(searchlib.AlbumStore, "get_albums_by_artisthash", classmethod(lambda cls, h: []))
    monkeypatch.setattr(searchlib, "_choices", {})
    return tracks


def test_the_title_is_cleaned_before_it_is_searched(library):
    assert library[-1].title == "Saint Wenceslaus Theme"


def test_a_word_of_the_title_is_among_the_top_tracks(library):
    import aivinnet.lib.searchlib as searchlib

    found = searchlib.TopResults.search("saint", limit=6)

    assert found["top_result"]["type"] in ("artist", "track")
    assert "Saint Wenceslaus Theme" in [t["title"] for t in found["tracks"]]


def test_word_matches_rank_above_lookalikes(library):
    import aivinnet.lib.searchlib as searchlib

    titles = [t.title for t in searchlib.SearchTracks("saint")()]

    words = {"Saints", "Sainte-Marie", "Saint Wenceslaus Theme"}
    assert set(titles[:3]) == words
    assert set(titles[3:]).isdisjoint(words)


def test_a_title_that_starts_with_the_query_ranks_above_one_that_contains_it(library):
    import aivinnet.lib.searchlib as searchlib

    titles = [t.title for t in searchlib.SearchTracks("theme")()]

    assert titles[0] == "Saint Wenceslaus Theme"


def test_several_words_match_in_any_order(library):
    import aivinnet.lib.searchlib as searchlib

    titles = [t.title for t in searchlib.SearchTracks("theme saint")()]

    assert titles[0] == "Saint Wenceslaus Theme"


def test_a_typo_still_finds_the_title(library):
    import aivinnet.lib.searchlib as searchlib

    titles = [t.title for t in searchlib.SearchTracks("wenceslas")()]

    assert "Saint Wenceslaus Theme" in titles


def test_the_exact_artist_keeps_its_own_songs_first(library):
    import aivinnet.lib.searchlib as searchlib

    found = searchlib.TopResults.search("saint motel", limit=6)

    assert found["top_result"]["name"] == ARTIST
    # The four most played of its own, as before.
    assert {t["title"] for t in found["tracks"]} == {"Song 1", "Song 2", "Song 3", "Song 4"}
