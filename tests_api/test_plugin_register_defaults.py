"""Real-database tests for the off-by-default lyrics finder.

The plugin talks to Musixmatch, so the factory state is OFF. The interesting
half is not the fresh install, though — it is the promise that an EXISTING row
is never touched.

That promise replaced a three-way upgrade path. The previous default was ON,
and a rollout function flipped older rows to match. Reversing the default must
not mean reversing the rollout: after it ran, a row the user enabled themselves
and a row the rollout enabled for them are byte-identical, so a pass that
switched everyone back off would silently disable a feature people use. Hence
one rule instead of three — `register_plugins` writes a row or writes nothing —
and these tests hold it to that against the real table.
"""

import pytest

from aivinnet.plugins.register import (
    LYRICS_DEFAULT_SETTINGS,
    LYRICS_PLUGIN,
    register_plugins,
)


@pytest.fixture()
def plugin_table():
    """The real table, wiped before and after so every test starts empty."""
    from sqlalchemy import delete

    from aivinnet.db import create_all_tables
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import PluginTable

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


def test_the_shipped_default_reaches_nobody(plugin_table):
    """THE guard: nothing leaves the machine until someone asks for it."""
    register_plugins()

    row = get_lyrics_row(plugin_table)
    assert row.active is False
    assert row.settings["auto_download"] is False
    assert row.settings == LYRICS_DEFAULT_SETTINGS


def test_register_is_idempotent(plugin_table):
    register_plugins()
    register_plugins()

    row = get_lyrics_row(plugin_table)
    assert row.active is False
    assert row.settings == LYRICS_DEFAULT_SETTINGS


@pytest.mark.parametrize(
    ("active", "settings"),
    [
        # Enabled with the marker: either the user chose it, or the old rollout
        # chose for them. Indistinguishable, so both are left alone.
        (True, {"auto_download": True, "overide_unsynced": False}),
        # Enabled, hand-tuned.
        (True, {"auto_download": False, "overide_unsynced": False}),
        # Explicitly opted out after the rollout.
        (False, {"auto_download": True, "overide_unsynced": False}),
        # Pre-rollout shape, no marker at all.
        (False, {"auto_download": False}),
        (True, {}),
    ],
)
def test_an_existing_row_is_never_touched(plugin_table, active, settings):
    plugin_table.insert_one(
        {
            "name": LYRICS_PLUGIN,
            "active": active,
            "settings": dict(settings),
            "extra": {"description": "Find lyrics from the internet"},
        }
    )

    register_plugins()

    row = get_lyrics_row(plugin_table)
    assert row.active is active
    assert row.settings == settings


def test_a_running_instance_is_not_switched_off_behind_the_user(plugin_table):
    """
    Spelled out separately because it is the failure mode worth naming: shipping
    a privacy default is changing what NEW installs do, not reaching into
    someone's server and turning off the lyrics they use every day.
    """
    plugin_table.insert_one(
        {
            "name": LYRICS_PLUGIN,
            "active": True,
            "settings": {"auto_download": True, "overide_unsynced": False},
            "extra": {},
        }
    )

    for _ in range(3):  # several restarts
        register_plugins()

    assert get_lyrics_row(plugin_table).active is True
