"""
The playlists the server builds on the fly, by id — the one registry that the
playlist endpoint (`api/playlist.py`) and Home's cards (`recover_items`) read.

Their NAMES are also in `homerows.CUSTOM_PLAYLISTS`, which must stay free of
store imports for the fast test lane; `tests_api/test_home_discover_api.py`
checks that the two agree. A generated playlist missing from one of them
either 404s on its own page or vanishes from "Recently played".
"""

from aivinnet.lib.home.mixes import MIX_PLAYLIST_IDS
from aivinnet.lib.home.recentlyadded import get_recently_added_playlist
from aivinnet.lib.home.recentlyplayed import get_recently_played_playlist
from aivinnet.lib.home.stations import STATION_PLAYLIST_IDS


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


def _mix(position: int):
    """Mix <position + 1> of the current user ("Your mixes")."""

    def handler():
        from aivinnet.lib.home import onrepeat

        return onrepeat.get_mix_playlist(position)

    return handler


def _station(playlistid: str):
    """A genre or decade station of the radio, by its playlist id (`store/stations.py`)."""

    def handler():
        from aivinnet.lib.home import onrepeat

        return onrepeat.get_station_playlist(playlistid)

    return handler


GENERATED_PLAYLISTS = {
    "recentlyadded": get_recently_added_playlist,
    "recentlyplayed": get_recently_played_playlist,
    "onrepeat": _row("get_on_repeat_playlist"),
    "onthisday": _row("get_on_this_day_playlist"),
    "forgottenfavorites": _row("get_forgotten_favorites_playlist"),
    "becauseyoulistened": _row("get_because_playlist"),
    "almostcomplete": _row("get_almost_complete_playlist"),
    "deepcuts": _row("get_deep_cuts_playlist"),
    **{playlistid: _mix(position) for position, playlistid in enumerate(MIX_PLAYLIST_IDS)},
    **{playlistid: _station(playlistid) for playlistid in STATION_PLAYLIST_IDS},
}
