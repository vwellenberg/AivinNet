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


def _row(getter: str):
    """
    A playlist built from a home row (`onrepeat.py`), imported when asked for:
    `onrepeat` reads the homepage store, whose entries import `recover_items`,
    which imports this module.
    """

    def handler():
        from aivinnet.lib.home import onrepeat

        return getattr(onrepeat, getter)()

    return handler


GENERATED_PLAYLISTS = {
    "recentlyadded": get_recently_added_playlist,
    "recentlyplayed": get_recently_played_playlist,
    "onrepeat": _row("get_on_repeat_playlist"),
    "onthisday": _row("get_on_this_day_playlist"),
    "forgottenfavorites": _row("get_forgotten_favorites_playlist"),
    "becauseyoulistened": _row("get_because_playlist"),
}
