"""
The playlists the server builds on the fly, by id — the one registry that the
playlist endpoint (`api/playlist.py`) and Home's cards (`recover_items`) read.

Their NAMES are also in `homerows.CUSTOM_PLAYLISTS`, which must stay free of
store imports for the fast test lane; `tests_api/test_home_discover_api.py`
checks that the two agree. A generated playlist missing from one of them
either 404s on its own page or vanishes from "Recently played".
"""

from aivinnet.lib.home.recentlyadded import get_recently_added_playlist
from aivinnet.lib.home.recentlyplayed import get_recently_played_playlist


def _on_repeat_playlist():
    # Imported here: `onrepeat` reads the homepage store, whose entries import
    # `recover_items`, which imports this module.
    from aivinnet.lib.home.onrepeat import get_on_repeat_playlist

    return get_on_repeat_playlist()


GENERATED_PLAYLISTS = {
    "recentlyadded": get_recently_added_playlist,
    "recentlyplayed": get_recently_played_playlist,
    "onrepeat": _on_repeat_playlist,
}
