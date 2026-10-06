"""A half-read streamed result must not lock the database for the next writer.

Live from 2026-09-29 to 10-06, after the dependency refresh brought SQLAlchemy
2.1: favourites, scrobbles, device registration and pins failed now and then
with "database is locked", and a second click worked. A streamed (`yield_per`)
result that its caller stopped reading early kept its SQLite statement — a
read snapshot — open on the pooled connection. Once anything else had written,
the next writer handed that connection failed at once.
"""

import sqlite3

import pytest
from sqlalchemy import create_engine


@pytest.fixture
def one_connection(tmp_path, monkeypatch):
    """A pool of exactly ONE connection, so the write reuses the read's."""
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable
    from aivinnet.db.userdata import ScrobbleTable

    path = tmp_path / "lock.db"
    engine = create_engine(f"sqlite+pysqlite:///{path}", pool_size=1, max_overflow=0)
    ScrobbleTable.metadata.create_all(engine)
    TrackTable.metadata.create_all(engine)
    with engine.begin() as conn:  # scrobble.userid is a foreign key
        conn.exec_driver_sql("INSERT INTO user (id, username, password, roles, extra) VALUES (1, 'u', 'x', '[]', '{}')")
    monkeypatch.setattr(DbEngine, "_engine", engine)

    ScrobbleTable.insert_many(
        [
            {
                "trackhash": f"t{i}",
                "duration": 100,
                "timestamp": 1_700_000_000 + i,
                "source": "",
                "userid": 1,
                "extra": {},
            }
            for i in range(300)
        ]
    )
    yield path
    engine.dispose()


def _write_from_elsewhere(path):
    other = sqlite3.connect(path)
    other.execute(
        "INSERT INTO scrobble (trackhash, duration, timestamp, source, userid, extra) VALUES ('x', 10, 1, '', 1, '{}')"
    )
    other.commit()
    other.close()


def test_a_stream_read_partly_does_not_lock_the_next_write(one_connection):
    from aivinnet.db.userdata import ScrobbleTable

    rows = ScrobbleTable.get_all(0, None, userid=1)
    next(rows)  # a caller that only wanted the newest entry
    rows.close()

    _write_from_elsewhere(one_connection)

    ScrobbleTable.insert_one(
        {"trackhash": "mine", "duration": 100, "timestamp": 1_800_000_000, "source": "", "userid": 1, "extra": {}}
    )


def test_the_library_stream_read_partly_does_not_lock_either(one_connection):
    from aivinnet.db.libdata import TrackTable
    from aivinnet.db.userdata import ScrobbleTable

    tracks = TrackTable.get_all()
    next(tracks, None)
    tracks.close()

    _write_from_elsewhere(one_connection)

    ScrobbleTable.insert_one(
        {"trackhash": "mine2", "duration": 100, "timestamp": 1_800_000_001, "source": "", "userid": 1, "extra": {}}
    )
