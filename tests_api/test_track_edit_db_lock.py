"""A tag edit that hits a locked database must leave the track where it was.

Live on 2026-09-30: a batch edit of five KCD2 tracks met `database is locked`.
The edit swapped the track's row in two commits (DELETE, then INSERT) and the
reference repoint in a third. The lock landed between them, and the rollback,
which re-indexed the restored file with the same two commits, hit the same
lock. The DELETE had gone through each time, the INSERT never did: five tracks
gone from the library while their files sat untouched on disk, every playlist
showing them as orphans, until a manual rescan.

These tests fail the statement the lock failed (the track INSERT, the playlist
UPDATE) against a real database and check the edit leaves file, row, store and
playlist exactly as they were.
"""

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import event, insert, select


def _tags(filepath: str, title: str) -> dict:
    return {
        "album": "Album",
        "albumartists": "Artist",
        "albumhash": "albumhash0000000",
        "artists": "Artist",
        "bitrate": 192,
        "copyright": "",
        "date": 1735689600,
        "disc": 1,
        "duration": 148,
        "filepath": filepath,
        "folder": filepath.rsplit("/", 1)[0],
        "genres": None,
        "last_mod": 1768785726,
        "title": title,
        "track": 1,
        # What the DB holds may be a hash from the SHA1 era; the store derives
        # its own from title/album/artists. The tests use the store's.
        "trackhash": "stale-db-hash000",
        "extra": {},
    }


@pytest.fixture()
def library(playlist_db, tmp_path, monkeypatch):
    """One track in the DB, the store and a playlist; tags read from file content."""
    from aivinnet.config import UserConfig
    from aivinnet.db import create_all_tables
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable
    from aivinnet.db.utils import track_to_dataclass
    from aivinnet.lib import track_edit
    from aivinnet.store.tracks import TrackStore

    song = tmp_path / "song.mp3"
    song.write_bytes(b"ORIGINAL")
    path = song.as_posix()

    def fake_get_tags(filepath, config):
        edited = Path(filepath).read_bytes() == b"EDITED"
        return _tags(filepath, "New" if edited else "Old")

    monkeypatch.setattr(track_edit, "get_tags", fake_get_tags)
    monkeypatch.setattr(track_edit.tag_writer, "write_tags", lambda filepath, fields: song.write_bytes(b"EDITED"))
    monkeypatch.setattr(track_edit, "extract_thumb", lambda *a, **k: None)
    monkeypatch.setattr(track_edit, "_reconcile_album", lambda albumhash: None)
    monkeypatch.setattr(track_edit, "_reconcile_artist", lambda artisthash: None)
    monkeypatch.setattr(track_edit.FolderStore, "index_file", lambda *a: None)
    monkeypatch.setattr(TrackStore, "trackhashmap", {})

    # playlist_db created the tables of the models imported so far; `track` is new.
    create_all_tables()
    TrackTable.remove_tracks_by_filepaths({path})

    def live(title):
        row = {**_tags(path, title), "id": 1, "lastplayed": 0, "playcount": 0, "playduration": 0}
        return track_to_dataclass(row, UserConfig())

    TrackTable.insert_one(_tags(path, "Old"))
    original = live("Old")
    TrackStore.add_track(original)
    hashes = {"old": original.trackhash, "new": live("New").trackhash}

    PlaylistTable, _ = playlist_db
    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(PlaylistTable).values(
                name="kcd", last_updated=0, image=None, userid=1, settings={}, trackhashes=[hashes["old"]], extra={}
            )
        )

    yield path, hashes

    TrackTable.remove_tracks_by_filepaths({path})


@pytest.fixture()
def lock_on():
    """
    Another writer takes the lock just as the given statement runs, and keeps it.

    From that statement on every write fails, the rollback's included: that is
    what happened live, and a lock that politely lets the rollback through
    hides the bug.
    """
    from aivinnet.db.engine import DbEngine

    armed: list[str] = []
    held = False

    def before(conn, cursor, statement, parameters, context, executemany):
        nonlocal held
        if not armed:
            held = False
            return
        held = held or any(statement.startswith(prefix) for prefix in armed)
        if held and statement.startswith(("INSERT", "UPDATE", "DELETE")):
            raise sqlite3.OperationalError("database is locked")

    event.listen(DbEngine.engine, "before_cursor_execute", before)
    yield armed
    event.remove(DbEngine.engine, "before_cursor_execute", before)


def _state(path: str):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable
    from aivinnet.db.userdata import PlaylistTable
    from aivinnet.store.tracks import TrackStore

    with DbEngine.manager() as session:
        rows = session.execute(select(TrackTable.title).where(TrackTable.filepath == path)).scalars().all()
        playlist = session.execute(select(PlaylistTable.trackhashes).where(PlaylistTable.name == "kcd")).scalar()

    store = [t.trackhash for t in TrackStore.get_tracks_by_filepaths([path])]
    content = Path(path).read_bytes()
    return rows, store, playlist, content


@pytest.mark.parametrize(
    "locked_statement",
    [
        "INSERT INTO track",  # edits 2-5 of the incident: lost between DELETE and INSERT
        "UPDATE playlist",  # edit 1: row swapped, repoint failed, re-insert on rollback failed
    ],
)
def test_a_locked_database_leaves_the_track_where_it_was(library, lock_on, locked_statement):
    from aivinnet.lib import track_edit

    path, hashes = library
    lock_on.append(locked_statement)

    with pytest.raises(track_edit.TrackEditError, match="locked"):
        track_edit.edit_track_tags_by_filepath(path, {"title": "New"})

    assert _state(path) == (["Old"], [hashes["old"]], [hashes["old"]], b"ORIGINAL")
    assert not track_edit.os.path.exists(path + ".bak")


def test_once_the_lock_is_gone_the_same_edit_goes_through(library, lock_on):
    from aivinnet.lib import track_edit

    path, hashes = library
    lock_on.append("INSERT INTO track")
    with pytest.raises(track_edit.TrackEditError):
        track_edit.edit_track_tags_by_filepath(path, {"title": "New"})
    lock_on.clear()

    edited = track_edit.edit_track_tags_by_filepath(path, {"title": "New"})

    assert edited.trackhash == hashes["new"]
    assert _state(path) == (["New"], [hashes["new"]], [hashes["new"]], b"EDITED")
