"""Home rows on real scrobbles: what the code assumed and the data did not promise (#391).

- "Recently played" read the history in batches of 200 and treated the result
  as a list; it is a generator, so the loop never stopped early, and each batch
  was deduplicated on its own. Three albums on repeat showed as the same three
  cards over and over.
- A folder scrobble whose path cannot even be asked about (too long, a stale
  mount) raised from `Path.exists()`; inside the scrobble request that was a
  500 after the play was written.
- "Continue listening" counted a playlist's stored list, orphans included,
  so the last playable track was never "finished".
- Its second parse of a playlist id had no bounds; a source past SQLite's
  64-bit integer raised from the driver and that user's row went stale.
- "Recently added" labelled every known album "NEW ALBUM" and never said
  "NEW ARTIST", because it compared against stores that already held the
  new files; and an artist tag of only separators crashed it.
"""

from types import SimpleNamespace

import pytest
from sqlalchemy import delete, insert

ALBUMS = ["a1b2c3d4e5f60718", "b1b2c3d4e5f60718", "c1b2c3d4e5f60718"]


@pytest.fixture()
def history(playlist_db):
    """The real scrobble table, emptied before and after."""
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import ScrobbleTable

    def wipe():
        with DbEngine.manager(commit=True) as session:
            session.execute(delete(ScrobbleTable))

    wipe()

    def add(rows):
        with DbEngine.manager(commit=True) as session:
            session.execute(insert(ScrobbleTable), rows)

    yield add
    wipe()


def _play(n: int, source: str, trackhash: str = "t000000000000000", userid: int = 1) -> dict:
    return {
        "trackhash": trackhash,
        "duration": 200,
        "timestamp": 1_790_000_000 + n,
        "source": source,
        "userid": userid,
        "extra": {},
    }


def test_three_albums_on_repeat_are_three_cards(history, monkeypatch):
    from aivinnet.lib.home import create_items, get_recently_played

    history([_play(n, f"al:{ALBUMS[n % 3]}") for n in range(450)])
    monkeypatch.setattr(create_items.AlbumStore, "albummap", {h: object() for h in ALBUMS})

    items = get_recently_played.get_recently_played(15, userid=1)

    assert [i["hash"] for i in items] == [ALBUMS[449 % 3], ALBUMS[448 % 3], ALBUMS[447 % 3]]


def test_a_source_further_back_than_one_batch_is_still_found(history, monkeypatch):
    from aivinnet.lib.home import create_items, get_recently_played

    older = "d1b2c3d4e5f60718"
    history([_play(0, f"al:{older}")] + [_play(n, f"al:{ALBUMS[0]}") for n in range(1, 260)])
    monkeypatch.setattr(create_items.AlbumStore, "albummap", {h: object() for h in [*ALBUMS, older]})

    items = get_recently_played.get_recently_played(15, userid=1)

    assert [i["hash"] for i in items] == [ALBUMS[0], older]


def test_a_folder_that_cannot_be_asked_about_is_skipped():
    from aivinnet.lib.home.create_items import create_items
    from aivinnet.models.logger import TrackLog

    entries = [TrackLog(1, "t000000000000000", 200, 1_790_000_000, "fo:/" + "a" * 300 + "/", 1, {})]

    assert create_items(entries, 15, userid=1) == []


@pytest.fixture()
def playlist_with_orphan(playlist_db, monkeypatch):
    from aivinnet.lib.recipes import continuelistening

    table, _userid = playlist_db
    hashes = [f"t{n:015d}" for n in range(10)]
    monkeypatch.setattr(table, "get_trackhashes_of_user", classmethod(lambda cls, pid, userid: list(hashes)))
    # The tenth file was deleted: its hash stays in the playlist, not in the library.
    monkeypatch.setattr(continuelistening.TrackStore, "trackhashmap", {h: object() for h in hashes[:9]})
    return continuelistening, hashes


def test_the_last_playable_track_finishes_a_playlist(playlist_with_orphan):
    continuelistening, hashes = playlist_with_orphan

    tracklist = continuelistening._resolve_tracklist(1)("playlist", "7")

    assert tracklist == hashes[:9]


def test_a_playlist_id_past_sqlites_integer_resolves_to_nothing(playlist_db):
    from aivinnet.lib.recipes import continuelistening

    resolve = continuelistening._resolve_tracklist(1)

    assert resolve("playlist", "99999999999999999999") is None
    assert resolve("playlist", "0") is None


def _track(folder: str, last_mod: int, albumhash: str, artisthashes: list[str]):
    return SimpleNamespace(
        folder=folder,
        last_mod=last_mod,
        albumhash=albumhash,
        artisthashes=artisthashes,
        trackhash=f"t{last_mod:015d}",
    )


@pytest.fixture()
def recently_added(monkeypatch):
    from aivinnet.lib.home import recentlyadded
    from aivinnet.store.albums import AlbumMapEntry
    from aivinnet.store.artists import ArtistMapEntry

    # The real entry classes: the stores hold wrappers, not albums. A bare
    # stand-in with `created_date` kept this green while the built server
    # raised AttributeError in the smoke test.
    def stores(albums: dict[str, int], artists: dict[str, int]):
        monkeypatch.setattr(
            recentlyadded.AlbumStore,
            "albummap",
            {h: AlbumMapEntry(SimpleNamespace(created_date=d), set()) for h, d in albums.items()},
        )
        monkeypatch.setattr(
            recentlyadded.ArtistStore,
            "artistmap",
            {h: ArtistMapEntry(SimpleNamespace(created_date=d), set(), set()) for h, d in artists.items()},
        )

    return recentlyadded, stores


MONTHS_AGO = 1000 - 90 * 86_400


def test_a_new_album_is_new_and_a_bonus_track_is_not(recently_added):
    recentlyadded, stores = recently_added
    stores({"new": 1000, "old": MONTHS_AGO}, {"ar": MONTHS_AGO})
    new = [_track("/m/New", 1000 + n, "new", ["ar"]) for n in range(5)]
    bonus = [_track("/m/Old", 1000 + n, "old", ["ar"]) for n in range(5)]

    assert recentlyadded.check_folder_type({"folder": "/m/New", "tracks": new, "time": 1004})["help_text"] == (
        "NEW ALBUM"
    )
    assert recentlyadded.check_folder_type({"folder": "/m/Old", "tracks": bonus, "time": 1004})["help_text"] == (
        "NEW TRACKS"
    )


def test_a_new_artist_is_named_as_one(recently_added):
    recentlyadded, stores = recently_added
    # A folder of three albums by one artist: no album reaches 70 %, the artist does.
    stores({"x": 1000, "y": 1000, "z": 1000}, {"fresh": 1000, "known": MONTHS_AGO})
    tracks = [_track("/m/Fresh", 1000 + n, "xyz"[n % 3], ["fresh"]) for n in range(6)]
    known = [_track("/m/Known", 1000 + n, "xyz"[n % 3], ["known"]) for n in range(6)]

    assert recentlyadded.check_folder_type({"folder": "/m/Fresh", "tracks": tracks, "time": 1005})["help_text"] == (
        "NEW ARTIST"
    )
    assert recentlyadded.check_folder_type({"folder": "/m/Known", "tracks": known, "time": 1005})["help_text"] == (
        "NEW MUSIC"
    )


def test_tracks_whose_artist_tag_split_to_nothing_do_not_crash(recently_added):
    recentlyadded, stores = recently_added
    stores({}, {})
    # Two albums, so the album check passes on; the artist check then sees no hashes.
    tracks = [_track("/m/Blank", 1000 + n, f"al{n}", []) for n in range(2)]

    item = recentlyadded.check_folder_type({"folder": "/m/Blank", "tracks": tracks, "time": 1001})

    assert item is not None


def test_the_second_disc_of_a_new_album_is_still_new(recently_added):
    """CD1/ was copied a few minutes before CD2/; the album started with CD1."""
    recentlyadded, stores = recently_added
    stores({"new": 1000}, {"ar": 1000})
    cd2 = [_track("/m/Album/CD2", 1300 + n, "new", ["ar"]) for n in range(5)]

    assert recentlyadded.check_folder_type({"folder": "/m/Album/CD2", "tracks": cd2, "time": 1304})["help_text"] == (
        "NEW ALBUM"
    )


def test_the_last_scrobble_alone_never_reads_the_history(history, monkeypatch):
    """That path runs inside the scrobble request; the full refresh follows it."""
    from aivinnet.lib.home import create_items, get_recently_played
    from aivinnet.models.logger import TrackLog

    history([_play(n, f"al:{ALBUMS[0]}") for n in range(5)])
    monkeypatch.setattr(create_items.AlbumStore, "albummap", {h: object() for h in ALBUMS})
    monkeypatch.setattr(create_items.TrackStore, "trackhashmap", {})
    last = TrackLog(9, "t000000000000000", 200, 1_790_000_009, "tr:t000000000000000", 1, {})

    assert get_recently_played.get_recently_played(15, userid=1, _entries=[last]) == []
