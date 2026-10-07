"""A rescan drops only the rows it has evidence for (#391).

`filter_modded` read "this file cannot be stat'ed" as "this file was deleted",
and never asked whether the music folder itself was there. A NAS share that is
offline, a USB disk that is unplugged, a Docker bind mount that came up empty:
the next rescan deleted every track row of that folder, in one statement.

It also never asked whether a row was still in the library at all. A folder
removed from the settings, or added to the exclusions, kept all its tracks in
Albums, Artists and Search, because the files still existed and their mtime had
not changed.

And the delete bound one SQL variable per path. SQLite allows 32 766, so a
library above that whose paths all changed at once (a new mount point, a Docker
path) failed with `too many SQL variables` and kept every stale row.

These run the real `IndexTracks` over real folders against real SQLite.
"""

import os
import sqlite3
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, func, insert, select


def _row(filepath: str, last_mod: int) -> dict:
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
        "last_mod": last_mod,
        "title": filepath.rsplit("/", 1)[-1],
        "track": 1,
        "trackhash": "trackhash" + str(abs(hash(filepath)))[:7],
        "extra": {},
    }


@pytest.fixture()
def library(monkeypatch):
    """The real track table, emptied before and after, and a scan whose config the test sets."""
    from aivinnet.db import create_all_tables
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable
    from aivinnet.lib import tagger

    create_all_tables()

    def wipe():
        with DbEngine.manager(commit=True) as session:
            session.execute(delete(TrackTable))

    wipe()

    tagged: list[set[str]] = []
    monkeypatch.setattr(tagger.IndexTracks, "tag_untagged", lambda self, files: tagged.append(set(files)))
    monkeypatch.setattr(tagger.IndexTracks, "extract_thumb_with_overwrite", staticmethod(lambda tracks: None))

    class Library:
        def add(self, *paths: str):
            with DbEngine.manager(commit=True) as session:
                for path in paths:
                    mtime = round(os.path.getmtime(path)) if os.path.exists(path) else 1768785726
                    session.execute(insert(TrackTable).values(_row(path, mtime)))

        def paths(self) -> set[str]:
            with DbEngine.manager() as session:
                return set(session.execute(select(TrackTable.filepath)).scalars())

        def scan(self, roots: list[str], exclude: list[str] | None = None):
            config = SimpleNamespace(rootDirs=roots, excludeDirs=exclude or [])
            monkeypatch.setattr(tagger, "UserConfig", lambda: config)
            tagger.IndexTracks()

        tagged_files = tagged

    yield Library()
    wipe()


def _song(folder, name="01 Song.mp3"):
    folder.mkdir(parents=True, exist_ok=True)
    song = folder / name
    song.write_bytes(b"x")
    return song.resolve().as_posix()


def test_an_unreachable_music_folder_keeps_its_tracks(library, tmp_path):
    """The NAS is offline: the folder is gone, and so is every file under it."""
    share = (tmp_path / "nas" / "Music").as_posix()
    rows = [f"{share}/Artist/Album/0{n} Song.flac" for n in range(1, 4)]
    library.add(*rows)

    library.scan([share])

    assert library.paths() == set(rows)


def test_an_empty_mount_point_keeps_its_tracks(library, tmp_path):
    """The bind mount came up as an empty folder: present, but nothing in it."""
    mount = tmp_path / "music"
    mount.mkdir()
    rows = [f"{mount.resolve().as_posix()}/Artist/Album/01 Song.flac"]
    library.add(*rows)

    library.scan([str(mount)])

    assert library.paths() == set(rows)


def test_a_deleted_file_in_a_reachable_folder_is_still_dropped(library, tmp_path):
    root = tmp_path / "music"
    kept = _song(root / "Artist" / "Album")
    gone = f"{root.resolve().as_posix()}/Artist/Album/02 Deleted.mp3"
    library.add(kept, gone)

    library.scan([str(root)])

    assert library.paths() == {kept}


def test_one_offline_folder_does_not_protect_the_other(library, tmp_path):
    here = tmp_path / "local"
    kept = _song(here / "Album")
    gone = f"{here.resolve().as_posix()}/Album/02 Deleted.mp3"
    offline = f"{(tmp_path / 'usb').as_posix()}/Album/01 Song.mp3"
    library.add(kept, gone, offline)

    library.scan([str(here), str(tmp_path / "usb")])

    assert library.paths() == {kept, offline}


def test_a_folder_removed_from_the_settings_leaves_the_library(library, tmp_path):
    keep_root = tmp_path / "music"
    old_root = tmp_path / "old"
    kept = _song(keep_root / "Album")
    dropped = _song(old_root / "Album")
    library.add(kept, dropped)

    library.scan([str(keep_root)])

    assert library.paths() == {kept}


def test_an_excluded_folder_leaves_the_library(library, tmp_path):
    root = tmp_path / "music"
    kept = _song(root / "Albums" / "One")
    excluded = _song(root / "Podcasts" / "2026")
    library.add(kept, excluded)

    library.scan([str(root)], exclude=[str(root / "Podcasts")])

    assert library.paths() == {kept}


def test_a_sibling_with_the_same_prefix_is_not_inside_the_root(library, tmp_path):
    """`/music/Rock` is not a parent of `/music/Rock and Roll/...`."""
    rock = tmp_path / "Rock"
    kept = _song(rock / "Album")
    sibling = _song(tmp_path / "Rock and Roll" / "Album")
    library.add(kept, sibling)

    library.scan([str(rock)])

    assert library.paths() == {kept}


def test_rows_outside_every_root_wait_while_a_root_is_offline(library, tmp_path):
    """
    A row that matches no root may belong to the offline one under another
    spelling of its path. Out-of-scope pruning waits until every root answers.
    """
    here = tmp_path / "local"
    kept = _song(here / "Album")
    elsewhere = _song(tmp_path / "elsewhere" / "Album")
    library.add(kept, elsewhere)

    library.scan([str(here), str(tmp_path / "offline")])

    assert library.paths() == {kept, elsewhere}


def test_a_root_reached_through_a_symlink_keeps_its_tracks(library, tmp_path):
    """The scanner stores resolved paths; the root is compared in the same form."""
    real = tmp_path / "data" / "Music"
    kept = _song(real / "Album")
    link = tmp_path / "Music"
    link.symlink_to(real, target_is_directory=True)
    library.add(kept)

    library.scan([str(link)])

    assert library.paths() == {kept}
    assert library.tagged_files == [set()]


@pytest.fixture()
def sqlite_default_bind_limit():
    """
    SQLite's own default of 32 766 bound variables per statement.

    Debian and Ubuntu build SQLite with 250 000, so on those the bug never
    shows; the python.org build (Windows) and others keep the default. Pinned
    here so the test measures the same thing everywhere.
    """
    from sqlalchemy import event

    from aivinnet.db.engine import DbEngine

    def pin(dbapi_connection, _record):
        dbapi_connection.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 32_766)

    DbEngine.engine.dispose()
    event.listen(DbEngine.engine, "connect", pin)
    yield
    event.remove(DbEngine.engine, "connect", pin)
    DbEngine.engine.dispose()


def test_more_paths_than_sqlite_binds_in_one_statement(library, sqlite_default_bind_limit):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable

    paths = [f"/old-mount/Artist/Album {n // 20}/{n % 20:02} Song.mp3" for n in range(33_000)]
    with DbEngine.manager(commit=True) as session:
        session.execute(insert(TrackTable), [_row(p, 1768785726) for p in paths])

    TrackTable.remove_tracks_by_filepaths(set(paths))

    with DbEngine.manager() as session:
        assert session.execute(select(func.count()).select_from(TrackTable)).scalar() == 0


def test_a_symlinked_folder_outside_the_root_is_not_reindexed(library, tmp_path):
    """
    The scan stores the resolved path, which no root prefix matches. Judged by
    the prefix alone, its rows were dropped and tagged again on every scan.
    """
    root = tmp_path / "music"
    root.mkdir()
    elsewhere = tmp_path / "data" / "extra"
    kept = _song(elsewhere)
    (root / "extra").symlink_to(elsewhere, target_is_directory=True)
    library.add(kept)

    library.scan([str(root)])

    assert library.paths() == {kept}
    assert library.tagged_files == [set()]


def test_a_folder_that_cannot_be_listed_keeps_its_tracks(library, tmp_path, monkeypatch):
    """A stale NFS handle on one folder is not an empty folder."""
    import errno
    from pathlib import Path

    root = tmp_path / "music"
    kept = _song(root / "Local")
    stale = root.resolve() / "NFS"
    rows = [f"{stale.as_posix()}/Album/0{n} Song.flac" for n in range(1, 3)]
    stale.mkdir()
    library.add(kept, *rows)

    real_iterdir = Path.iterdir

    def iterdir(self):
        if self == stale:
            raise OSError(errno.ESTALE, "Stale file handle")
        return real_iterdir(self)

    monkeypatch.setattr(Path, "iterdir", iterdir)

    library.scan([str(root)])

    assert library.paths() == {kept, *rows}
