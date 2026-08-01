"""Tests for the migration that clears out the removed mixes feature's data."""

import sqlite3
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine


@pytest.fixture
def db(tmp_path):
    """A throwaway database with the two tables the migration touches."""
    path = tmp_path / "test.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE mix (id INTEGER PRIMARY KEY, mixid TEXT, title TEXT);
        CREATE TABLE scrobble (id INTEGER PRIMARY KEY, trackhash TEXT, source TEXT);
        """
    )
    conn.executemany(
        "INSERT INTO mix (mixid, title) VALUES (?, ?)",
        [("a1", "Frank Klepacki Radio"), ("a2", "The Blues Brothers Radio")],
    )
    conn.executemany(
        "INSERT INTO scrobble (trackhash, source) VALUES (?, ?)",
        [
            ("t1", "mix:a1.deadbeef"),
            ("t2", "pl:22"),
            ("t3", "mix:a2.cafebabe"),
            ("t4", "favorite"),
        ],
    )
    conn.commit()
    conn.close()
    return path


def run_against(path):
    """Point the migration at a real sqlite file and run it."""
    engine = create_engine(f"sqlite+pysqlite:///{path}")

    class FakeManager:
        def __init__(self, commit=False):
            self.commit = commit

        def __enter__(self):
            self.conn = engine.connect()
            return self.conn

        def __exit__(self, *exc):
            if self.commit:
                self.conn.commit()
            self.conn.close()

    with patch("swingmusic.db.engine.DbEngine.manager", FakeManager):
        from swingmusic.migrations.drop_mixes import drop_mix_data

        return drop_mix_data()


def rows(path, sql):
    conn = sqlite3.connect(path)
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


class TestDropMixData:
    def test_drops_the_mix_table(self, db):
        report = run_against(db)

        assert report["mixes"] == 2
        assert rows(db, "SELECT name FROM sqlite_master WHERE name = 'mix'") == []

    def test_unlabels_mix_scrobbles_but_keeps_the_rows(self, db):
        # The play happened. Only the label saying where it came from is now
        # meaningless — deleting the row would falsify listening history.
        report = run_against(db)

        assert report["scrobbles_unlabelled"] == 2
        assert len(rows(db, "SELECT id FROM scrobble")) == 4
        assert rows(db, "SELECT source FROM scrobble ORDER BY id") == [("",), ("pl:22",), ("",), ("favorite",)]

    def test_leaves_other_sources_alone(self, db):
        run_against(db)

        assert rows(db, "SELECT COUNT(*) FROM scrobble WHERE source = 'pl:22'") == [(1,)]
        assert rows(db, "SELECT COUNT(*) FROM scrobble WHERE source = 'favorite'") == [(1,)]

    def test_is_safe_to_run_twice(self, db):
        run_against(db)
        second = run_against(db)

        assert second == {"mixes": 0, "scrobbles_unlabelled": 0}

    def test_survives_a_database_that_never_had_the_table(self, tmp_path):
        path = tmp_path / "fresh.db"
        conn = sqlite3.connect(path)
        conn.execute("CREATE TABLE scrobble (id INTEGER PRIMARY KEY, source TEXT)")
        conn.commit()
        conn.close()

        assert run_against(path) == {"mixes": 0, "scrobbles_unlabelled": 0}
