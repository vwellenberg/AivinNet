"""Path-traversal guard for the backup endpoints.

`DELETE /backup/delete` joined a client-supplied name onto the backup root and
handed the result straight to `shutil.rmtree`. `root / name` is not a
containment check: `"../.config/swingmusic"` walks out of the root, and an
ABSOLUTE name makes pathlib drop the root altogether (`Path("/a") / "/etc"` is
`/etc`). Admin-only, so no privilege escalation — but a one-liner that deletes
the server's own config (AivinNet-Client#437). `POST /backup/restore` had the
same unchecked join on the read side.

The whole filesystem here is a `tmp_path`; `get_backup_root` is monkeypatched so
no test can reach a real home directory. The victim directory lives NEXT TO the
backup root, exactly where `../` lands.
"""

import pytest


@pytest.fixture()
def backups(api_client, monkeypatch, tmp_path):
    """A backup root with one real backup, and a victim dir one level above it."""
    from aivinnet.api import auth, backup_and_restore

    root = tmp_path / "aivinnet.backup"
    (root / "backup.1700000000").mkdir(parents=True)
    victim = tmp_path / ".config"
    victim.mkdir()
    (victim / "important.txt").write_text("do not delete me")

    monkeypatch.setattr(backup_and_restore, "get_backup_root", lambda: root)
    # `@admin_required()` is applied at import time; the decorator body reads
    # `current_user` as a module global, so this is the only patchable seam.
    monkeypatch.setattr(auth, "current_user", {"roles": ["admin"]})

    handle = api_client("aivinnet.api.backup_and_restore")
    handle.root = root
    handle.victim = victim
    return handle


def _delete(api, name: str):
    return api.delete("/backup/delete", json={"backup_dir": name})


def _restore(api, name: str):
    return api.post("/backup/restore", json={"backup_dir": name})


# --- delete ------------------------------------------------------------------


def test_a_traversing_name_is_refused_and_deletes_nothing(backups):
    """THE bug: this used to rmtree the directory next to the backup root."""
    res = _delete(backups, "../.config")

    assert res.status_code == 400
    assert "Invalid backup name" in res.get_json()["msg"]
    assert backups.victim.exists()
    assert (backups.victim / "important.txt").read_text() == "do not delete me"


def test_a_deeper_traversal_is_refused(backups):
    res = _delete(backups, "backup.1700000000/../../.config")

    assert res.status_code == 400
    assert backups.victim.exists()


def test_an_absolute_name_is_refused(backups):
    """`root / "/abs"` discards the root — the join alone is no containment."""
    res = _delete(backups, str(backups.victim))

    assert res.status_code == 400
    assert backups.victim.exists()


@pytest.mark.parametrize("name", ["", "   ", ".", "..", "./"])
def test_a_name_that_resolves_to_the_root_or_above_is_refused(backups, name):
    res = _delete(backups, name)

    assert res.status_code == 400
    assert backups.root.exists()


def test_an_unknown_but_legal_name_is_still_a_404(backups):
    res = _delete(backups, "backup.9999999999")

    assert res.status_code == 404
    assert "not found" in res.get_json()["msg"]


def test_a_legal_name_really_deletes_that_backup(backups):
    res = _delete(backups, "backup.1700000000")

    assert res.status_code == 200
    assert not (backups.root / "backup.1700000000").exists()
    assert backups.root.exists(), "only the backup goes, not the root"


# --- restore -----------------------------------------------------------------


def test_restore_refuses_a_traversing_name(backups):
    res = _restore(backups, "../.config")

    assert res.status_code == 400
    assert "Invalid backup name" in res.get_json()["msg"]


def test_restore_refuses_an_absolute_name(backups):
    res = _restore(backups, str(backups.victim))

    assert res.status_code == 400


def test_restore_of_an_unknown_but_legal_name_is_a_404(backups):
    res = _restore(backups, "backup.9999999999")

    assert res.status_code == 404
