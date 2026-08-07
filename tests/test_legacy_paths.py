"""The config-directory migration must never lose or overwrite user data.

This is the one piece of the swingmusic -> aivinnet rename that touches the
library itself: the database, the cover cache and the playlists live in
`~/.config/swingmusic/`. Every test here is about a way that could go wrong,
not about the happy path.
"""

import os
from pathlib import Path

import pytest

from aivinnet import legacy_paths


def make_install(root: Path, name: str, *, db: str | None = None, wal: bool = False) -> Path:
    """A config directory with a marker file and optionally a database."""
    config = root / name
    (config / "images").mkdir(parents=True)
    (config / "images" / "cover.webp").write_bytes(b"cover")

    if db:
        (config / db).write_bytes(b"sqlite-ish")
        if wal:
            (config / f"{db}-wal").write_bytes(b"wal")
            (config / f"{db}-shm").write_bytes(b"shm")

    return config


class TestResolveNames:
    """Resolution is what makes a failed migration harmless."""

    def test_fresh_install_uses_the_new_name(self, tmp_path):
        assert legacy_paths.resolve_config_dir_name(tmp_path, dotted=False) == "aivinnet"

    def test_legacy_only_keeps_the_legacy_name(self, tmp_path):
        make_install(tmp_path, "swingmusic")
        assert legacy_paths.resolve_config_dir_name(tmp_path, dotted=False) == "swingmusic"

    def test_new_wins_when_both_exist(self, tmp_path):
        make_install(tmp_path, "swingmusic")
        make_install(tmp_path, "aivinnet")
        assert legacy_paths.resolve_config_dir_name(tmp_path, dotted=False) == "aivinnet"

    def test_dotted_variant_is_handled(self, tmp_path):
        make_install(tmp_path, ".swingmusic")
        assert legacy_paths.resolve_config_dir_name(tmp_path, dotted=True) == ".swingmusic"
        assert legacy_paths.resolve_config_dir_name(tmp_path, dotted=False) == "aivinnet"

    def test_a_file_named_like_the_config_dir_is_not_mistaken_for_it(self, tmp_path):
        (tmp_path / "aivinnet").write_text("not a directory")
        make_install(tmp_path, "swingmusic")
        assert legacy_paths.resolve_config_dir_name(tmp_path, dotted=False) == "swingmusic"

    def test_db_name_resolution(self, tmp_path):
        config = make_install(tmp_path, "aivinnet")
        assert legacy_paths.resolve_db_name(config) == "aivinnet.db"

        (config / "swingmusic.db").write_bytes(b"old")
        assert legacy_paths.resolve_db_name(config) == "swingmusic.db"

        (config / "aivinnet.db").write_bytes(b"new")
        assert legacy_paths.resolve_db_name(config) == "aivinnet.db"


class TestMigrateConfigDir:
    def test_legacy_directory_is_moved_with_its_contents(self, tmp_path):
        make_install(tmp_path, "swingmusic")

        assert legacy_paths.migrate_config_dir(tmp_path, dotted=False) is True

        assert not (tmp_path / "swingmusic").exists()
        assert (tmp_path / "aivinnet" / "images" / "cover.webp").read_bytes() == b"cover"

    def test_nothing_happens_when_the_destination_exists(self, tmp_path):
        """The dangerous case: never merge or clobber an existing install."""
        make_install(tmp_path, "swingmusic")
        new = make_install(tmp_path, "aivinnet")
        (new / "images" / "cover.webp").write_bytes(b"newer cover")

        assert legacy_paths.migrate_config_dir(tmp_path, dotted=False) is False

        assert (tmp_path / "swingmusic" / "images" / "cover.webp").read_bytes() == b"cover"
        assert (new / "images" / "cover.webp").read_bytes() == b"newer cover"

    def test_fresh_install_is_a_no_op(self, tmp_path):
        assert legacy_paths.migrate_config_dir(tmp_path, dotted=False) is False
        assert not (tmp_path / "aivinnet").exists()

    def test_running_twice_is_safe(self, tmp_path):
        make_install(tmp_path, "swingmusic")

        assert legacy_paths.migrate_config_dir(tmp_path, dotted=False) is True
        assert legacy_paths.migrate_config_dir(tmp_path, dotted=False) is False

        assert (tmp_path / "aivinnet" / "images" / "cover.webp").read_bytes() == b"cover"

    def test_a_failed_move_leaves_the_data_reachable(self, tmp_path, monkeypatch):
        """The whole point of resolution: a failed rename must not lose data."""
        make_install(tmp_path, "swingmusic")

        def refuse(*args, **kwargs):
            raise PermissionError("nope")

        monkeypatch.setattr(os, "rename", refuse)

        assert legacy_paths.migrate_config_dir(tmp_path, dotted=False) is False
        assert (tmp_path / "swingmusic" / "images" / "cover.webp").exists()
        # And the app still finds it:
        assert legacy_paths.resolve_config_dir_name(tmp_path, dotted=False) == "swingmusic"


class TestMigrateDatabase:
    def test_database_and_wal_sidecars_move_together(self, tmp_path):
        config = make_install(tmp_path, "aivinnet", db="swingmusic.db", wal=True)

        assert legacy_paths.migrate_db_files(config) is True

        assert (config / "aivinnet.db").read_bytes() == b"sqlite-ish"
        assert (config / "aivinnet.db-wal").read_bytes() == b"wal"
        assert (config / "aivinnet.db-shm").read_bytes() == b"shm"
        assert not (config / "swingmusic.db").exists()
        assert not (config / "swingmusic.db-wal").exists()

    def test_database_without_sidecars(self, tmp_path):
        config = make_install(tmp_path, "aivinnet", db="swingmusic.db")

        assert legacy_paths.migrate_db_files(config) is True
        assert (config / "aivinnet.db").exists()

    def test_existing_new_database_is_never_overwritten(self, tmp_path):
        config = make_install(tmp_path, "aivinnet", db="swingmusic.db")
        (config / "aivinnet.db").write_bytes(b"the real one")

        assert legacy_paths.migrate_db_files(config) is False
        assert (config / "aivinnet.db").read_bytes() == b"the real one"
        assert (config / "swingmusic.db").exists()

    def test_a_failed_database_move_rolls_the_sidecars_back(self, tmp_path, monkeypatch):
        """A db without its WAL loses transactions — so a partial move is undone.

        The sidecars move first and the db last, so the failure being simulated
        here (db move fails after the WAL already moved) is exactly the window
        that would otherwise leave `swingmusic.db` next to `aivinnet.db-wal`:
        two names SQLite would never pair up.
        """
        config = make_install(tmp_path, "aivinnet", db="swingmusic.db", wal=True)
        real_rename = os.rename

        def fail_on_the_db(src, dst, *args, **kwargs):
            if str(src).endswith("swingmusic.db"):
                raise PermissionError("locked")
            return real_rename(src, dst, *args, **kwargs)

        monkeypatch.setattr(os, "rename", fail_on_the_db)

        assert legacy_paths.migrate_db_files(config) is False

        # Everything is back under the legacy base name, consistently.
        assert (config / "swingmusic.db").read_bytes() == b"sqlite-ish"
        assert (config / "swingmusic.db-wal").read_bytes() == b"wal"
        assert (config / "swingmusic.db-shm").read_bytes() == b"shm"
        assert not (config / "aivinnet.db-wal").exists()
        assert not (config / "aivinnet.db-shm").exists()

    def test_fresh_install_is_a_no_op(self, tmp_path):
        config = make_install(tmp_path, "aivinnet")
        assert legacy_paths.migrate_db_files(config) is False


def test_the_full_upgrade_path(tmp_path):
    """End to end: a pre-rename install comes up under the new names."""
    make_install(tmp_path, "swingmusic", db="swingmusic.db", wal=True)

    legacy_paths.migrate_config_dir(tmp_path, dotted=False)
    name = legacy_paths.resolve_config_dir_name(tmp_path, dotted=False)
    config = tmp_path / name
    legacy_paths.migrate_db_files(config)

    assert name == "aivinnet"
    assert legacy_paths.resolve_db_name(config) == "aivinnet.db"
    assert (config / "images" / "cover.webp").read_bytes() == b"cover"
    assert (config / "aivinnet.db-wal").exists()


@pytest.mark.parametrize("dotted,legacy,new", [(False, "swingmusic", "aivinnet"), (True, ".swingmusic", ".aivinnet")])
def test_both_layouts_migrate(tmp_path, dotted, legacy, new):
    make_install(tmp_path, legacy)

    assert legacy_paths.migrate_config_dir(tmp_path, dotted=dotted) is True
    assert (tmp_path / new / "images" / "cover.webp").exists()
