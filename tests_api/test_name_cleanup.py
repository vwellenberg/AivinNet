"""The cleaned names keep their favourites, playlists and plays.

The server now takes a track number off the front of a title ("049 Saint
Wenceslaus Theme") and a role off the front of an artist ("Composed by Adam
Sporka") when it loads the library (`utils/parsers.py`). Title and artists make
the trackhash, the name makes the artisthash, so both move — and every stored
reference would point at nothing. `lib/name_cleanup.py` carries them over.

The tracks here come from the real model (`track_to_dataclass`), so the old
hash is the one the previous code computed, not a stand-in.
"""

import pytest
from sqlalchemy import delete, insert, select

from aivinnet.utils.hashing import create_hash

ALBUM = "Kingdom Come Deliverance II"
FOLDER = "/m/700-Games/KCD2"


def _track(n: int, title: str, artists: str, filename: str, track: int):
    from aivinnet.config import UserConfig
    from aivinnet.db.utils import track_to_dataclass

    row = {
        "id": n,
        "album": ALBUM,
        "albumartists": artists,
        "albumhash": create_hash(ALBUM, FOLDER),
        "artists": artists,
        "bitrate": 320,
        "copyright": "",
        "date": 0,
        "disc": 1,
        "duration": 120,
        "filepath": f"{FOLDER}/{filename}",
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
    return track_to_dataclass(row, UserConfig())


# What the server called them until now, built the way it built them.
OLD_SAINT = create_hash("049 Saint Wenceslaus Theme", ALBUM, "Composed by Adam Sporka")
OLD_CREDIT_ONLY = create_hash("Fistcuffs", ALBUM, "Composed by Adam Sporka")
OLD_ARTIST = create_hash("Composed by Adam Sporka", decode=True)
NEW_ARTIST = create_hash("Adam Sporka", decode=True)


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


@pytest.fixture()
def tracks():
    return [
        _track(1, "049 Saint Wenceslaus Theme", "Composed by Adam Sporka", "049 Saint Wenceslaus Theme.mp3", 49),
        _track(2, "Fistcuffs", "Composed by Adam Sporka", "Fistcuffs.mp3", 2),
    ]


def _references():
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable

    with DbEngine.manager() as session:
        return {
            "playlist": session.execute(select(PlaylistTable.trackhashes)).scalars().all(),
            "favorites": sorted(session.execute(select(FavoritesTable.hash)).scalars().all()),
            "scrobbles": sorted(session.execute(select(ScrobbleTable.trackhash)).scalars().all()),
        }


def _store_old_references():
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable

    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(PlaylistTable).values(
                name="Bohemia",
                last_updated=0,
                image=None,
                userid=1,
                settings={},
                trackhashes=["keep0keep0keep00", OLD_SAINT, OLD_CREDIT_ONLY],
                extra={},
            )
        )
        for key, kind in ((f"track_{OLD_SAINT}", "track"), (f"artist_{OLD_ARTIST}", "artist")):
            session.execute(insert(FavoritesTable).values(hash=key, type=kind, timestamp=1, userid=1, extra={}))
        session.execute(
            insert(ScrobbleTable).values(
                trackhash=OLD_CREDIT_ONLY, duration=120, timestamp=1, source="", userid=1, extra={}
            )
        )


def test_the_model_cleans_the_names_and_remembers_the_old_hashes(tracks):
    saint, fistcuffs = tracks

    assert saint.title == "Saint Wenceslaus Theme"
    assert [a["name"] for a in saint.artists] == ["Adam Sporka"]
    assert [a["name"] for a in saint.albumartists] == ["Adam Sporka"]

    assert saint._legacyhash == OLD_SAINT
    assert fistcuffs._legacyhash == OLD_CREDIT_ONLY
    assert saint._legacy_artisthashes == ((OLD_ARTIST, NEW_ARTIST),)


def test_a_track_the_cleanup_leaves_alone_remembers_nothing():
    plain = _track(3, "Main Theme", "Adam Sporka", "01 Main Theme.mp3", 1)

    assert plain.title == "Main Theme"
    assert plain._legacyhash == ""
    assert plain._legacy_artisthashes == ()


def test_a_credit_the_separators_split_leaves_one_name():
    # "Composed & Lyrics by Jan Valta": the "&" made it "Composed" and
    # "Lyrics by Jan Valta", two artists that do not exist.
    track = _track(4, "The Sad Maiden", "Composed & Lyrics by Jan Valta", "6-036 The Sad Maiden.mp3", 36)

    assert [a["name"] for a in track.artists] == ["Jan Valta"]
    assert [a["name"] for a in track.albumartists] == ["Jan Valta"]
    assert track._legacyhash == create_hash("The Sad Maiden", ALBUM, "Composed", "Lyrics by Jan Valta")
    # The release before cleaned nothing here: one old hash is all there was.
    assert track._previoushash == ""


def test_a_lyricist_cleaned_now_remembers_the_hash_of_the_release_before():
    track = _track(5, "Ode to Henry", "Composed by Jan Valta; Lyrics by John Comer", "1-124 Ode to Henry.mp3", 124)

    assert [a["name"] for a in track.artists] == ["Jan Valta", "John Comer"]
    assert track._legacyhash == create_hash("Ode to Henry", ALBUM, "Composed by Jan Valta", "Lyrics by John Comer")
    assert track._previoushash == create_hash("Ode to Henry", ALBUM, "Jan Valta", "Lyrics by John Comer")
    assert (create_hash("Lyrics by John Comer", decode=True), create_hash("John Comer", decode=True)) in (
        track._legacy_artisthashes
    )


def test_references_under_the_hash_of_the_release_before_follow(reference_db):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable, ScrobbleTable
    from aivinnet.lib.name_cleanup import carry_cleaned_names, current_trackhash

    track = _track(5, "Ode to Henry", "Composed by Jan Valta; Lyrics by John Comer", "1-124 Ode to Henry.mp3", 124)
    previous = create_hash("Ode to Henry", ALBUM, "Jan Valta", "Lyrics by John Comer")
    lyricist = create_hash("Lyrics by John Comer", decode=True)
    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(FavoritesTable).values(hash=f"track_{previous}", type="track", timestamp=1, userid=1, extra={})
        )
        session.execute(
            insert(FavoritesTable).values(hash=f"artist_{lyricist}", type="artist", timestamp=1, userid=1, extra={})
        )
        session.execute(
            insert(ScrobbleTable).values(trackhash=previous, duration=120, timestamp=1, source="", userid=1, extra={})
        )

    carry_cleaned_names([track])

    refs = _references()
    assert refs["favorites"] == sorted([f"track_{track.trackhash}", f"artist_{create_hash('John Comer', decode=True)}"])
    assert refs["scrobbles"] == [track.trackhash]
    assert current_trackhash(previous) == track.trackhash


def test_every_reference_follows_the_cleaned_names(reference_db, tracks):
    from aivinnet.lib.name_cleanup import carry_cleaned_names

    _store_old_references()
    saint, fistcuffs = tracks

    report = carry_cleaned_names(tracks)

    refs = _references()
    assert refs["playlist"] == [["keep0keep0keep00", saint.trackhash, fistcuffs.trackhash]]
    assert refs["favorites"] == sorted([f"track_{saint.trackhash}", f"artist_{NEW_ARTIST}"])
    assert refs["scrobbles"] == [fistcuffs.trackhash]
    assert report["tracks"] == 2 and report["artists"] == 1

    # And a stream or scrobble that still asks with an old hash finds the track.
    from aivinnet.lib.name_cleanup import current_trackhash

    assert current_trackhash(OLD_SAINT) == saint.trackhash
    assert current_trackhash(saint.trackhash) == saint.trackhash


def test_the_second_start_finds_nothing_to_move(reference_db, tracks):
    from aivinnet.lib.name_cleanup import carry_cleaned_names

    _store_old_references()
    carry_cleaned_names(tracks)
    moved = _references()

    report = carry_cleaned_names(tracks)

    assert _references() == moved
    assert report == {"tracks": 0, "artists": 0, "collections": 0, "artist_images": 0}


def test_an_old_hash_another_track_still_holds_keeps_its_references(reference_db):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable
    from aivinnet.lib.name_cleanup import carry_cleaned_names

    # Two files with the same tags. One has a witness for its number (the file
    # name), so its title is cleaned; the other has none and keeps the number —
    # and with it the hash both shared until now. A reference to that hash is
    # still right where it is.
    old = create_hash("049 Saint Wenceslaus Theme", ALBUM, "Adam Sporka")
    cleaned = _track(1, "049 Saint Wenceslaus Theme", "Adam Sporka", "049 Saint Wenceslaus Theme.mp3", 1)
    kept = _track(2, "049 Saint Wenceslaus Theme", "Adam Sporka", "Saint (Live).mp3", 3)
    assert cleaned._legacyhash == old and kept.trackhash == old

    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(FavoritesTable).values(hash=f"track_{old}", type="track", timestamp=1, userid=1, extra={})
        )

    carry_cleaned_names([cleaned, kept])

    assert _references()["favorites"] == [f"track_{old}"]


def test_the_artist_keeps_its_picture(reference_db, tracks):
    from aivinnet.lib.artist_image import user_set_dir
    from aivinnet.lib.name_cleanup import carry_cleaned_names
    from aivinnet.settings import Paths

    paths = Paths()
    folder = paths.md_artist_img_path
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{OLD_ARTIST}.webp").write_bytes(b"picture")
    user_set_dir().mkdir(parents=True, exist_ok=True)
    (user_set_dir() / OLD_ARTIST).touch()

    try:
        carry_cleaned_names(tracks)

        assert (folder / f"{NEW_ARTIST}.webp").read_bytes() == b"picture"
        assert (user_set_dir() / NEW_ARTIST).exists()
    finally:
        for path in (
            folder / f"{OLD_ARTIST}.webp",
            folder / f"{NEW_ARTIST}.webp",
            user_set_dir() / OLD_ARTIST,
            user_set_dir() / NEW_ARTIST,
        ):
            path.unlink(missing_ok=True)


def test_a_database_error_does_not_stop_the_start(tracks, monkeypatch):
    from aivinnet.db.engine import DbEngine
    from aivinnet.lib.name_cleanup import carry_cleaned_names

    def broken(*_args, **_kwargs):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(DbEngine, "manager", broken)

    assert carry_cleaned_names(tracks)["tracks"] == 0


def test_a_single_keeps_its_album_name_and_its_old_hash():
    # A single: album and title are the same tag. The number comes off the
    # title only — the album keeps its tagged name (and with it its hash under
    # mergeAlbums), and the old trackhash is the one the previous code made.
    from aivinnet.config import UserConfig
    from aivinnet.db.utils import track_to_dataclass

    row = {
        "id": 6,
        "album": "01 - Intro",
        "albumartists": "Adam Sporka",
        "albumhash": create_hash("01 - Intro", FOLDER),
        "artists": "Adam Sporka",
        "bitrate": 320,
        "copyright": "",
        "date": 0,
        "disc": 1,
        "duration": 120,
        "filepath": f"{FOLDER}/01 - Intro.mp3",
        "folder": FOLDER,
        "genres": None,
        "last_mod": 1,
        "title": "01 - Intro",
        "track": 1,
        "trackhash": "",
        "extra": {},
        "lastplayed": 0,
        "playcount": 0,
        "playduration": 0,
    }
    track = track_to_dataclass(row, UserConfig())

    assert track.title == "Intro"
    assert track.album == "01 - Intro"
    assert track._legacyhash == create_hash("01 - Intro", "01 - Intro", "Adam Sporka")


def test_a_homepage_collection_follows_the_renamed_artist(reference_db, tracks):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import CollectionTable
    from aivinnet.lib.name_cleanup import carry_cleaned_names

    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(CollectionTable).values(
                name="Games",
                userid=1,
                items=[{"type": "artist", "hash": OLD_ARTIST}, {"type": "album", "hash": "a1b2c3d4e5f60718"}],
                extra={},
            )
        )

    try:
        report = carry_cleaned_names(tracks)

        with DbEngine.manager() as session:
            items = session.execute(select(CollectionTable.items)).scalars().all()
        assert items == [[{"type": "artist", "hash": NEW_ARTIST}, {"type": "album", "hash": "a1b2c3d4e5f60718"}]]
        assert report["collections"] == 1
    finally:
        with DbEngine.manager(commit=True) as session:
            session.execute(delete(CollectionTable))


def test_a_picture_the_owner_removed_under_the_new_name_does_not_come_back(reference_db, tracks):
    from aivinnet.lib.artist_image import user_set_dir
    from aivinnet.lib.name_cleanup import carry_cleaned_names
    from aivinnet.settings import Paths

    folder = Paths().md_artist_img_path
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{OLD_ARTIST}.webp").write_bytes(b"picture")
    user_set_dir().mkdir(parents=True, exist_ok=True)
    (user_set_dir() / NEW_ARTIST).touch()  # removed by hand under the new name

    try:
        carry_cleaned_names(tracks)
        assert not (folder / f"{NEW_ARTIST}.webp").exists()
    finally:
        for path in (folder / f"{OLD_ARTIST}.webp", folder / f"{NEW_ARTIST}.webp", user_set_dir() / NEW_ARTIST):
            path.unlink(missing_ok=True)


def test_a_not_interested_mark_follows_the_renamed_artist(reference_db, tracks):
    """A mark alone (no favourite, no collection) is reason enough to move (#531)."""
    from aivinnet.db.userdata import NotInterestedTable
    from aivinnet.lib.name_cleanup import carry_cleaned_names

    NotInterestedTable.add(1, "artist", OLD_ARTIST)
    try:
        carry_cleaned_names(tracks)

        assert NotInterestedTable.hashes(1) == {"artist": {NEW_ARTIST}}
    finally:
        # This fixture's cleanup knows nothing of the table.
        NotInterestedTable.remove(1, "artist", OLD_ARTIST)
        NotInterestedTable.remove(1, "artist", NEW_ARTIST)
