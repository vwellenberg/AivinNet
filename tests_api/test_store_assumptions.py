"""The derived stores, built from real tracks: what they assumed and nothing promised (#391).

- `create_artists` stored the first track's own `genres` list as the artist's
  and extended it in place: every artist of that track got every other
  artist's genres, and the track's own genres grew with each rebuild.
- It also marked album-artist dicts `in_track = False` ON THE TRACK, and the
  track went to the client with that key in its album artists.
- Rebuilding one artist (`create_artists([hash])`, after a tag edit) selected
  only tracks the artist PERFORMS on; albums where they are only the album
  artist (a soundtrack, a compilation) dropped off the artist page.
- `map_scrobble_data` ran at startup outside a request, where the user falls
  back to 1: after every restart the play counts held user 1's plays only.
- The folder search index was cached by the NUMBER of files, so a renamed
  folder of N files (N out, N in) kept answering with the old name.
"""

import pytest
from sqlalchemy import delete, insert

T0 = 1_790_000_000


def _track(n: int, artists: str, albumartists: str, album: str, genres: str | None = None):
    from aivinnet.config import UserConfig
    from aivinnet.db.utils import track_to_dataclass
    from aivinnet.utils.hashing import create_hash

    row = {
        "id": n,
        "album": album,
        "albumartists": albumartists,
        # What the indexer stores: one hash per album (title + album artists).
        "albumhash": create_hash(album, *albumartists.split(";")),
        "artists": artists,
        "bitrate": 320,
        "copyright": "",
        "date": T0,
        "disc": 1,
        "duration": 100,
        "filepath": f"/music/{album}/{n:02} Song {n}.mp3",
        "folder": f"/music/{album}",
        "genres": genres,
        "last_mod": T0 + n,
        "title": f"Song {n}",
        "track": n,
        "trackhash": "",
        "extra": {},
        "lastplayed": 0,
        "playcount": 0,
        "playduration": 0,
    }
    return track_to_dataclass(row, UserConfig())


@pytest.fixture()
def library(monkeypatch):
    from aivinnet.store.tracks import TrackGroup, TrackStore

    def load(*tracks):
        groups: dict = {}
        for t in tracks:
            groups.setdefault(t.trackhash, TrackGroup([])).append(t)
        monkeypatch.setattr(TrackStore, "trackhashmap", groups)
        return tracks

    return load


def _by_name(results):
    return {artist.name: (artist, trackhashes, albumhashes) for artist, trackhashes, albumhashes in results}


def _genres(artist):
    return sorted(g["name"] for g in artist.genres)


def test_each_artist_keeps_only_the_genres_of_their_own_tracks(library):
    from aivinnet.lib.tagger import create_artists

    t1, _, _ = library(
        _track(1, "Ann;Bob", "Ann", "First", "pop"),
        _track(2, "Ann", "Ann", "Second", "rock"),
        _track(3, "Bob", "Bob", "Third", "jazz"),
    )

    artists = _by_name(create_artists([]))

    assert _genres(artists["Ann"][0]) == ["pop", "rock"]
    assert _genres(artists["Bob"][0]) == ["jazz", "pop"]
    assert [g["name"] for g in t1.genres] == ["pop"]


def test_building_artists_leaves_the_tracks_alone(library):
    """The album-artist entries are the track's own dicts, sent to the client as they are."""
    from aivinnet.lib.tagger import create_artists

    (_, soundtrack) = library(_track(1, "Ann", "Ann", "Own Album"), _track(2, "Bob", "Ann", "Soundtrack"))
    before = [dict(a) for a in soundtrack.albumartists]

    create_artists([])

    assert soundtrack.albumartists == before


def test_rebuilding_one_artist_keeps_the_albums_they_are_only_album_artist_of(library):
    from aivinnet.lib.tagger import create_artists

    library(
        _track(1, "Ann", "Ann", "Own Album"),
        _track(2, "Bob", "Ann", "Soundtrack"),
        _track(3, "Cid", "Ann", "Soundtrack"),
    )
    full = _by_name(create_artists([]))["Ann"]
    artisthash = full[0].artisthash

    one = next(r for r in create_artists([artisthash]) if r[0].artisthash == artisthash)

    assert one[2] == full[2]
    assert (one[0].albumcount, one[0].duration) == (full[0].albumcount, full[0].duration) == (2, 300)


@pytest.fixture()
def plays(playlist_db, monkeypatch):
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


def test_play_counts_after_a_restart_hold_every_users_plays(plays, library, monkeypatch):
    from aivinnet.lib import mapstuff

    (track,) = library(_track(1, "Ann", "Ann", "First"))
    monkeypatch.setattr(mapstuff.AlbumStore, "albummap", {})
    monkeypatch.setattr(mapstuff.ArtistStore, "artistmap", {})

    plays(
        [
            {
                "trackhash": track.trackhash,
                "duration": 100,
                "timestamp": T0 + n,
                "source": "",
                "userid": uid,
                "extra": {},
            }
            for n, uid in enumerate([1, 1, 2])
        ]
    )

    mapstuff.map_scrobble_data()

    assert (track.playcount, track.playduration, track.lastplayed) == (3, 300, T0 + 2)


def test_the_folder_search_follows_a_renamed_folder(monkeypatch):
    from types import SimpleNamespace

    from sortedcontainers import SortedSet

    from aivinnet.db.libdata import TrackTable
    from aivinnet.store.folder import FolderStore

    def _row(path):
        return SimpleNamespace(filepath=path, trackhash="h" + path)

    monkeypatch.setattr(FolderStore, "_resolve_root_dirs", staticmethod(lambda: ["/music"]))
    monkeypatch.setattr(FolderStore, "map", {})
    monkeypatch.setattr(FolderStore, "filepaths", SortedSet(["/music/Old Name/1.mp3", "/music/Old Name/2.mp3"]))
    monkeypatch.setattr(FolderStore, "_folder_index", [])
    assert [name for name, _ in FolderStore.get_folder_index()] == ["Old Name"]

    # A rescan after the rename: two files out, two in, the same count.
    monkeypatch.setattr(
        TrackTable, "get_all", lambda: iter([_row("/music/New Name/1.mp3"), _row("/music/New Name/2.mp3")])
    )
    FolderStore.load_filepaths()

    assert [name for name, _ in FolderStore.get_folder_index()] == ["New Name"]


def test_a_file_indexed_by_an_edit_reaches_the_folder_search(monkeypatch):
    from sortedcontainers import SortedSet

    from aivinnet.store.folder import FolderStore

    monkeypatch.setattr(FolderStore, "_resolve_root_dirs", staticmethod(lambda: ["/music"]))
    monkeypatch.setattr(FolderStore, "filepaths", SortedSet(["/music/A/1.mp3"]))
    monkeypatch.setattr(FolderStore, "map", {})
    monkeypatch.setattr(FolderStore, "_folder_index", [])
    FolderStore.get_folder_index()

    FolderStore.move_filepath("/music/A/1.mp3", "/music/B/1.mp3", "hash")

    assert [name for name, _ in FolderStore.get_folder_index()] == ["B"]


def test_an_album_was_last_played_when_its_newest_play_was(plays, library, monkeypatch):
    """Not when the track the aggregate happens to visit last was played."""
    from types import SimpleNamespace

    from aivinnet.lib import mapstuff
    from aivinnet.store.albums import AlbumMapEntry
    from aivinnet.store.artists import ArtistMapEntry

    tracks = library(_track(1, "Ann", "Ann", "First"), _track(2, "Ann", "Ann", "First"))
    # The newest play on the track that comes FIRST in hash order, so a
    # last-visited-wins update ends on the older one.
    newest, older = sorted(tracks, key=lambda t: t.trackhash)
    album = SimpleNamespace(lastplayed=0, playduration=0, playcount=0)
    artist = SimpleNamespace(lastplayed=0, playduration=0, playcount=0)
    monkeypatch.setattr(mapstuff.AlbumStore, "albummap", {newest.albumhash: AlbumMapEntry(album, set())})
    monkeypatch.setattr(
        mapstuff.ArtistStore, "artistmap", {h: ArtistMapEntry(artist, set(), set()) for h in newest.artisthashes}
    )
    plays(
        [
            {
                "trackhash": newest.trackhash,
                "duration": 100,
                "timestamp": T0 + 500,
                "source": "",
                "userid": 1,
                "extra": {},
            },
            {"trackhash": older.trackhash, "duration": 100, "timestamp": T0, "source": "", "userid": 1, "extra": {}},
        ]
    )

    mapstuff.map_scrobble_data()

    assert (album.lastplayed, artist.lastplayed) == (T0 + 500, T0 + 500)
