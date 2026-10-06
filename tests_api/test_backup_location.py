"""Backups made in the container live in the config volume (#296).

`~` is /root in the container, in the container's own layer: a backup made in
the UI vanished with the next `docker compose up -d` that recreated it.
"""

from types import SimpleNamespace

import pytest


@pytest.fixture()
def places(monkeypatch, tmp_path):
    from aivinnet.lib import backups

    home = tmp_path / "home"
    config = tmp_path / "config"
    home.mkdir()
    config.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))  # what expanduser reads on Windows
    monkeypatch.setattr(backups, "Paths", lambda: SimpleNamespace(config_parent=config))
    return backups, home / "aivinnet.backup", config / "aivinnet.backup"


def test_outside_a_container_backups_stay_in_the_home_directory(places, monkeypatch):
    backups, home_root, _config_root = places
    monkeypatch.delenv("AIVINNET_IN_CONTAINER", raising=False)

    assert backups.get_backup_root() == home_root


def test_in_the_container_backups_go_to_the_config_volume(places, monkeypatch):
    backups, _home_root, config_root = places
    monkeypatch.setenv("AIVINNET_IN_CONTAINER", "1")

    assert backups.get_backup_root() == config_root


def test_the_endpoints_use_the_same_root(places, monkeypatch):
    import aivinnet.api.backup_and_restore as api

    backups, _home_root, config_root = places
    monkeypatch.setenv("AIVINNET_IN_CONTAINER", "1")

    assert api.get_backup_root is backups.get_backup_root
    assert api.get_backup_root() == config_root


def test_backups_left_in_root_by_an_older_image_move_into_the_volume(places, monkeypatch):
    backups, home_root, config_root = places
    monkeypatch.setenv("AIVINNET_IN_CONTAINER", "1")
    (home_root / "backup.1").mkdir(parents=True)
    (home_root / "backup.1" / "data.json").write_text("old")
    (home_root / "backup.2").mkdir()
    (home_root / "backup.2" / "data.json").write_text("left in root")
    (config_root / "backup.2").mkdir(parents=True)
    (config_root / "backup.2" / "data.json").write_text("already in the volume")

    backups.adopt_container_backups()

    assert (config_root / "backup.1" / "data.json").read_text() == "old"
    assert not (home_root / "backup.1").exists()
    # Never overwritten — and the other copy is not thrown away either.
    assert (config_root / "backup.2" / "data.json").read_text() == "already in the volume"
    assert (home_root / "backup.2" / "data.json").read_text() == "left in root"


def test_nothing_moves_outside_a_container(places, monkeypatch):
    backups, home_root, config_root = places
    monkeypatch.delenv("AIVINNET_IN_CONTAINER", raising=False)
    (home_root / "backup.1").mkdir(parents=True)

    backups.adopt_container_backups()

    assert (home_root / "backup.1").exists()
    assert not config_root.exists()
