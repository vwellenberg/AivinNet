"""
Registers the built-in plugins in the database.

The lyrics finder ships ON by default: without it, tracks that carry no
local lyrics (.lrc file, embedded tag) dead-end at "You don't have the
lyrics for this song", and the switch to change that is buried in the
settings. `auto_download` is on for the same reason — opening the lyrics
page should just fetch them.

Existing databases already have the row, so the insert alone cannot roll
the new default out. `upgrade_lyrics_plugin_row()` flips rows that are
still in the old factory state, exactly once: the `overide_unsynced`
settings key doubles as the rollout marker (rows written before this
change never had it, and every write since — insert, upgrade, or the
client's settings update, which always sends the full dict — includes
it). A user who disables the plugin AFTER the upgrade keeps that choice
forever, because their row already carries the marker.
"""

from sqlalchemy.exc import IntegrityError

from swingmusic.db.userdata import PluginTable

LYRICS_PLUGIN = "lyrics_finder"
LYRICS_DEFAULT_SETTINGS = {"auto_download": True, "overide_unsynced": False}


def upgrade_lyrics_plugin_row():
    """
    One-time rollout of the on-by-default lyrics finder to databases
    created before the default changed. Idempotent: rows that carry the
    `overide_unsynced` marker are never touched again.
    """
    plugin = PluginTable.get_by_name(LYRICS_PLUGIN)

    if plugin is None or "overide_unsynced" in plugin.settings:
        return

    if plugin.active:
        # The user found and enabled the plugin by hand — keep their
        # settings, only stamp the marker so this runs exactly once.
        PluginTable.update_settings(LYRICS_PLUGIN, {**plugin.settings, "overide_unsynced": False})
    else:
        PluginTable.activate(LYRICS_PLUGIN, True)
        PluginTable.update_settings(LYRICS_PLUGIN, dict(LYRICS_DEFAULT_SETTINGS))


def register_plugins():
    try:
        PluginTable.insert_one(
            {
                "name": LYRICS_PLUGIN,
                "active": True,
                "settings": dict(LYRICS_DEFAULT_SETTINGS),
                "extra": {
                    "description": "Find lyrics from the internet",
                },
            }
        )
    except IntegrityError:
        upgrade_lyrics_plugin_row()
