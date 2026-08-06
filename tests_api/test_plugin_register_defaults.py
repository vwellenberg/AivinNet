"""Real-database tests for the on-by-default lyrics finder rollout.

The plugin row is written exactly once per database (the insert hits the
unique name constraint on every later boot), so changing the literal in
`register_plugins()` alone would never reach an existing installation.
These tests pin the three-way contract of the upgrade path: factory-state
rows get the new default, hand-tuned rows keep their settings, and a
post-upgrade opt-out is permanent. All against the real table — a mocked
PluginTable could not fail on any of it.
"""

import pytest

from swingmusic.plugins.register import (
    LYRICS_DEFAULT_SETTINGS,
    LYRICS_PLUGIN,
    register_plugins,
)


@pytest.fixture()
def plugin_table():
    """The real table, wiped before and after so every test starts empty."""
    from sqlalchemy import delete

    from swingmusic.db import create_all_tables
    from swingmusic.db.engine import DbEngine
    from swingmusic.db.userdata import PluginTable

    create_all_tables()

    def wipe():
        with DbEngine.manager(commit=True) as session:
            session.execute(delete(PluginTable))

    wipe()
    yield PluginTable
    wipe()


def get_lyrics_row(plugin_table):
    row = plugin_table.get_by_name(LYRICS_PLUGIN)
    assert row is not None, "register_plugins must create the lyrics row"
    return row


def test_fresh_install_ships_active_with_auto_download(plugin_table):
    register_plugins()

    row = get_lyrics_row(plugin_table)
    assert row.active is True
    assert row.settings == LYRICS_DEFAULT_SETTINGS


def test_register_is_idempotent(plugin_table):
    register_plugins()
    register_plugins()

    row = get_lyrics_row(plugin_table)
    assert row.active is True
    assert row.settings == LYRICS_DEFAULT_SETTINGS


def test_old_factory_row_is_upgraded(plugin_table):
    """A database from before the default change: row exists, never touched."""
    plugin_table.insert_one(
        {
            "name": LYRICS_PLUGIN,
            "active": False,
            "settings": {"auto_download": False},
            "extra": {"description": "Find lyrics from the internet"},
        }
    )

    register_plugins()

    row = get_lyrics_row(plugin_table)
    assert row.active is True
    assert row.settings == LYRICS_DEFAULT_SETTINGS


def test_hand_enabled_row_keeps_its_settings(plugin_table):
    """A user who found and enabled the plugin keeps their auto_download
    choice — the upgrade only stamps the marker so it never runs again."""
    plugin_table.insert_one(
        {
            "name": LYRICS_PLUGIN,
            "active": True,
            "settings": {"auto_download": False},
            "extra": {},
        }
    )

    register_plugins()

    row = get_lyrics_row(plugin_table)
    assert row.active is True
    assert row.settings["auto_download"] is False
    assert "overide_unsynced" in row.settings


def test_opt_out_after_upgrade_is_permanent(plugin_table):
    """A row that carries the marker was disabled AFTER the rollout —
    a restart must never flip it back on."""
    plugin_table.insert_one(
        {
            "name": LYRICS_PLUGIN,
            "active": False,
            "settings": {"auto_download": True, "overide_unsynced": False},
            "extra": {},
        }
    )

    register_plugins()

    row = get_lyrics_row(plugin_table)
    assert row.active is False
    assert row.settings == {"auto_download": True, "overide_unsynced": False}
