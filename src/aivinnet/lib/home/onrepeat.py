"""
The "On repeat" row as a playlist ("onrepeat"), served like "recentlyplayed":
Home's "Play all" plays it, and the row's caption opens it.

Read from the row the routine already computed (RAM), so the playlist and the
row always show the same tracks in the same order.
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
