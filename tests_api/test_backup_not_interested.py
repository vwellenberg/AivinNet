"""
"Not interested" marks (#531) in the backup (#564), through the real request
cycle: `POST /backup/create` -> wipe -> `POST /backup/restore`.

Without the section a restore onto a fresh install brought every hidden album
and artist back into "Never played" and "Artists you might like", and the list
under Settings -> Home came back empty.
"""

import json

import pytest
from sqlalchemy import delete

ALBUM = "a1b2c3d4e5f60718"
ARTIST = "0f1e2d3c4b5a6978"


@pytest.fixture()
def backups(api_client, monkeypatch, tmp_path):
    from aivinnet.api import auth, backup_and_restore

    root = tmp_path / "aivinnet.backup"
    monkeypatch.setattr(backup_and_restore, "get_backup_root", lambda: root)
    # `@admin_required()` reads `current_user` as a module global.
    monkeypatch.setattr(auth, "current_user", {"roles": ["admin"]})
    # The restoring user, as the restore's owner fallback sees it.
    monkeypatch.setattr(backup_and_restore, "get_current_userid", lambda: 1)
    # A restore reindexes the library; there is none here.
    monkeypatch.setattr(backup_and_restore, "index_everything", lambda: None)

    handle = api_client("aivinnet.api.backup_and_restore")
    handle.root = root
    return handle


def marks() -> list[tuple[int, str, str, int]]:
    from aivinnet.db.userdata import NotInterestedTable

    return sorted((m["userid"], m["type"], m["hash"], m["timestamp"]) for m in NotInterestedTable.everyone())


def wipe():
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import NotInterestedTable

    with DbEngine.manager(commit=True) as session:
        session.execute(delete(NotInterestedTable))


def test_every_users_marks_survive_backup_and_restore(backups):
    from aivinnet.db.userdata import NotInterestedTable

    NotInterestedTable.add(1, "album", ALBUM, timestamp=1_700_000_000)
    NotInterestedTable.add(2, "artist", ARTIST, timestamp=1_700_000_100)
    before = marks()

    res = backups.post("/backup/create")
    assert res.status_code == 200, res.text
    created = res.get_json()
    assert created["not_interested"] == 2

    listed = backups.get("/backup/list").get_json()["backups"]
    assert [b["not_interested"] for b in listed] == [2]

    wipe()
    assert marks() == []

    res = backups.post("/backup/restore", json={"backup_dir": created["name"]})
    assert res.status_code == 200, res.text
    assert res.get_json()["restored"]["not_interested"] == {"restored": 2, "skipped": 0, "discarded": 0}
    # Each under its owner, with its own date: the list is newest first.
    assert marks() == before

    # Twice is a no-op.
    res = backups.post("/backup/restore", json={"backup_dir": created["name"]})
    assert res.get_json()["restored"]["not_interested"] == {"restored": 0, "skipped": 2, "discarded": 0}
    assert marks() == before


def test_an_unknown_owner_falls_back_to_the_restoring_user(backups):
    from aivinnet.api.backup_and_restore import RestoreBackup

    report = RestoreBackup.restore_not_interested(
        object.__new__(RestoreBackup),
        [{"userid": 7, "type": "album", "hash": ALBUM, "timestamp": 1_700_000_000}],
    )

    assert report.restored == 1
    assert marks() == [(1, "album", ALBUM, 1_700_000_000)]


def test_a_backup_from_before_the_section_restores_as_before(backups):
    backup = backups.root / "backup.1700000000"
    backup.mkdir(parents=True)
    (backup / "data.json").write_text(json.dumps({"favorites": [], "scrobbles": [], "playlists": []}))

    res = backups.post("/backup/restore", json={"backup_dir": backup.name})

    assert res.status_code == 200, res.text
    assert res.get_json()["restored"]["not_interested"] == {"restored": 0, "skipped": 0, "discarded": 0}
    assert backups.get("/backup/list").get_json()["backups"][0]["not_interested"] == 0
    assert marks() == []
