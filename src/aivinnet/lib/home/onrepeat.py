"""
Home rows that are also playlists, served like "recentlyplayed":

- "onrepeat": the "On repeat" row — "Play all" plays it, its caption opens it.
- "onthisday": the day a year ago (or the most recent earlier year with
  plays) in the order it was heard — "Play that day".

Read from what the routines already computed (RAM), so a playlist and its row
always agree.
"""

from aivinnet.lib.playlistlib import get_first_4_images
from aivinnet.models.playlist import Playlist
from aivinnet.store.homepage import HomepageStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.auth import get_current_userid


def get_on_repeat_playlist():
    playlist = Playlist(
        id="onrepeat",
        name="On repeat",
        image=None,
        last_updated="Now",
        settings={},
        trackhashes=[],
    )

    items = HomepageStore.entries["on_repeat"].items.get(get_current_userid(), [])
    tracks = TrackStore.get_tracks_by_trackhashes([item["hash"] for item in items])
    if tracks:
        playlist.images = get_first_4_images(tracks=tracks)

    return playlist, tracks


def get_on_this_day_playlist():
    entry = HomepageStore.entries["on_this_day"]
    userid = get_current_userid()
    playlist = Playlist(
        id="onthisday",
        name=entry.meta.get(userid, {}).get("playlist_name", "On this day"),
        image=None,
        last_updated="Now",
        settings={},
        trackhashes=[],
    )

    tracks = TrackStore.get_tracks_by_trackhashes(entry.trackhashes.get(userid, []))
    if tracks:
        playlist.images = get_first_4_images(tracks=tracks)

    return playlist, tracks
