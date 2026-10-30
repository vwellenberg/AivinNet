"""Titles a tagger had mangled are shown repaired, and keep their references.

A Star Trek soundtrack showed "Suite From Heroes and Demons: Whereâ€™s Freya":
the UTF-8 of "\u2019" read as Windows-1252 and saved that way into the tags. The
server reads it again as UTF-8 when it loads the library
(`utils/parsers.py::repair_mojibake`). Title, album and artists make the
trackhash, so the hash moves, and `lib/name_cleanup.py` carries favourites,
playlists and plays over — the same way as for the other name cleanups.

The tracks come from the real model (`track_to_dataclass`), so the old hash is
the one the previous code computed, not a stand-in.
"""

import pytest
from sqlalchemy import delete, insert, select

from aivinnet.utils.hashing import create_hash

ALBUM = "Star Trek: Deep Space Nine"
FOLDER = "/m/700-Soundtracks/Star Trek"
MANGLED = "Suite From Heroes and Demons: Whereâ€™s Freya / To the Rescue"
REPAIRED = "Suite From Heroes and Demons: Where\u2019s Freya / To the Rescue"


def _track(title: str, artists: str = "Dennis McCarthy", album: str = ALBUM, config=None, track: int = 4):
    from aivinnet.config import UserConfig
    from aivinnet.db.utils import track_to_dataclass

    row = {
        "id": track,
        "album": album,
        "albumartists": artists,
        "albumhash": create_hash(album, FOLDER),
        "artists": artists,
        "bitrate": 320,
        "copyright": "",
        "date": 0,
        "disc": 1,
        "duration": 120,
        "filepath": f"{FOLDER}/{track:02d}.mp3",
        "folder": FOLDER,
        "genres": None,
        "last_mod": 1,
        "title": title,
        "track": track,
        "trackhash": "",
        "extra": {},
        "lastplayed": 0,
        "playcount": 0,
        "playduration": 0,
    }
    return track_to_dataclass(row, config or UserConfig())


@pytest.fixture()
def reference_db(playlist_db):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable, ScrobbleTable

    def wipe():
        with DbEngine.manager(commit=True) as session:
            session.execute(delete(FavoritesTable))
            session.execute(delete(ScrobbleTable))

    wipe()
    yield
    wipe()


def test_the_title_is_shown_repaired_and_remembers_its_old_hash():
    track = _track(MANGLED)

    assert track.title == REPAIRED
    assert track.og_title == REPAIRED
    assert track.trackhash == create_hash(REPAIRED, ALBUM, "Dennis McCarthy")
    assert track._legacyhash == create_hash(MANGLED, ALBUM, "Dennis McCarthy")
    assert track._previoushashes == ()


def test_album_and_artists_are_repaired_too():
    # ü as "Ã¼": the artist hash changes with it, and the old one is remembered.
    track = _track("Theme", artists="Hans MÃ¼ller", album="Ãœber Alles")

    assert track.album == track.og_album == "Über Alles"
    assert [a["name"] for a in track.artists] == ["Hans Müller"]
    assert [a["name"] for a in track.albumartists] == ["Hans Müller"]
    assert (create_hash("Hans MÃ¼ller", decode=True), create_hash("Hans Müller", decode=True)) in (
        track._legacy_artisthashes
    )
    assert track._legacyhash == create_hash("Theme", "Ãœber Alles", "Hans MÃ¼ller")


def test_the_album_hash_stays_where_cover_and_favourites_are():
    from aivinnet.config import UserConfig

    config = UserConfig()
    config.mergeAlbums = True
    track = _track("Theme", artists="Hans MÃ¼ller", album="Ãœber Alles", config=config)

    assert track.album == "Über Alles"
    assert track.albumhash == create_hash("Ãœber Alles", "Hans MÃ¼ller")


def test_a_cleaned_and_repaired_track_remembers_the_hash_of_the_release_before():
    # "Composed by" came off already: a library that ran that release holds its
    # references under the cleaned, still mangled names.
    track = _track(MANGLED, artists="Composed by Dennis McCarthy")

    assert [a["name"] for a in track.artists] == ["Dennis McCarthy"]
    assert track._legacyhash == create_hash(MANGLED, ALBUM, "Composed by Dennis McCarthy")
    assert track._previoushashes == (create_hash(MANGLED, ALBUM, "Dennis McCarthy"),)


def test_a_track_with_real_accents_is_left_alone():
    track = _track("Café Society", artists="Björk", album="Pokémon: Sigur Rós\u2019 Theme")

    assert track.title == "Café Society"
    assert track.album == "Pokémon: Sigur Rós\u2019 Theme"
    assert track._legacyhash == ""
    assert track._previoushashes == ()
    assert track._legacy_artisthashes == ()


def test_favourites_playlists_and_plays_follow(reference_db):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable
    from aivinnet.lib.name_cleanup import carry_cleaned_names, current_trackhash

    track = _track(MANGLED)
    old = create_hash(MANGLED, ALBUM, "Dennis McCarthy")

    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(PlaylistTable).values(
                name="DS9", last_updated=0, image=None, userid=1, settings={}, trackhashes=[old], extra={}
            )
        )
        session.execute(
            insert(FavoritesTable).values(hash=f"track_{old}", type="track", timestamp=1, userid=1, extra={})
        )
        session.execute(
            insert(ScrobbleTable).values(trackhash=old, duration=120, timestamp=1, source="", userid=1, extra={})
        )

    carry_cleaned_names([track])

    with DbEngine.manager() as session:
        playlists = session.execute(select(PlaylistTable.trackhashes).where(PlaylistTable.name == "DS9")).scalars()
        assert list(playlists) == [[track.trackhash]]
        assert session.execute(select(FavoritesTable.hash)).scalars().all() == [f"track_{track.trackhash}"]
        assert session.execute(select(ScrobbleTable.trackhash)).scalars().all() == [track.trackhash]
    assert current_trackhash(old) == track.trackhash


def test_a_mangled_featured_artist_keeps_its_artist_hash():
    # The release before listed "BjÃ¶rk" as an artist of its own, out of the title.
    track = _track("Song (feat. BjÃ¶rk)")

    assert "Björk" in [a["name"] for a in track.artists]
    assert (create_hash("BjÃ¶rk", decode=True), create_hash("Björk", decode=True)) in track._legacy_artisthashes


def test_the_hash_before_the_repair_keeps_its_place_next_to_the_credit_rule():
    # Nothing for the 2026-10 credit rule to add, but the release before the
    # repair stripped "Lyrics by" already: its hash goes in the second place.
    track = _track(MANGLED, artists="Lyrics by Dennis McCarthy")

    assert track._legacyhash == create_hash(MANGLED, ALBUM, "Lyrics by Dennis McCarthy")
    assert track._previoushashes == ("", create_hash(MANGLED, ALBUM, "Dennis McCarthy"))
