"""Pinning a playlist folder in the library sidebar (POST /playlistfolders/<id>/pin_unpin).

A pinned folder sits in the manually ordered zone at the top of the sidebar,
an unpinned one among the alphabetical rest. Folders were always "up top"
before the column existed, so both a new folder and an upgraded database start
pinned — an upgrade must not move anything on screen.
"""

import pytest
from sqlalchemy import create_engine, text


@pytest.fixture()
def folders_api(api_client):
    return api_client("aivinnet.api.playlistfolders")


def _create(api, name: str) -> dict:
    res = api.post("/playlistfolders", json={"name": name})
    assert res.status_code == 201
    return res.get_json()


def _listed(api, folder_id: int) -> dict:
    return next(f for f in api.get("/playlistfolders").get_json() if f["id"] == folder_id)


def test_a_new_folder_starts_pinned(folders_api):
    folder = _create(folders_api, "Chill")

    assert folder["pinned"] is True
    assert _listed(folders_api, folder["id"])["pinned"] is True


def test_the_toggle_unpins_and_pins_again_keeping_items_and_position(folders_api):
    folder = _create(folders_api, "Chill")
    folders_api.post("/playlistfolders/reorder", json={"positions": [{"id": folder["id"], "position": 7}]})
    folders_api.post("/playlistfolders/move", json={"playlist_id": 3, "folder_id": folder["id"]})

    res = folders_api.post(f"/playlistfolders/{folder['id']}/pin_unpin")
    assert res.status_code == 200
    assert res.get_json() == {"pinned": False}
    assert _listed(folders_api, folder["id"]) == {
        "id": folder["id"],
        "name": "Chill",
        "items": [3],
        "position": 7,
        "pinned": False,
    }

    assert folders_api.post(f"/playlistfolders/{folder['id']}/pin_unpin").get_json() == {"pinned": True}
    assert _listed(folders_api, folder["id"])["position"] == 7


def test_an_unknown_folder_is_404_and_nothing_changes(folders_api):
    folder = _create(folders_api, "Chill")

    assert folders_api.post("/playlistfolders/999/pin_unpin").status_code == 404
    assert _listed(folders_api, folder["id"])["pinned"] is True


def test_another_users_folder_is_404_and_stays_pinned(folders_api):
    folder = _create(folders_api, "Chill")

    folders_api.userid = 2
    assert folders_api.post(f"/playlistfolders/{folder['id']}/pin_unpin").status_code == 404

    folders_api.userid = 1
    assert _listed(folders_api, folder["id"])["pinned"] is True


def test_renaming_a_folder_leaves_its_pin_alone(folders_api):
    folder = _create(folders_api, "Chill")
    folders_api.post(f"/playlistfolders/{folder['id']}/pin_unpin")

    folders_api.put(f"/playlistfolders/{folder['id']}", json={"name": "Calm"})

    assert _listed(folders_api, folder["id"])["pinned"] is False


# --- databases from before the column -----------------------------------------


@pytest.fixture()
def old_database(tmp_path, monkeypatch):
    from aivinnet.db.engine import DbEngine

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE playlistfolder (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, userid INTEGER NOT NULL,"
            " items JSON, position INTEGER)"
        )
        conn.exec_driver_sql("INSERT INTO playlistfolder VALUES (1, 'Chill', 1, '[]', 0)")
    monkeypatch.setattr(DbEngine, "_engine", engine)
    yield engine
    engine.dispose()


def test_an_old_database_gets_the_column_with_every_folder_pinned_once(old_database):
    from aivinnet.migrations.playlistfolder_pinned import add_playlistfolder_pinned_column

    add_playlistfolder_pinned_column()
    add_playlistfolder_pinned_column()

    with old_database.connect() as conn:
        columns = [row[1] for row in conn.execute(text("PRAGMA table_info(playlistfolder)"))]
        assert columns.count("pinned") == 1
        # Pinned: where the folder was all along. An upgrade moves nothing.
        assert conn.execute(text("SELECT pinned FROM playlistfolder")).scalar() == 1


def test_the_migration_runs_before_anything_selects_the_table():
    """Same ordering trap as `token_version`: setup_sqlite must call it itself."""
    import inspect

    from aivinnet.setup import sqlite

    source = inspect.getsource(sqlite.setup_sqlite)
    assert "add_playlistfolder_pinned_column()" in source
    assert source.index("add_playlistfolder_pinned_column()") < source.index("UserTable.get_all()")
