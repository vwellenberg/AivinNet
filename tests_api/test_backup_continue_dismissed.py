"""
The ✕ on "Continue listening" (#776) survives a backup and restore, like the
"Not interested" marks (#564): every user's dismissals, each under its owner,
with its own stamp, and a restore of a backup from before the section stays as
it was.
"""

from sqlalchemy import delete
from test_backup_not_interested import backups  # noqa: F401 - the imported fixture

ALBUM = "a1b2c3d4e5f60718"
OTHER = "f0e1d2c3b4a59687"


def dismissals() -> list[tuple[int, str, str, int]]:
    from aivinnet.db.userdata import ContinueDismissTable

    return sorted((d["userid"], d["type"], d["hash"], d["timestamp"]) for d in ContinueDismissTable.everyone())


def wipe():
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import ContinueDismissTable

    with DbEngine.manager(commit=True) as session:
        session.execute(delete(ContinueDismissTable))


def test_every_users_dismissals_survive_backup_and_restore(backups):
    from aivinnet.db.userdata import ContinueDismissTable

    ContinueDismissTable.dismiss(1, "album", ALBUM, timestamp=1_700_000_000)
    ContinueDismissTable.dismiss(2, "playlist", OTHER, timestamp=1_700_000_100)
    before = dismissals()

    res = backups.post("/backup/create")
    assert res.status_code == 200, res.text
    created = res.get_json()
    assert created["continue_dismissed"] == 2

    listed = backups.get("/backup/list").get_json()["backups"]
    assert [b["continue_dismissed"] for b in listed] == [2]

    wipe()
    assert dismissals() == []

    res = backups.post("/backup/restore", json={"backup_dir": created["name"]})
    assert res.status_code == 200, res.text
    assert res.get_json()["restored"]["continue_dismissed"] == {"restored": 2, "skipped": 0, "discarded": 0}
    # The stamps come back as they were: an entry dismissed before the backup
    # stays hidden until its next play, whatever day the restore runs.
    assert dismissals() == before

    # Twice is a no-op.
    res = backups.post("/backup/restore", json={"backup_dir": created["name"]})
    assert res.get_json()["restored"]["continue_dismissed"] == {"restored": 0, "skipped": 2, "discarded": 0}
    assert dismissals() == before


def test_a_backup_from_before_the_section_restores_as_before(backups):
    import json

    backup = backups.root / "backup.1700000000"
    backup.mkdir(parents=True)
    (backup / "data.json").write_text(json.dumps({"favorites": [], "scrobbles": [], "playlists": []}))

    res = backups.post("/backup/restore", json={"backup_dir": backup.name})

    assert res.status_code == 200, res.text
    assert res.get_json()["restored"]["continue_dismissed"] == {"restored": 0, "skipped": 0, "discarded": 0}


def test_a_malformed_dismissal_is_discarded_not_fatal(backups):
    import json

    wipe()
    rows = [
        {"userid": 1, "type": "artist", "hash": ALBUM, "timestamp": 1},  # not a Continue type
        {"userid": 1, "type": "album", "timestamp": 1},  # no hash: used to raise KeyError
        {"userid": 1, "type": "album", "hash": ALBUM, "timestamp": "today"},
        "not a row",
        {"userid": 1, "type": "album", "hash": ALBUM, "timestamp": 1_700_000_000},
    ]
    backup = backups.root / "backup.1700000001"
    backup.mkdir(parents=True)
    (backup / "data.json").write_text(
        json.dumps({"favorites": [], "scrobbles": [], "playlists": [], "continue_dismissed": rows})
    )

    res = backups.post("/backup/restore", json={"backup_dir": backup.name})

    assert res.status_code == 200, res.text
    assert res.get_json()["restored"]["continue_dismissed"] == {"restored": 1, "skipped": 0, "discarded": 4}
    assert dismissals() == [(1, "album", ALBUM, 1_700_000_000)]
    wipe()
