"""A REAL scan carries a favourite across an external tag change (#433).

Unlike `test_rescan_carries_references.py`, nothing here is faked: the files are
written to a temporary library, the scanner reads them, the database is the
temporary one from `playlist_db`. The tag change is made with mutagen, the way an
external tagger makes it: the file keeps its path and gets a new title.

Nothing touches the live library.
"""

import os

import pytest
from sqlalchemy import delete, insert, select

FRAME = bytes([0xFF, 0xFB, 0x90, 0xC4]) + bytes(413)  # one silent MPEG-1 Layer III frame
ARTIST = "Test Artist"
ALBUM = "Throwaway Album"


def _write(path, title: str) -> None:
    from mutagen.id3 import ID3, TALB, TIT2, TPE1, TPE2

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(FRAME * 39)
    id3 = ID3()
    id3.add(TIT2(encoding=3, text=title))
    id3.add(TALB(encoding=3, text=ALBUM))
    id3.add(TPE1(encoding=3, text=ARTIST))
    id3.add(TPE2(encoding=3, text=ARTIST))
    id3.save(path)


def _retitle_from_outside(path, title: str) -> None:
    """What an external tagger does: rewrite the tag, keep the path, move the mtime on."""
    from mutagen.id3 import ID3, TIT2

    tags = ID3(path)
    tags.setall("TIT2", [TIT2(encoding=3, text=title)])
    tags.save(path)
    later = os.stat(path).st_mtime + 10
    os.utime(path, (later, later))


def _hash_of(path) -> str:
    from aivinnet.store.tracks import TrackStore

    # The scanner stores the POSIX form; `str()` has backslashes on Windows.
    (track,) = [t for t in TrackStore.get_flat_list() if t.filepath == path.as_posix()]
    return track.trackhash


@pytest.fixture()
def library(playlist_db, monkeypatch, tmp_path):
    import importlib

    from aivinnet.config import UserConfig
    from aivinnet.db import create_all_tables
    from aivinnet.store.tracks import TrackStore

    # The library table exists only once its module is imported (conftest._register_all_models).
    importlib.import_module("aivinnet.db.libdata")
    create_all_tables()

    root = tmp_path / "music"
    file = root / ARTIST / ALBUM / "01 - Old Title.mp3"
    _write(file, "Old Title")

    # The real config object, with only the library root pointed at the temp folder.
    monkeypatch.setattr(UserConfig(), "rootDirs", [str(root)])
    monkeypatch.setattr(UserConfig(), "excludeDirs", [])
    monkeypatch.setattr(TrackStore, "trackhashmap", {})

    yield file

    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable
    from aivinnet.db.userdata import FavoritesTable, ScrobbleTable

    with DbEngine.manager(commit=True) as session:
        session.execute(delete(TrackTable))
        session.execute(delete(FavoritesTable))
        session.execute(delete(ScrobbleTable))


def test_a_real_rescan_after_an_external_tag_change_keeps_the_favourite(library):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable, ScrobbleTable
    from aivinnet.lib import index

    index._index_everything()  # the first real scan
    old = _hash_of(library)

    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(FavoritesTable).values(hash=f"track_{old}", type="track", timestamp=1, userid=1, extra={})
        )
        session.execute(
            insert(ScrobbleTable).values(trackhash=old, duration=39, timestamp=2, source="al:x", userid=1, extra={})
        )

    _retitle_from_outside(library, "New Title")
    index._index_everything()  # the rescan after the outside change

    new = _hash_of(library)
    assert new != old, "the outside change did not change the hash: the premise of the test"

    with DbEngine.manager() as session:
        assert session.execute(select(FavoritesTable.hash)).scalars().all() == [f"track_{new}"]
        assert session.execute(select(ScrobbleTable.trackhash)).scalars().all() == [new]
