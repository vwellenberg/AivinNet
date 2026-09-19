"""The log directory lives under the new name, and old logs come along (#191).

`setup_logger()` still wrote to `<config>/swingmusic/logs` after the
swingmusic -> aivinnet rename, so every fresh install grew a `swingmusic`
folder in the middle of its data directory. The move of existing logs follows
the rules of `legacy_paths`: never overwrite, and a failed move must not keep
the logger (and with it the app) from starting.
"""

import logging.config
import os
from pathlib import Path

import pytest

from aivinnet import logger


@pytest.fixture
def run_setup(monkeypatch):
    """Call setup_logger() without reconfiguring the real logging tree.

    Returns the file the log handler would write to.
    """
    monkeypatch.setattr(logging.config, "dictConfig", lambda config: None)
    monkeypatch.setitem(logger.CONFIG["handlers"]["file"], "filename", None)

    def run(app_dir: Path) -> Path:
        logger.setup_logger(app_dir=app_dir)
        return Path(logger.CONFIG["handlers"]["file"]["filename"])

    return run


def legacy_log(app_dir: Path, content: bytes = b'{"old": true}\n') -> Path:
    log_file = app_dir / "swingmusic" / "logs" / "log.jsonl"
    log_file.parent.mkdir(parents=True)
    log_file.write_bytes(content)
    return log_file


def test_fresh_install_logs_under_the_new_name(tmp_path, run_setup):
    log_file = run_setup(tmp_path)

    assert log_file == tmp_path / "aivinnet" / "logs" / "log.jsonl"
    assert log_file.parent.is_dir()
    assert not (tmp_path / "swingmusic").exists()


def test_existing_logs_are_moved(tmp_path, run_setup):
    legacy_log(tmp_path)

    log_file = run_setup(tmp_path)

    assert log_file == tmp_path / "aivinnet" / "logs" / "log.jsonl"
    assert log_file.read_bytes() == b'{"old": true}\n'
    assert not (tmp_path / "swingmusic").exists()


def test_an_existing_target_is_never_overwritten(tmp_path, run_setup):
    old = legacy_log(tmp_path, b"old\n")
    new = tmp_path / "aivinnet" / "logs" / "log.jsonl"
    new.parent.mkdir(parents=True)
    new.write_bytes(b"new\n")

    log_file = run_setup(tmp_path)

    assert log_file == new
    assert new.read_bytes() == b"new\n"
    assert old.read_bytes() == b"old\n"


def test_a_failed_move_does_not_stop_the_logger(tmp_path, run_setup, monkeypatch):
    old = legacy_log(tmp_path)

    def refuse(*args, **kwargs):
        raise PermissionError("locked")

    monkeypatch.setattr(os, "rename", refuse)

    log_file = run_setup(tmp_path)

    # Keeps logging where the logs already are instead of crashing or
    # starting a second, empty log directory next to them.
    assert log_file == old
    assert old.read_bytes() == b'{"old": true}\n'
    assert not (tmp_path / "aivinnet").exists()


def test_a_failing_filesystem_check_does_not_stop_the_logger(tmp_path, run_setup, monkeypatch):
    legacy_log(tmp_path)
    real_is_dir = Path.is_dir

    def is_dir(self):
        if self.name == "swingmusic":
            raise PermissionError("no access")
        return real_is_dir(self)

    monkeypatch.setattr(Path, "is_dir", is_dir)

    log_file = run_setup(tmp_path)

    assert log_file == tmp_path / "aivinnet" / "logs" / "log.jsonl"
    assert log_file.parent.is_dir()


def test_home_dir_uses_the_dotted_name(tmp_path, run_setup, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    old = tmp_path / ".swingmusic" / "logs" / "log.jsonl"
    old.parent.mkdir(parents=True)
    old.write_bytes(b"old\n")

    log_file = run_setup(tmp_path)

    assert log_file == tmp_path / ".aivinnet" / "logs" / "log.jsonl"
    assert log_file.read_bytes() == b"old\n"
