import os
from collections.abc import Callable
from typing import Any
from itertools import groupby

from aivinnet.lib.albumslib import sort_by_track_no
from aivinnet.models.folder import Folder
from aivinnet.models.track import Track
from aivinnet.utils import flatten



def folder_order(track: Track) -> tuple[int, str]:
    """
    The order a folder lists its files in when no sort is chosen: oldest
    first, then by path.

    ONE key for the folder view, "Play" on a folder card (`/folder/tracks/all`)
    and "save folder as playlist" (#391). They used to differ: the view sorted
    by the file's float mtime from disk, the other two by the stored
    `last_mod`, and a tie (an album unpacked from a zip or rsync'ed with its
    times) fell back to directory order in one and hash order in the others,
    so the queue and the playlist did not follow what the user saw.
    """
    return (track.last_mod or 0, track.filepath)


# What the folder view offers (`api/folder.FolderTree.sorttracksby`).
TRACK_SORT_KEYS = frozenset(
    {
        "album",
        "albumartists",
        "artists",
        "bitrate",
        "date",
        "disc",
        "duration",
        "last_mod",
        "lastplayed",
        "playcount",
        "playduration",
        "title",
    }
)


def sort_tracks(tracks: list[Track], key: str, reverse: bool = False):
    """
    Sorts a list of tracks by a key.
    """
    # The key comes from the request: anything but these keeps the order. An
    # unknown field was an AttributeError, a list or dict one ("genres",
    # "config") a TypeError in `sorted`: a 500 for the folder either way (#391).
    if key not in TRACK_SORT_KEYS or not tracks:
        return tracks

    if key == "disc":
        # INFO: Group tracks into albums, then sort them by disc number. By
        # name AND hash, so two albums of the same name are not interleaved.
        tracks = sorted(tracks, key=lambda x: (x.album.casefold(), x.albumhash))
        groups = groupby(tracks, lambda x: x.albumhash)

        return flatten([sort_by_track_no(list(g)) for k, g in groups])

    def value_of(track: Track) -> Any:
        value = getattr(track, key, None)
        if key in ("artists", "albumartists"):
            # An artist tag of only separators splits to no artist at all.
            value = value[0]["name"] if value else ""
        return value.casefold() if isinstance(value, str) else value

    # INFO: sort tracks by title for a fallback value
    tracks = sorted(tracks, key=lambda t: t.title.casefold())

    if key == "title" and not reverse:
        return tracks

    # Missing values go last in either direction, and are never compared with
    # real ones (None < 3 is a TypeError).
    known = [t for t in tracks if value_of(t) is not None]
    missing = [t for t in tracks if value_of(t) is None]
    return sorted(known, key=value_of, reverse=reverse) + missing


def _folder_mtime(folder: Folder) -> float:
    # A folder removed (or a mount gone) since it was listed sorts as oldest
    # instead of failing the whole page (#391).
    try:
        return os.path.getmtime(folder.path)
    except OSError:
        return 0.0


def sort_folders(folders: list[Folder], key: str, reverse: bool = False):
    """
    Sorts a list of folders by a key.
    """
    if key == "default":
        return folders

    sortfunc: Callable[[Folder], str | float] = lambda folder: getattr(folder, key)

    if key == "name":
        sortfunc = lambda folder: folder.name.casefold()
    elif key == "lastmod":
        sortfunc = _folder_mtime

    return sorted(folders, key=sortfunc, reverse=reverse)
