import os

from aivinnet.db.userdata import PlaylistTable
from aivinnet.lib.home.homerows import CUSTOM_PLAYLISTS, DATED_PLAYLISTS, parse_playlist_id
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
    pid = parse_playlist_id(playlistid)
    if pid is None:
        return False

    if userid is None:
        return PlaylistTable.get_by_id(pid) is not None

    return PlaylistTable.get_trackhashes_of_user(pid, userid) is not None


def create_items(entries: list[TrackLog], limit: int, userid: int | None = None, added: set[str] | None = None):
    """
    TODO: rework so that returns a dict with
    {
        "recently_played": ...,
    }
    also keep in mind that the web-ui is beeing translated.

    `added` holds the sources already shown; pass the same set to every batch
    of one listing, or each batch repeats them.
    """
    items = []
    added = set() if added is None else added

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

            # Not `Path.exists()`: it raises for a name that is too long or a
            # stale mount, and the path comes from a scrobble any account
            # can post. Inside the scrobble request that was a 500 (#391).
            if not os.path.isdir(folder):
                continue

            item = {
                "type": "folder",
                "hash": folder,
                "timestamp": entry.timestamp,
            }

            items.append(item)
            continue

        if entry.type == "playlist":
            if entry.type_src in DATED_PLAYLISTS:
                continue

            is_custom = entry.type_src in CUSTOM_PLAYLISTS

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
