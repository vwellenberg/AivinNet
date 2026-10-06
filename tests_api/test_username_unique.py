"""Usernames are unique in the database, not only in the handlers (#296).

The repair renames duplicates — it never deletes or merges a user, whose
playlists, favourites and history hang off their id.
"""

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError


@pytest.fixture()
def old_database(tmp_path, monkeypatch):
    """A user table as older versions created it: a plain, non-unique index."""
    from aivinnet.db.engine import DbEngine

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE user (id INTEGER PRIMARY KEY, image VARCHAR, password VARCHAR NOT NULL, "
            "username VARCHAR NOT NULL, roles JSON NOT NULL, extra JSON, token_version INTEGER NOT NULL DEFAULT 0)"
        )
        conn.exec_driver_sql("CREATE INDEX ix_user_username ON user (username)")
        for userid, name in [(1, "admin"), (2, "vincent"), (3, "admin"), (4, "admin-3"), (5, "admin")]:
            conn.execute(
                text("INSERT INTO user (id, password, username, roles) VALUES (:i, 'x', :n, '[]')"),
                {"i": userid, "n": name},
            )
    monkeypatch.setattr(DbEngine, "_engine", engine)
    yield engine
    engine.dispose()


def _names(engine):
    with engine.connect() as conn:
        return dict(conn.execute(text("SELECT id, username FROM user ORDER BY id")).fetchall())


def test_duplicates_are_renamed_and_nobody_is_deleted(old_database):
    from aivinnet.migrations.username_unique import make_usernames_unique

    make_usernames_unique()

    names = _names(old_database)
    assert sorted(names) == [1, 2, 3, 4, 5], "a user was deleted"
    assert names[1] == "admin", "the oldest row keeps the name"
    assert names[2] == "vincent"
    assert names[4] == "admin-3", "an unrelated user was renamed"
    # 3 would become "admin-3", which user 4 already has.
    assert names[3] == "admin-3_"
    assert names[5] == "admin-5"
    assert len(set(names.values())) == 5


def test_afterwards_the_database_refuses_a_second_name(old_database):
    from aivinnet.migrations.username_unique import make_usernames_unique

    make_usernames_unique()

    with pytest.raises(IntegrityError), old_database.begin() as conn:
        conn.execute(text("INSERT INTO user (password, username, roles) VALUES ('x', 'vincent', '[]')"))


def test_a_second_start_changes_nothing(old_database):
    from aivinnet.migrations.username_unique import make_usernames_unique

    make_usernames_unique()
    before = _names(old_database)
    make_usernames_unique()

    assert _names(old_database) == before


def test_a_fresh_database_is_unique_from_the_model(tmp_path, monkeypatch):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import UserTable
    from aivinnet.migrations import username_unique

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'fresh.db'}")
    UserTable.metadata.create_all(engine, tables=[UserTable.__table__])
    monkeypatch.setattr(DbEngine, "_engine", engine)

    with DbEngine.manager() as session:
        assert username_unique._has_unique_username_index(session)
    engine.dispose()
