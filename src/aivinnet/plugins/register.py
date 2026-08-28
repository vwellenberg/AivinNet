"""
Registers the built-in plugins in the database.

The lyrics finder ships OFF. It talks to Musixmatch, and opening the lyrics
page would otherwise send the track title and artist there in the clear —
on a self-hosted server, without anyone having asked for it. A listener who
wants online lyrics turns the plugin on in the settings, and that switch also
carries `auto_download`.

⚠️ Existing databases are left ALONE, on purpose, and that is the whole
subtlety here. This file previously shipped the plugin ON and had an
`upgrade_lyrics_plugin_row()` that flipped older rows to match; that function
is gone with the default it was rolling out. What it must NOT be replaced by
is the mirror image — a pass that switches everyone back off. The row records
a choice, and after the earlier rollout there is no way to tell a row the user
enabled deliberately from one the rollout enabled for them: both end up
`active=True` carrying the marker. Reaching into a running instance to disable
a feature someone may be using every day is its own kind of surprise, and the
setting is one click away.

So: a NEW install gets the private default, an existing one keeps whatever it
has. The README says this out loud, because "we changed the default" and "we
changed your setting" are different promises.
"""

from sqlalchemy.exc import IntegrityError

from aivinnet.db.userdata import PluginTable

LYRICS_PLUGIN = "lyrics_finder"
LYRICS_DEFAULT_SETTINGS = {"auto_download": False, "overide_unsynced": False}


def register_plugins():
    try:
        PluginTable.insert_one(
            {
                "name": LYRICS_PLUGIN,
                "active": False,
                "settings": dict(LYRICS_DEFAULT_SETTINGS),
                "extra": {
                    "description": "Find lyrics from the internet",
                },
            }
        )
    except IntegrityError:
        # The row already exists — the user's choice, whatever it is. Nothing to do.
        pass
