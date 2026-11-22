import pathlib
from collections.abc import Collection
from datetime import datetime
from itertools import groupby

from aivinnet.config import UserConfig
from aivinnet.lib.home.recent_folders import (
    NEW_TOLERANCE_SECONDS,
    fresh_batch,
    root_prefixes,
    show_as_folder,
)
from aivinnet.lib.playlistlib import get_first_4_images
from aivinnet.models.playlist import Playlist
from aivinnet.models.track import Track
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils import flatten
from aivinnet.utils.dates import (
    create_new_date,
    date_string_to_time_passed,
)

older_albums = set()
older_artists = set()


def calc_based_on_percent(items: list[str], total: int):
    """
    Checks if items is more than 70% of total items. Returns a boolean and the most common item.
    """
    # An artist tag of only separators splits to no hashes at all (#391).
    if not items or not total:
        return False, None, 0

    most_common = max(items, key=items.count)
    most_common_count = items.count(most_common)

    return most_common_count / total >= 0.7, most_common, most_common_count


def check_is_album_folder(tracks: list[Track]):
    albumhashes = [t.albumhash for t in tracks]
    return calc_based_on_percent(albumhashes, len(tracks))


def check_is_artist_folder(tracks: list[Track]):
    # INFO: flatten artist hashes using "-" as a separator
    artisthashes = flatten([t.artisthashes for t in tracks])
    return calc_based_on_percent(artisthashes, len(tracks))


def create_track(t: Track):
    """
    Creates a recently added track entry.
    """
    return {
        "type": "track",
        "hash": t.trackhash,
        "timestamp": t.added,
        "help_text": "NEW TRACK",
    }


# INFO: Keys: folder, tracks, time (timestamp)
# group_type = dict[str, str | list[Track] | float]


def check_folder_type(group_: dict, roots: Collection[str] = ()):
    # check if all tracks in group have the same albumhash
    # if so, return "album"
    key: str = group_["folder"]
    tracks: list[Track] = group_["tracks"]
    time: float = group_["time"]

    if len(tracks) == 1:
        entry = create_track(tracks[0])
        entry["timestamp"] = time
        return entry

    # New means nothing of it is much older than this folder's files. The
    # stores already hold the new files when this runs, so "is it in the
    # store?" called every album new and no artist new (#391). A day of slack:
    # CD1/ and CD2/ of a new album, or the album folders of a new artist,
    # are copied one after the other.
    new_since = min(t.added for t in tracks) - NEW_TOLERANCE_SECONDS

    is_album, albumhash, _ = check_is_album_folder(tracks)
    if is_album:
        # album = AlbumTable.get_album_by_albumhash(albumhash)
        entry = AlbumStore.albummap.get(albumhash)

        if entry is None:
            return None

        return {
            "type": "album",
            "hash": albumhash,
            "timestamp": time,
            "help_text": ("NEW ALBUM" if entry.album.created_date >= new_since else "NEW TRACKS"),
        }

    is_artist, artisthash, _trackcount = check_is_artist_folder(tracks)
    if is_artist:
        entry = ArtistStore.artistmap.get(artisthash)

        if entry is None:
            return None

        return {
            "type": "artist",
            "hash": artisthash,
            "timestamp": time,
            "help_text": ("NEW ARTIST" if entry.artist.created_date >= new_since else "NEW MUSIC"),
        }

    # Neither album nor artist: only what came in with the newest file is new.
    # The group holds every file that ever landed here, so one new song in the
    # library root showed the whole library as "NEW MUSIC" (12837 Tracks).
    fresh = fresh_batch(tracks)
    if not show_as_folder(key, fresh, roots):
        return [create_track(t) for t in fresh]

    return {
        "type": "folder",
        "hash": key,
        "timestamp": time,
        "help_text": "NEW MUSIC",
    }


def group_track_by_folders(tracks: list[Track], groups: dict[str, list[Track]]):
    """
    Groups tracks by folder and returns a list of groups sorted by last modified date.

    Uses generator expressions to avoid creating intermediate lists.
    """
    # INFO: sort tracks by folder name, then group by folder name
    tracks = sorted(tracks, key=lambda t: t.folder)
    thisgroup = groupby(tracks, lambda t: t.folder)

    for folder, thistracks in thisgroup:
        groups.setdefault(folder, []).extend(thistracks)

    return groups


def get_recently_added_items(limit: int = 7):
    tracks = get_recently_added_tracks(start=0, limit=None)
    groups = group_track_by_folders(tracks, {})
    grouplist = []

    # A folder is as new as the newest file that came into it. Not its newest
    # mtime: a tag edit or a cover written into one file put a whole folder of
    # long-known music on top, as "NEW MUSIC" (lib/date_added.py).
    for folder, trackgroup in groups.items():
        if not pathlib.Path(folder).exists():
            continue

        trackgroup.sort(key=lambda t: t.added, reverse=True)
        grouplist.append(
            {
                "folder": folder,
                "len": len(trackgroup),
                "tracks": trackgroup,
                "time": trackgroup[0].added,
            }
        )

    # newest folder first
    grouplist = sorted(grouplist, key=lambda group: group["time"], reverse=True)

    recent_items = []
    roots = root_prefixes(UserConfig().rootDirs, pathlib.Path.home())

    for group in grouplist:
        item = check_folder_type(group, roots)

        if item not in recent_items:
            if not item:
                continue

            (recent_items.append(item) if isinstance(item, dict) else recent_items.extend(item))

        if len(recent_items) >= limit:
            break

    # A batch of loose files in a library root comes as tracks, not as one card.
    return recent_items[:limit]


def get_recently_added_playlist(limit: int = 100):
    playlist = Playlist(
        id="recentlyadded",
        name="Recently Added",
        image=None,
        last_updated="Now",
        settings={},
        trackhashes=[],
    )

    tracks = get_recently_added_tracks(limit=limit)

    try:
        # Create date to show as last updated
        date = datetime.fromtimestamp(tracks[0].added)
    except IndexError:
        return playlist, []

    playlist._last_updated = date_string_to_time_passed(create_new_date(date))
    images = get_first_4_images(tracks=tracks)
    playlist.images = images
    playlist.duration = sum(t.duration for t in tracks)
    playlist.count = len(tracks)

    return playlist, tracks


def get_recently_added_tracks(start: int = 0, limit: int | None = 100):
    return TrackStore.get_recently_added(start, limit)
