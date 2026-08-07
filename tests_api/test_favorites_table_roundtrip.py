"""
FavoritesTable against a real SQLite database, plus the schema repair.

Nothing in the suite touched `FavoritesTable` or the `/favorites` handlers, and
two user-scoping bugs lived there in plain sight (AivinNet-Client#435): `hash`
was globally unique, so the SECOND user to favorite an item got an IntegrityError
turned into HTTP 500, and `remove_item` deleted by hash alone, so one user's
"unfavorite" deleted everyone else's row. Both are invisible to a mocked test —
they are constraint and WHERE-clause behaviour — so these are round-trips: write
through the table's own API, read it back from SQL, assert what is stored.

The second half covers the startup repair that gives EXISTING databases the new
constraint. Its fixture builds the real pre-fix table: the DDL below was copied
out of the live server's `sqlite_master` before the fix, not invented here.
"""

import pytest
from sqlalchemy import create_engine, delete, insert, select

from aivinnet.db import create_all_tables
from aivinnet.db.engine import DbEngine
from aivinnet.db.userdata import FavoritesTable, UserTable
from aivinnet.migrations.favorites_unique_per_user import (
    repair_favorites_unique_constraint,
    unique_index_on_hash_alone,
)

TRACK = "1234567890abcdef"
OTHER_TRACK = "fedcba0987654321"


@pytest.fixture()
def favorites_db():
    """
    A real SQLite database with the real FavoritesTable, wiped between tests.

    `get_current_userid` is patched rather than faked through a JWT — the subject
    under test is the table, not auth — but it stays a *parameter* so the
    two-user cases can switch identity mid-test. Users 1 and 2 have to exist:
    `favorite.userid` is a foreign key and the engine runs with
    PRAGMA foreign_keys=ON.
    """
    from unittest.mock import patch

    create_all_tables()

    with DbEngine.manager(commit=True) as session:
        for uid, name in ((1, "fav-user-1"), (2, "fav-user-2")):
            exists = session.execute(select(UserTable.id).where(UserTable.id == uid)).first()
            if not exists:
                session.execute(insert(UserTable).values(id=uid, username=name, password="x", roles=[], extra={}))

    with patch("aivinnet.db.userdata.get_current_userid", return_value=1) as userid:
        yield userid

    with DbEngine.manager(commit=True) as session:
        session.execute(delete(FavoritesTable))


def _rows() -> list[tuple[str, int]]:
    """(hash, userid) of every stored favorite, read straight from SQL."""
    with DbEngine.manager() as session:
        result = session.execute(
            select(FavoritesTable.hash, FavoritesTable.userid).order_by(FavoritesTable.userid, FavoritesTable.hash)
        ).all()

    return [(row[0], row[1]) for row in result]


class TestTwoUsersOneItem:
    def test_both_users_can_favorite_the_same_item(self, favorites_db):
        # THE BUG: `hash` was globally unique, so this insert raised
        # IntegrityError and /favorites/add answered 500 for the second user.
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "extra": {}})

        favorites_db.return_value = 2
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "extra": {}})

        assert _rows() == [(f"track_{TRACK}", 1), (f"track_{TRACK}", 2)]

    def test_remove_only_deletes_the_callers_row(self, favorites_db):
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "extra": {}})

        favorites_db.return_value = 2
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "extra": {}})

        # THE OTHER BUG: the DELETE matched on hash alone, so user 2 unfavoriting
        # took user 1's row with it.
        FavoritesTable.remove_item({"hash": TRACK, "type": "track"})

        assert _rows() == [(f"track_{TRACK}", 1)]

    def test_check_exists_answers_for_the_current_user_only(self, favorites_db):
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "extra": {}})

        favorites_db.return_value = 2
        assert FavoritesTable.check_exists(TRACK, "track") is False

        favorites_db.return_value = 1
        assert FavoritesTable.check_exists(TRACK, "track") is True

    def test_the_home_card_counts_only_the_current_users_favorites(self, favorites_db):
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "extra": {}})

        favorites_db.return_value = 2
        assert FavoritesTable.count_tracks() == 0
        assert FavoritesTable.get_last_trackhash() is None

        FavoritesTable.insert_item({"hash": OTHER_TRACK, "type": "track", "extra": {}})
        assert FavoritesTable.count_tracks() == 1
        assert FavoritesTable.get_last_trackhash() == f"track_{OTHER_TRACK}"


class TestRepeatedAdd:
    def test_adding_twice_neither_raises_nor_duplicates(self, favorites_db):
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "extra": {}})
        # Must not raise: the client fires /favorites/add on every heart click and
        # shows the user an error for any non-2xx.
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "extra": {}})

        assert _rows() == [(f"track_{TRACK}", 1)]
        assert FavoritesTable.check_exists(TRACK, "track") is True

    def test_a_repeated_add_keeps_the_first_timestamp(self, favorites_db):
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "timestamp": 1000, "extra": {}})
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "timestamp": 2000, "extra": {}})

        with DbEngine.manager() as session:
            timestamps = [row[0] for row in session.execute(select(FavoritesTable.timestamp)).all()]

        assert timestamps == [1000]

    def test_removing_twice_is_harmless(self, favorites_db):
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "extra": {}})
        FavoritesTable.remove_item({"hash": TRACK, "type": "track"})
        FavoritesTable.remove_item({"hash": TRACK, "type": "track"})

        assert _rows() == []


class TestSameHashDifferentTypes:
    def test_an_album_and_a_track_with_the_same_hash_coexist(self, favorites_db):
        # The type prefix is what keeps these apart; the per-user constraint must
        # not have narrowed that.
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "extra": {}})
        FavoritesTable.insert_item({"hash": TRACK, "type": "album", "extra": {}})

        assert _rows() == [(f"album_{TRACK}", 1), (f"track_{TRACK}", 1)]

    def test_removing_one_type_leaves_the_other(self, favorites_db):
        FavoritesTable.insert_item({"hash": TRACK, "type": "track", "extra": {}})
        FavoritesTable.insert_item({"hash": TRACK, "type": "album", "extra": {}})

        FavoritesTable.remove_item({"hash": TRACK, "type": "album"})

        assert _rows() == [(f"track_{TRACK}", 1)]


# The `favorite` table exactly as it existed before this fix. Copied verbatim
# from the live server's sqlite_master, so the migration is exercised against
# the schema it will actually meet, not a tidied-up version of it.
LEGACY_SCHEMA = [
    """CREATE TABLE user (
        id INTEGER NOT NULL,
        image VARCHAR,
        password VARCHAR NOT NULL,
        username VARCHAR NOT NULL,
        roles JSON NOT NULL,
        extra JSON,
        PRIMARY KEY (id)
    )""",
    """CREATE TABLE favorite (
	id INTEGER NOT NULL,
	hash VARCHAR NOT NULL,
	type VARCHAR NOT NULL,
	timestamp INTEGER NOT NULL,
	userid INTEGER NOT NULL,
	extra JSON,
	PRIMARY KEY (id),
	UNIQUE (hash),
	FOREIGN KEY(userid) REFERENCES user (id) ON DELETE cascade
)""",
    "CREATE INDEX ix_favorite_timestamp ON favorite (timestamp)",
    "CREATE INDEX ix_favorite_userid ON favorite (userid)",
    "CREATE INDEX ix_favorite_type ON favorite (type)",
]

LEGACY_ROWS = [
    (1, "track_aaaaaaaaaaaaaaaa", "track", 1700000000, 1, '{"album": "abc"}'),
    (2, "album_bbbbbbbbbbbbbbbb", "album", 1700000001, 1, "{}"),
    (7, "artist_cccccccccccccccc", "artist", 1700000002, 2, "{}"),
]


def _swap_engine(path):
    """Point DbEngine at `path` and return the engine that was there before."""
    previous = DbEngine._engine
    DbEngine._engine = create_engine(f"sqlite+pysqlite:///{path}")

    return previous


def _restore_engine(previous):
    DbEngine._engine.dispose()
    DbEngine._engine = previous


def _schema_fingerprint(cursor, table: str = "favorite"):
    """
    Structural description of a table: columns, indexes, foreign keys.

    Compared instead of the raw DDL text so a rebuilt table and a `create_all`
    table can be shown to be the SAME table without depending on how either
    statement happened to be formatted.
    """
    columns = [(row[1], row[2], row[3], row[5]) for row in cursor.execute(f'PRAGMA table_info("{table}")')]

    indexes = []
    for row in cursor.execute(f'PRAGMA index_list("{table}")').fetchall():
        name, unique, origin = row[1], row[2], row[3]
        cols = [info[2] for info in cursor.execute(f'PRAGMA index_info("{name}")').fetchall()]
        # The implicit index names carry a counter, so only origin/uniqueness and
        # the columns are structural.
        indexes.append((origin, unique, tuple(cols)))

    foreign_keys = [(row[2], row[3], row[4], row[6]) for row in cursor.execute(f'PRAGMA foreign_key_list("{table}")')]

    return sorted(columns), sorted(indexes), sorted(foreign_keys)


@pytest.fixture()
def legacy_db(tmp_path):
    """
    A throwaway database carrying the OLD `favorite` schema and some rows.

    DbEngine is pointed at it for the duration of the test, because the repair
    works on whatever `DbEngine.engine` is — the same thing it will do on the
    live database at startup.
    """
    previous = _swap_engine(tmp_path / "legacy.db")

    raw = DbEngine.engine.raw_connection()
    cursor = raw.cursor()

    for statement in LEGACY_SCHEMA:
        cursor.execute(statement)

    cursor.execute("INSERT INTO user (id, username, password, roles) VALUES (1, 'a', 'x', '[]')")
    cursor.execute("INSERT INTO user (id, username, password, roles) VALUES (2, 'b', 'x', '[]')")
    cursor.executemany(
        "INSERT INTO favorite (id, hash, type, timestamp, userid, extra) VALUES (?,?,?,?,?,?)", LEGACY_ROWS
    )

    raw.commit()
    cursor.close()
    raw.close()

    try:
        yield tmp_path / "legacy.db"
    finally:
        _restore_engine(previous)


def _favorite_rows():
    raw = DbEngine.engine.raw_connection()
    try:
        return (
            raw.cursor().execute("SELECT id, hash, type, timestamp, userid, extra FROM favorite ORDER BY id").fetchall()
        )
    finally:
        raw.close()


class TestLegacyDatabaseRepair:
    def test_the_old_schema_is_recognised(self, legacy_db):
        raw = DbEngine.engine.raw_connection()
        try:
            assert unique_index_on_hash_alone(raw.cursor()) is not None
        finally:
            raw.close()

    def test_the_rebuild_replaces_the_constraint(self, legacy_db):
        report = repair_favorites_unique_constraint()

        assert report["rebuilt"] is True

        raw = DbEngine.engine.raw_connection()
        try:
            cursor = raw.cursor()
            assert unique_index_on_hash_alone(cursor) is None

            unique_columns = []
            for row in cursor.execute('PRAGMA index_list("favorite")').fetchall():
                if row[2]:
                    unique_columns.append([info[2] for info in cursor.execute(f'PRAGMA index_info("{row[1]}")')])

            assert ["hash", "userid"] in unique_columns
        finally:
            raw.close()

    def test_every_row_survives_unchanged(self, legacy_db):
        repair_favorites_unique_constraint()

        assert _favorite_rows() == LEGACY_ROWS

    def test_the_scratch_table_is_gone(self, legacy_db):
        repair_favorites_unique_constraint()

        raw = DbEngine.engine.raw_connection()
        try:
            names = [
                row[0] for row in raw.cursor().execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
            ]
        finally:
            raw.close()

        assert [name for name in names if name.startswith("_favorite")] == []

    def test_the_column_indexes_are_back(self, legacy_db):
        repair_favorites_unique_constraint()

        raw = DbEngine.engine.raw_connection()
        try:
            created = {
                row[1] for row in raw.cursor().execute('PRAGMA index_list("favorite")').fetchall() if row[3] == "c"
            }
        finally:
            raw.close()

        assert created == {"ix_favorite_type", "ix_favorite_timestamp", "ix_favorite_userid"}

    def test_a_second_run_does_nothing(self, legacy_db):
        repair_favorites_unique_constraint()
        before = _favorite_rows()

        # Idempotence is the whole reason this may run on every start.
        report = repair_favorites_unique_constraint()

        assert report == {"rebuilt": False, "rows": 0}
        assert _favorite_rows() == before

    def test_the_rebuilt_table_matches_what_create_all_builds(self, legacy_db, tmp_path):
        """
        The repair must land on exactly the schema a fresh install gets —
        otherwise old and new databases quietly diverge.
        """
        repair_favorites_unique_constraint()

        raw = DbEngine.engine.raw_connection()
        try:
            rebuilt = _schema_fingerprint(raw.cursor())
        finally:
            raw.close()

        previous = _swap_engine(tmp_path / "fresh.db")
        try:
            create_all_tables()
            raw = DbEngine.engine.raw_connection()
            try:
                fresh = _schema_fingerprint(raw.cursor())
            finally:
                raw.close()
        finally:
            _restore_engine(previous)

        assert rebuilt == fresh

    def test_after_the_rebuild_a_second_user_can_favorite_the_same_item(self, legacy_db):
        repair_favorites_unique_constraint()

        raw = DbEngine.engine.raw_connection()
        try:
            cursor = raw.cursor()
            # The exact insert that used to raise IntegrityError: user 2 wants
            # what user 1 already has.
            cursor.execute(
                "INSERT INTO favorite (hash, type, timestamp, userid, extra) VALUES (?,?,?,?,?)",
                ("track_aaaaaaaaaaaaaaaa", "track", 1700000003, 2, "{}"),
            )
            raw.commit()

            owners = cursor.execute(
                "SELECT userid FROM favorite WHERE hash = 'track_aaaaaaaaaaaaaaaa' ORDER BY userid"
            ).fetchall()
        finally:
            raw.close()

        assert owners == [(1,), (2,)]

    def test_the_same_user_still_cannot_hold_the_same_item_twice(self, legacy_db):
        import sqlite3

        repair_favorites_unique_constraint()

        raw = DbEngine.engine.raw_connection()
        try:
            with pytest.raises(sqlite3.IntegrityError):
                raw.cursor().execute(
                    "INSERT INTO favorite (hash, type, timestamp, userid, extra) VALUES (?,?,?,?,?)",
                    ("track_aaaaaaaaaaaaaaaa", "track", 1700000004, 1, "{}"),
                )
        finally:
            raw.close()


class TestAlreadyMigratedDatabase:
    def test_a_fresh_database_is_left_alone(self, favorites_db):
        """`create_all` already builds the new shape, so there is nothing to do."""
        assert repair_favorites_unique_constraint() == {"rebuilt": False, "rows": 0}
