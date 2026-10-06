"""Album and artist favourites follow a tag edit (#296).

They are keyed by the album's / artist's hash, which a tag edit changes like a
track's. Retitling an album on its tracks left every user's favourite on a
hash that no longer existed: gone from Favorites, still in the count.
"""

import hashlib
import json
from pathlib import Path

import pytest
from sqlalchemy import insert, select
from test_reference_migration_db import reference_db  # noqa: F401  (fixture, tests_api is on sys.path)
from test_track_edit_db_lock import _tags


def _favorite(session, userid: int, hash_: str, type_: str):
    from aivinnet.db.userdata import FavoritesTable

    session.execute(insert(FavoritesTable).values(hash=hash_, type=type_, timestamp=1, userid=userid, extra={}))


def _favorites(session):
    from aivinnet.db.userdata import FavoritesTable

    return sorted(session.execute(select(FavoritesTable.userid, FavoritesTable.type, FavoritesTable.hash)).all())


def test_album_and_artist_favourites_move_per_user(reference_db):  # noqa: F811
    from aivinnet.db.engine import DbEngine
    from aivinnet.lib.reference_migration import migrate_item_favorites

    with DbEngine.manager(commit=True) as session:
        _favorite(session, 1, "old", "album")  # a row from before the prefix
        _favorite(session, 2, "album_old", "album")
        _favorite(session, 2, "album_new", "album")  # already has the new one
        _favorite(session, 1, "artist_old", "artist")
        _favorite(session, 1, "track_old", "track")  # another kind, same hash: untouched

    with DbEngine.manager(commit=True) as session:
        migrate_item_favorites("album", "old", "new", session)
        migrate_item_favorites("artist", "old", "new", session)

    with DbEngine.manager() as session:
        assert _favorites(session) == [
            (1, "album", "album_new"),
            (1, "artist", "artist_new"),
            (1, "track", "track_old"),
            (2, "album", "album_new"),
        ]


# ----------------------------------------------- through the real tag edit


@pytest.fixture()
def album_of_two(reference_db, tmp_path, monkeypatch):  # noqa: F811
    """Two files of one album; each file's content is its tags as JSON."""
    from aivinnet.config import UserConfig
    from aivinnet.db import create_all_tables
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable
    from aivinnet.db.utils import track_to_dataclass
    from aivinnet.lib import track_edit
    from aivinnet.store.albums import AlbumStore
    from aivinnet.store.artists import ArtistStore
    from aivinnet.store.tracks import TrackStore

    def tags_of(filepath):
        stored = json.loads(Path(filepath).read_text())
        # The album hash follows the album name, as the indexer's does.
        albumhash = hashlib.sha1(stored["album"].encode()).hexdigest()[:16]
        return {**_tags(filepath, stored["title"]), "album": stored["album"], "albumhash": albumhash}

    def write(filepath, fields):
        stored = json.loads(Path(filepath).read_text())
        Path(filepath).write_text(json.dumps({**stored, **fields}))

    monkeypatch.setattr(track_edit, "get_tags", lambda filepath, config: tags_of(filepath))
    monkeypatch.setattr(track_edit.tag_writer, "write_tags", write)
    monkeypatch.setattr(track_edit, "extract_thumb", lambda *a, **k: None)
    monkeypatch.setattr(track_edit, "_reconcile_artist", lambda artisthash: None)
    monkeypatch.setattr(track_edit.FolderStore, "index_file", lambda *a: None)
    monkeypatch.setattr(TrackStore, "trackhashmap", {})
    monkeypatch.setattr(AlbumStore, "albummap", {})
    monkeypatch.setattr(ArtistStore, "artistmap", {})
    create_all_tables()

    paths = []
    for i, title in enumerate(("Come Together", "Something"), start=1):
        p = tmp_path / f"{i:02}.mp3"
        p.write_text(json.dumps({"title": title, "album": "Abbey Road (Remastered)"}))
        path = p.as_posix()
        paths.append(path)
        TrackTable.remove_tracks_by_filepaths({path})
        TrackTable.insert_one(tags_of(path))
        row = {**tags_of(path), "id": i, "lastplayed": 0, "playcount": 0, "playduration": 0}
        TrackStore.add_track(track_to_dataclass(row, UserConfig()))

    old_albumhash = TrackStore.get_tracks_by_filepaths([paths[0]])[0].albumhash
    track_edit._reconcile_album(old_albumhash)
    AlbumStore.albummap[old_albumhash].album.fav_userids.append(1)
    with DbEngine.manager(commit=True) as session:
        _favorite(session, 1, f"album_{old_albumhash}", "album")

    yield paths, old_albumhash

    TrackTable.remove_tracks_by_filepaths(set(paths))


def test_the_album_favourite_moves_with_the_last_file(album_of_two):
    from aivinnet.db.engine import DbEngine
    from aivinnet.lib import track_edit
    from aivinnet.store.albums import AlbumStore

    paths, old = album_of_two

    first = track_edit.edit_track_tags_by_filepath(paths[0], {"album": "Abbey Road"})
    new = first.albumhash
    assert new != old
    with DbEngine.manager() as session:
        # One file still on the old album: it exists, and keeps its favourite.
        assert _favorites(session) == [(1, "album", f"album_{old}")]

    track_edit.edit_track_tags_by_filepath(paths[1], {"album": "Abbey Road"})

    with DbEngine.manager() as session:
        assert _favorites(session) == [(1, "album", f"album_{new}")]
    assert old not in AlbumStore.albummap
    assert AlbumStore.albummap[new].album.fav_userids == [1], "Favorites would not show it until a restart"
