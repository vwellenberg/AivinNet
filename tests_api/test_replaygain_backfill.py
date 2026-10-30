"""ReplayGain tags for rows indexed before tinytag 2 (#643).

A file is read again only when it changes, so the rows of an old library lack
the gain tags even where the files carry them. The backfill reads each such
file once, writes the tags into `extra` in the database and onto the loaded
track, and marks every row it read so the next start reads nothing.
"""

from types import SimpleNamespace

import pytest
from sqlalchemy import delete, insert, select

FRAME = b"\xff\xfb\x90\x00" + b"\x00" * 413


def _mp3(path, gain: str | None) -> str:
    from mutagen.id3 import ID3, TIT2, TXXX

    path.write_bytes(FRAME * 20)
    tags = ID3()
    tags.add(TIT2(encoding=3, text=["Song"]))
    if gain is not None:
        tags.add(TXXX(encoding=3, desc="REPLAYGAIN_TRACK_GAIN", text=[gain]))
        tags.add(TXXX(encoding=3, desc="REPLAYGAIN_TRACK_PEAK", text=["0.988"]))
    tags.save(str(path))
    return str(path)


def _row(filepath: str, extra: dict) -> dict:
    folder, name = filepath.rsplit("/", 1)
    return {
        "album": "Album",
        "albumartists": "Artist",
        "albumhash": "albumhash0000000",
        "artists": "Artist",
        "bitrate": 128,
        "copyright": "",
        "date": 1735689600,
        "disc": 1,
        "duration": 10,
        "filepath": filepath,
        "folder": folder,
        "genres": None,
        "last_mod": 1700000000,
        "title": name,
        "track": 1,
        "trackhash": "hash" + name,
        "extra": extra,
    }


def _insert(row: dict) -> int:
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable

    with DbEngine.manager(commit=True) as session:
        return session.execute(insert(TrackTable).values(row)).inserted_primary_key[0]


def _extras() -> dict[str, dict]:
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable

    with DbEngine.manager() as session:
        rows = session.execute(select(TrackTable.filepath, TrackTable.extra)).all()
    return {path.rsplit("/", 1)[1]: extra for path, extra in rows}


@pytest.fixture()
def tracks_db(playlist_db):
    from aivinnet.db import create_all_tables
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable

    create_all_tables()

    def wipe():
        with DbEngine.manager(commit=True) as session:
            session.execute(delete(TrackTable))

    wipe()
    yield
    wipe()


def test_the_backfill_reads_the_gain_into_db_and_store_once(tracks_db, tmp_path):
    from aivinnet.lib.replaygain import CHECKED_KEY, backfill

    tagged = _mp3(tmp_path / "tagged.mp3", "-6.54 dB")
    plain = _mp3(tmp_path / "plain.mp3", None)
    done = _mp3(tmp_path / "done.mp3", "-1.00 dB")

    live = []
    for path, extra in ((tagged, {"track_total": ["12"]}), (plain, {}), (done, {CHECKED_KEY: ["1"]})):
        rowid = _insert(_row(path, extra))
        live.append(SimpleNamespace(id=rowid, filepath=path, extra=extra))

    assert backfill(live) == 1

    rows = _extras()
    assert rows["tagged.mp3"] == {
        "track_total": ["12"],
        "replaygain_track_gain": ["-6.54 dB"],
        "replaygain_track_peak": ["0.988"],
        CHECKED_KEY: ["1"],
    }
    # Read, nothing found, marked: the next start does not read it again.
    assert rows["plain.mp3"] == {CHECKED_KEY: ["1"]}
    # Marked before: left alone, even though the file has a gain now.
    assert rows["done.mp3"] == {CHECKED_KEY: ["1"]}

    # The loaded tracks carry it at once; the client reads them, not the database.
    assert live[0].extra["replaygain_track_gain"] == ["-6.54 dB"]

    # A second run finds nothing to read.
    assert backfill(live) == 0


def test_a_file_that_cannot_be_read_is_not_marked(tracks_db, tmp_path):
    """Gone for now (an offline share): a later start tries again."""
    from aivinnet.lib.replaygain import backfill

    missing = str(tmp_path / "gone.mp3")
    rowid = _insert(_row(missing, {}))

    backfill([SimpleNamespace(id=rowid, filepath=missing, extra={})])

    assert _extras()["gone.mp3"] == {}


def test_a_shutdown_stops_it_before_writing(tracks_db, tmp_path, monkeypatch):
    from aivinnet.lib.replaygain import backfill
    from aivinnet.utils.shutdown import WRITERS

    path = _mp3(tmp_path / "late.mp3", "-3.00 dB")
    rowid = _insert(_row(path, {}))
    monkeypatch.setattr(WRITERS, "stopping", lambda: True)

    backfill([SimpleNamespace(id=rowid, filepath=path, extra={})])

    assert _extras()["late.mp3"] == {}


def test_the_indexer_marks_new_rows_and_keeps_their_gain(tmp_path):
    """New files are read with their gain already; the backfill must skip them."""
    from aivinnet.config import UserConfig
    from aivinnet.lib.replaygain import CHECKED_KEY
    from aivinnet.lib.taglib import get_tags

    path = _mp3(tmp_path / "new.mp3", "-4.20 dB")

    extra = get_tags(path, UserConfig())["extra"]

    assert extra["replaygain_track_gain"] == ["-4.20 dB"]
    assert extra[CHECKED_KEY] == ["1"]
