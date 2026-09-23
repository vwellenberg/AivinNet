"""
Settings changed on the very first run must reach settings.json.

Regression: `UserConfig.__post_init__` only armed write-through (`_finished`)
when it LOADED an existing file. On a fresh install there is none, so
`setup_config_file()` created it and the flag stayed False for the whole first
session — every setting changed then lived in memory only. The music folder a
new user picks in the first-run dialog was gone after the first restart, and
Docker restarts on every upgrade. Found by running the published image.
"""

import json

import pytest

from aivinnet import config as config_module
from aivinnet.config import UserConfig
from aivinnet.settings import Singleton


class _Paths:
    def __init__(self, config_file):
        self.config_file_path = config_file
        self.config_dir = config_file.parent


@pytest.fixture
def settings_file(tmp_path, monkeypatch):
    settings_file = tmp_path / "settings.json"
    monkeypatch.setattr(config_module, "Paths", lambda: _Paths(settings_file))
    # UserConfig is a process-wide singleton; each "start" needs a fresh one.
    monkeypatch.setattr(Singleton, "_instances", {})
    return settings_file


def _start() -> UserConfig:
    """What one server start does with the config (`setup/__init__.py::run_setup`)."""
    Singleton._instances.pop(UserConfig, None)
    config = UserConfig()
    config.setup_config_file()
    return config


def test_setting_changed_on_first_run_survives_a_restart(settings_file):
    assert not settings_file.exists()

    _start().rootDirs = ["/music"]

    assert json.loads(settings_file.read_text())["rootDirs"] == ["/music"]
    assert _start().rootDirs == ["/music"]


def test_setting_changed_on_a_later_run_survives_a_restart(settings_file):
    _start()
    _start().usersOnLogin = False

    assert _start().usersOnLogin is False


def test_a_retired_option_in_an_old_file_is_dropped(settings_file):
    """
    Options removed from the config (periodic scans, watchdog, ...) still sit in
    every existing settings.json. Loading must not attach them to the singleton,
    and the next write takes them out of the file.
    """
    settings_file.write_text(json.dumps({"enablePeriodicScans": True, "enablePlugins": True, "rootDirs": ["/m"]}))

    config = _start()

    assert config.rootDirs == ["/m"]
    assert not hasattr(config, "enablePeriodicScans")

    config.usersOnLogin = False

    saved = json.loads(settings_file.read_text())
    assert "enablePeriodicScans" not in saved
    assert "enablePlugins" not in saved
