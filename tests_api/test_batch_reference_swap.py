"""An album apply that swaps or shifts titles keeps every reference on its file (#296).

Against a real database: playlists, per-user favourites and scrobbles.
"""

from pathlib import Path

import pytest
from sqlalchemy import select
from test_reference_migration_db import (  # noqa: F401  (fixture, tests_api is on sys.path)
    _insert_favorite,
    _insert_playlist,
    _insert_scrobble,
    _playlists_by_name,
    reference_db,
)
from test_track_edit_db_lock import _tags


def _favorites(session):
    from aivinnet.db.userdata import FavoritesTable

    return sorted(session.execute(select(FavoritesTable.userid, FavoritesTable.hash)).all())


def _scrobbles(session):
    from aivinnet.db.userdata import ScrobbleTable

    rows = session.execute(select(ScrobbleTable.trackhash)).scalars().all()
    return {h: rows.count(h) for h in set(rows)}


def test_a_swap_moves_everything_at_once(reference_db):  # noqa: F811
    from aivinnet.db.engine import DbEngine
    from aivinnet.lib.reference_migration import migrate_track_references_many

    with DbEngine.manager(commit=True) as session:
        _insert_playlist(session, 1, "mix", ["a", "x", "b"], {"added_at": {"a": 10, "b": 20}})
        _insert_favorite(session, 1, "a")  # one of the two
        _insert_favorite(session, 2, "a")  # both
        _insert_favorite(session, 2, "b")
        for h in ("a", "a", "a", "b"):
            _insert_scrobble(session, 1, h)

    migrate_track_references_many({"a": "b", "b": "a"})

    with DbEngine.manager() as session:
        trackhashes, extra = _playlists_by_name(session)["mix"]
        assert trackhashes == ["b", "x", "a"]
        assert extra["added_at"] == {"b": 10, "a": 20}
        assert _favorites(session) == [(1, "track_b"), (2, "track_a"), (2, "track_b")]
        assert _scrobbles(session) == {"b": 3, "a": 1}


def test_a_shift_moves_every_reference_by_one(reference_db):  # noqa: F811
    from aivinnet.db.engine import DbEngine
    from aivinnet.lib.reference_migration import migrate_track_references_many

    with DbEngine.manager(commit=True) as session:
        _insert_playlist(session, 1, "album", ["t1", "t2", "t3"])
        _insert_favorite(session, 1, "t1")
        _insert_favorite(session, 1, "t3")

    migrate_track_references_many({"t1": "t2", "t2": "t3", "t3": "t4"})

    with DbEngine.manager() as session:
        assert _playlists_by_name(session)["album"][0] == ["t2", "t3", "t4"]
        assert _favorites(session) == [(1, "track_t2"), (1, "track_t4")]


# ----------------------------------------------- through the real tag edit


@pytest.fixture()
def titled_files(reference_db, tmp_path, monkeypatch):  # noqa: F811
    """Factory: files whose content is their title, indexed in DB and store, plus a playlist of all of them."""
    from aivinnet.config import UserConfig
    from aivinnet.db import create_all_tables
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable
    from aivinnet.db.utils import track_to_dataclass
    from aivinnet.lib import track_edit
    from aivinnet.store.tracks import TrackStore

    monkeypatch.setattr(track_edit, "get_tags", lambda filepath, config: _tags(filepath, Path(filepath).read_text()))
    monkeypatch.setattr(track_edit.tag_writer, "write_tags", lambda filepath, f: Path(filepath).write_text(f["title"]))
    monkeypatch.setattr(track_edit, "extract_thumb", lambda *a, **k: None)
    monkeypatch.setattr(track_edit, "_reconcile_album", lambda albumhash: None)
    monkeypatch.setattr(track_edit, "_reconcile_artist", lambda artisthash: None)
    monkeypatch.setattr(track_edit.FolderStore, "index_file", lambda *a: None)
    monkeypatch.setattr(TrackStore, "trackhashmap", {})
    create_all_tables()
    made: list[str] = []

    def live(path, title, row_id):
        row = {**_tags(path, title), "id": row_id, "lastplayed": 0, "playcount": 0, "playduration": 0}
        return track_to_dataclass(row, UserConfig())

    def make(*titles):
        paths, hashes = {}, {}
        for i, title in enumerate(titles, start=1):
            p = tmp_path / f"{i:02}.mp3"
            p.write_text(title)
            path = p.as_posix()
            paths[title] = path
            TrackTable.remove_tracks_by_filepaths({path})
            TrackTable.insert_one(_tags(path, title))
            track = live(path, title, i)
            TrackStore.add_track(track)
            hashes[title] = track.trackhash
            made.append(path)

        with DbEngine.manager(commit=True) as session:
            _insert_playlist(session, 1, "favs", [hashes[t] for t in titles])
        return paths, hashes

    yield make, live

    TrackTable.remove_tracks_by_filepaths(set(made))


@pytest.fixture()
def two_swapped_files(titled_files):
    from aivinnet.db.engine import DbEngine

    make, _live = titled_files
    paths, hashes = make("Sunrise", "Sunset")
    with DbEngine.manager(commit=True) as session:
        _insert_favorite(session, 1, hashes["Sunrise"])
        _insert_scrobble(session, 1, hashes["Sunrise"])
        _insert_scrobble(session, 1, hashes["Sunrise"])
        _insert_scrobble(session, 1, hashes["Sunset"])
    return paths, hashes


def test_swapping_two_titles_in_one_apply_keeps_both_playlist_entries(two_swapped_files):
    from aivinnet.db.engine import DbEngine
    from aivinnet.lib import track_edit

    paths, h = two_swapped_files
    batch = track_edit.ReferenceBatch(list(paths.values()))

    track_edit.edit_track_tags_by_filepath(paths["Sunrise"], {"title": "Sunset"}, batch)
    track_edit.edit_track_tags_by_filepath(paths["Sunset"], {"title": "Sunrise"}, batch)
    batch.finish()

    with DbEngine.manager() as session:
        # Each entry still plays the file it played before.
        assert _playlists_by_name(session)["favs"][0] == [h["Sunset"], h["Sunrise"]]
        assert _favorites(session) == [(1, "track_" + h["Sunset"])]
        assert _scrobbles(session) == {h["Sunset"]: 2, h["Sunrise"]: 1}


def test_an_edit_outside_a_chain_still_moves_its_references_at_once(two_swapped_files):
    """Only renames onto another batch file's hash wait; the rest stay atomic with their row."""
    from aivinnet.db.engine import DbEngine
    from aivinnet.lib import track_edit

    paths, h = two_swapped_files
    batch = track_edit.ReferenceBatch(list(paths.values()))

    edited = track_edit.edit_track_tags_by_filepath(paths["Sunrise"], {"title": "Dawn"}, batch)

    assert batch.pending == {}
    with DbEngine.manager() as session:
        assert _playlists_by_name(session)["favs"][0] == [edited.trackhash, h["Sunset"]]


def test_a_shift_by_one_through_the_real_edit(titled_files):
    """Titles 1,2,3 become 2,3,4: two renames wait for the batch, the last moves at once."""
    from aivinnet.db.engine import DbEngine
    from aivinnet.lib import track_edit

    make, live = titled_files
    paths, h = make("One", "Two", "Three")
    four = live("/x", "Four", 0).trackhash
    batch = track_edit.ReferenceBatch(list(paths.values()))

    for old, new in (("One", "Two"), ("Two", "Three"), ("Three", "Four")):
        track_edit.edit_track_tags_by_filepath(paths[old], {"title": new}, batch)
    assert batch.pending == {h["One"]: h["Two"], h["Two"]: h["Three"]}
    batch.finish()

    with DbEngine.manager() as session:
        # Every file keeps its place in the playlist under its new title.
        assert _playlists_by_name(session)["favs"][0] == [h["Two"], h["Three"], four]
