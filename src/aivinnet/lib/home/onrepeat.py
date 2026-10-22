"""
Home rows that are also playlists, served like "recentlyplayed":

- "onrepeat": the "On repeat" row — "Play all" plays it, its caption opens it.
- "forgottenfavorites": the "Forgotten favorites" row, the same way.
- "onthisday": the day a year ago (or the most recent earlier year with
  plays) in the order it was heard — "Play that day".
- "becauseyoulistened": one track per album of "Because you listened to …"
  — "Play mix".

Read from what the routines already computed (RAM), so a playlist and its row
always agree.
"""

from aivinnet.lib.playlistlib import get_first_4_images
from aivinnet.models.playlist import Playlist
from aivinnet.store.homepage import HomepageStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.auth import get_current_userid


def _playlist(playlistid: str, name: str, trackhashes: list[str]):
    playlist = Playlist(
        id=playlistid,
        name=name,
        image=None,
        last_updated="Now",
        settings={},
        trackhashes=[],
    )

    tracks = TrackStore.get_tracks_by_trackhashes(trackhashes)
    if tracks:
        playlist.images = get_first_4_images(tracks=tracks)

    return playlist, tracks


def _row_playlist(key: str, playlistid: str, name: str):
    """A row of track cards, in the row's order."""
    items = HomepageStore.entries[key].items.get(get_current_userid(), [])
    return _playlist(playlistid, name, [item["hash"] for item in items])


def _playable_playlist(key: str, playlistid: str, name: str):
    """A `PlayableEntry`: its own track list, and a name per user if it has one."""
    entry = HomepageStore.entries[key]
    userid = get_current_userid()
    name = entry.meta.get(userid, {}).get("playlist_name", name)
    return _playlist(playlistid, name, entry.trackhashes.get(userid, []))


def get_on_repeat_playlist():
    return _row_playlist("on_repeat", "onrepeat", "On repeat")


def get_forgotten_favorites_playlist():
    return _row_playlist("forgotten_favorites", "forgottenfavorites", "Forgotten favorites")


def get_on_this_day_playlist():
    return _playable_playlist("on_this_day", "onthisday", "On this day")


def get_because_playlist():
    return _playable_playlist("because_you_listened", "becauseyoulistened", "Because you listened")
