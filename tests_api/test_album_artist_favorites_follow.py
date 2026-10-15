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
        return {
            **_tags(filepath, stored["title"]),
            "album": stored["album"],
            "albumhash": albumhash,
            "artists": stored.get("artists", "Artist"),
            "albumartists": stored.get("albumartists", "Artist"),
        }

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


# ------------------------------------------------- Home's collection cards (#481)


def _collection(session, userid: int, items: list):
    from aivinnet.db.userdata import CollectionTable

    session.execute(insert(CollectionTable).values(name=f"Mine {userid}", userid=userid, items=items, extra={}))


def _collections(session):
    from aivinnet.db.userdata import CollectionTable

    return dict(session.execute(select(CollectionTable.userid, CollectionTable.items)).all())


@pytest.fixture()
def collections_db(album_of_two):
    from sqlalchemy import delete

    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import CollectionTable

    yield album_of_two

    with DbEngine.manager(commit=True) as session:
        session.execute(delete(CollectionTable))


def test_the_album_card_moves_with_the_last_file_for_every_user(collections_db):
    from aivinnet.db.engine import DbEngine
    from aivinnet.lib import track_edit

    paths, old = collections_db
    other = {"type": "album", "hash": "f00dfeedf00dfeed"}
    with DbEngine.manager(commit=True) as session:
        _collection(session, 1, [other, {"type": "album", "hash": old}])
        _collection(session, 2, [{"type": "album", "hash": old}])

    new = track_edit.edit_track_tags_by_filepath(paths[0], {"album": "Abbey Road"}).albumhash
    with DbEngine.manager() as session:
        # One file is still on the old album: the card still resolves, and stays.
        assert _collections(session) == {
            1: [other, {"type": "album", "hash": old}],
            2: [{"type": "album", "hash": old}],
        }

    track_edit.edit_track_tags_by_filepath(paths[1], {"album": "Abbey Road"})

    with DbEngine.manager() as session:
        assert _collections(session) == {
            1: [other, {"type": "album", "hash": new}],
            2: [{"type": "album", "hash": new}],
        }


def test_the_artist_card_moves_when_its_last_file_is_renamed(collections_db):
    from aivinnet.db.engine import DbEngine
    from aivinnet.lib import track_edit
    from aivinnet.utils.hashing import create_hash

    paths, _album = collections_db
    old, new = create_hash("Artist", decode=True), create_hash("The Artist", decode=True)
    with DbEngine.manager(commit=True) as session:
        _collection(session, 1, [{"type": "artist", "hash": old}])

    renamed = {"artists": "The Artist", "albumartists": "The Artist"}
    track_edit.edit_track_tags_by_filepath(paths[0], renamed)
    with DbEngine.manager() as session:
        # The second file still carries the old name: the artist exists.
        assert _collections(session) == {1: [{"type": "artist", "hash": old}]}

    track_edit.edit_track_tags_by_filepath(paths[1], renamed)

    with DbEngine.manager() as session:
        assert _collections(session) == {1: [{"type": "artist", "hash": new}]}


def test_a_collection_that_already_holds_the_new_album_keeps_one_card(collections_db):
    from aivinnet.db.engine import DbEngine
    from aivinnet.lib import track_edit

    paths, old = collections_db
    new = hashlib.sha1(b"Abbey Road").hexdigest()[:16]
    with DbEngine.manager(commit=True) as session:
        _collection(session, 1, [{"type": "album", "hash": new}, {"type": "album", "hash": old}])

    for path in paths:
        track_edit.edit_track_tags_by_filepath(path, {"album": "Abbey Road"})

    with DbEngine.manager() as session:
        assert _collections(session) == {1: [{"type": "album", "hash": new}]}


def test_the_album_pin_moves_with_the_last_file(collections_db):
    # Pinned to the sidebar is a favourite of its own type; it was left behind
    # the same way and the pin vanished from the sidebar.
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable
    from aivinnet.lib import track_edit

    paths, old = collections_db
    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(FavoritesTable).values(
                hash=f"pinned_album_{old}", type="pinned_album", timestamp=1, userid=1, extra={"position": 3}
            )
        )

    for path in paths:
        new = track_edit.edit_track_tags_by_filepath(path, {"album": "Abbey Road"}).albumhash

    with DbEngine.manager() as session:
        pins = session.execute(
            select(FavoritesTable.userid, FavoritesTable.hash, FavoritesTable.extra).where(
                FavoritesTable.type == "pinned_album"
            )
        ).all()
    assert pins == [(1, f"pinned_album_{new}", {"position": 3})]


def test_a_pin_is_not_mistaken_for_an_old_album_favourite(reference_db):  # noqa: F811
    # A legacy favourite row is the bare hash. The collision check matched
    # the hash alone, so an album favourite of the NEW album counted as an
    # existing pin of it, and the pin (with its sidebar position) was deleted.
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable
    from aivinnet.lib.reference_migration import migrate_identity_references

    with DbEngine.manager(commit=True) as session:
        _favorite(session, 1, "new", "album")  # legacy bare row
        session.execute(
            insert(FavoritesTable).values(
                hash="pinned_album_old", type="pinned_album", timestamp=1, userid=1, extra={"position": 3}
            )
        )

    with DbEngine.manager(commit=True) as session:
        migrate_identity_references("album", {"old": "new"}, session)

    with DbEngine.manager() as session:
        rows = sorted(session.execute(select(FavoritesTable.type, FavoritesTable.hash, FavoritesTable.extra)).all())
    assert rows == [("album", "new", {}), ("pinned_album", "pinned_album_new", {"position": 3})]
