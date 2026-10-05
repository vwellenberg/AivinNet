import os
import pathlib

from aivinnet.db.userdata import PlaylistTable
from aivinnet.lib.home.recentlyadded import get_recently_added_playlist
from aivinnet.lib.home.recentlyplayed import get_recently_played_playlist
from aivinnet.models.logger import TrackLog
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.tracks import TrackStore


def _playlist_exists(playlistid: str, userid: int | None) -> bool:
    """
    With an explicit `userid` (cron routines, scrobble hook) the owner is that
    user. Without one, `get_by_id` uses the request's user — which OFF a
    request silently falls back to user 1, so the routines must pass it.
    """
    if userid is None:
        return PlaylistTable.get_by_id(playlistid) is not None

    # The id comes from a scrobble's `source`, which any account can post. A
    # number past SQLite's 64-bit INTEGER made the driver raise OverflowError —
    # in the startup cron job too, which then died for every user.
    try:
        pid = int(playlistid)
    except ValueError:
        return False
    if not 0 < pid < 2**63:
        return False

    return PlaylistTable.get_trackhashes_of_user(pid, userid) is not None


def create_items(entries: list[TrackLog], limit: int, userid: int | None = None):
    """
    TODO: rework so that returns a dict with
    {
        "recently_played": ...,
    }
    also keep in mind that the web-ui is beeing translated.
    """
    custom_playlists = [
        {"name": "recentlyadded", "handler": get_recently_added_playlist},
        {"name": "recentlyplayed", "handler": get_recently_played_playlist},
    ]

    items = []
    added = set()

    for entry in entries:
        if len(items) >= limit:
            break

        if entry.source in added:
            continue

        added.add(entry.source)

        if entry.type == "album":
            album = AlbumStore.albummap.get(entry.type_src)

            if album is None:
                continue

            item = {
                "type": "album",
                "hash": entry.type_src,
                "timestamp": entry.timestamp,
            }

            items.append(item)
            continue

        if entry.type == "artist":
            artist = ArtistStore.artistmap.get(entry.type_src)

            if artist is None:
                continue

            items.append(
                {
                    "type": "artist",
                    "hash": entry.type_src,
                    "timestamp": entry.timestamp,
                }
            )

            continue

        if entry.type == "folder":
            folder = entry.type_src

            if not folder:
                continue

            if not folder.endswith("/"):
                folder += "/"

            is_home_dir = entry.type_src == "$home"

            if is_home_dir:
                folder = os.path.expanduser("~")

            if not pathlib.Path(folder).exists():
                continue

            item = {
                "type": "folder",
                "hash": folder,
                "timestamp": entry.timestamp,
            }

            items.append(item)
            continue

        if entry.type == "playlist":
            is_custom = entry.type_src in [i["name"] for i in custom_playlists]

            if is_custom:
                items.append(
                    {
                        "type": "playlist",
                        "hash": entry.type_src,
                        "timestamp": entry.timestamp,
                        "is_custom": True,
                    }
                )
                continue

            if not _playlist_exists(entry.type_src, userid):
                continue

            item = {
                "type": "playlist",
                "hash": entry.type_src,
                "timestamp": entry.timestamp,
            }

            items.append(item)
            continue

        if entry.type == "favorite":
            items.append(
                {
                    "type": "favorite",
                    "timestamp": entry.timestamp,
                }
            )
            continue

        t = TrackStore.trackhashmap.get(entry.trackhash)

        if t is None:
            continue

        item = {
            "type": "track",
            "hash": entry.trackhash,
            "timestamp": entry.timestamp,
        }
        items.append(item)

    return items
