"""
Contains all the folder routes.
"""

import itertools
import os
import pathlib
from dataclasses import asdict
from pathlib import Path

import psutil
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field
from showinfm import show_in_file_manager

from aivinnet import settings
from aivinnet.api.apischemas import JsonBodyModel
from aivinnet.api.auth import admin_required
from aivinnet.config import UserConfig
from aivinnet.db.userdata import FavoritesTable
from aivinnet.db.utils import favorites_to_dataclass
from aivinnet.lib.folderslib import create_folder, get_files_and_dirs, get_folders
from aivinnet.lib.sortlib import folder_order, sort_folders
from aivinnet.serializers.track import serialize_track
from aivinnet.store.folder import FolderStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.filesystem import dir_prefix, safe_dir_prefix
from aivinnet.utils.wintools import is_windows

tag = Tag(name="Folders", description="Get folders and tracks in a directory")
api = APIBlueprint("folder", __name__, url_prefix="/folder", abp_tags=[tag])


def is_path_within_root_dirs(filepath: str) -> bool:
    """
    Check if a filepath is within one of the configured root directories.
    Prevents directory traversal attacks.
    """
    config = UserConfig()
    resolved_path = Path(filepath).resolve()

    for root_dir in config.rootDirs:
        if root_dir == "$home":
            root_path = Path.home().resolve()
        else:
            root_path = Path(root_dir).resolve()

        # Check if resolved_path is the root or a child of root
        if resolved_path == root_path or root_path in resolved_path.parents:
            return True

    return False


class FolderTree(JsonBodyModel):
    folder: str = Field("$home", description="The folder to things from")
    sorttracksby: str = Field(
        "default",
        description="""The field to sort tracks by. "last_mod" is "Date Added": when the
        file came into the library (`added`), not its mtime. Options: [
            "default",
            "album",
            "albumartists",
            "artists",
            "bitrate",
            "date",
            "disc",
            "duration",
            "last_mod",
            "lastplayed",
            "playduration",
            "playcount",
            "title",
        ]""",
    )
    tracksort_reverse: bool = Field(
        False,
        description="Whether to reverse the sort order of the tracks",
    )
    sortfoldersby: str = Field(
        "name",
        description="""The field to sort folders by. "lastmod" is "Folder date": when
        music last came into the folder (the newest `added` beneath it), not the
        directory's mtime. Options: [
            "default",
            "name",
            "lastmod",
            "trackcount",
        ]
        """,
    )
    foldersort_reverse: bool = Field(
        False,
        description="Whether to reverse the sort order of the folders",
    )
    start: int = Field(0, description="The start index")
    limit: int = Field(50, description="The max number of items to return")
    tracks_only: bool = Field(False, description="Whether to only get tracks")


@api.post("")
def get_folder_tree(body: FolderTree):
    """
    Get folder

    Returns a list of all the folders and tracks in the given folder.
    """
    req_dir = body.folder
    tracks_only = body.tracks_only

    config = UserConfig()
    root_dirs = config.rootDirs

    if req_dir == "$home" and "$home" in root_dirs:
        req_dir = settings.Paths().USER_HOME_DIR.as_posix()

    if req_dir == "$home":
        folders = get_folders(root_dirs)
        folders = sort_folders(folders, "name")

        return {
            "folders": folders,
            "tracks": [],
        }

    # Resolve path to prevent directory traversal attacks
    resolved_path = pathlib.Path(req_dir).resolve()

    # Validate path is within configured root directories
    if not is_path_within_root_dirs(str(resolved_path)):
        return {
            "folders": [],
            "tracks": [],
            "error": "Path not within allowed directories",
        }, 403

    if not resolved_path.exists() or not resolved_path.is_dir():
        return {
            "folders": [],
            "tracks": [],
            "error": "Invalid directory",
        }, 400

    results = get_files_and_dirs(
        resolved_path,
        start=body.start,
        limit=body.limit,
        tracks_only=tracks_only,
        tracksortby=body.sorttracksby,
        foldersortby=body.sortfoldersby,
        tracksort_reverse=body.tracksort_reverse,
        foldersort_reverse=body.foldersort_reverse,
    )

    return results


def get_all_drives(is_win: bool = False):
    """
    Returns a list of all the drives on a Windows machine.
    """
    drives_ = psutil.disk_partitions(all=True)
    drives = [Path(d.mountpoint).as_posix() for d in drives_]

    if is_win:
        return drives
    else:
        remove = (
            "/boot",
            "/tmp",
            "/snap",
            "/var",
            "/sys",
            "/proc",
            "/etc",
            "/run",
            "/dev",
        )
        drives = [d for d in drives if not d.startswith(remove)]

    return drives


class DirBrowserBody(JsonBodyModel):
    folder: str = Field(
        "$root",
        description="The folder to list directories from",
    )


@api.post("/dir-browser")
@admin_required()
def list_folders(body: DirBrowserBody):
    """
    List folders

    Returns a list of all the folders in the given folder.
    Used when selecting root dirs. Admin only.
    """
    req_dir = body.folder
    is_win = is_windows()

    if req_dir == "$root":
        return {"folders": [{"name": d, "path": d} for d in get_all_drives(is_win=is_win)]}

    # Resolve path to prevent directory traversal attacks
    req_dir = pathlib.Path(req_dir).resolve()

    if not req_dir.exists() or not req_dir.is_dir():
        return {"folders": [], "error": "Invalid directory"}, 400

    try:
        entries = os.scandir(req_dir)
    except PermissionError:
        return {"folders": []}

    # only get dirs and remove hidden dirs
    dirs = []
    for entry in entries:
        entry = pathlib.Path(entry)
        name = entry.name

        if name.startswith("$"):
            continue

        if name.startswith("."):
            continue

        if entry.is_dir():
            dirs.append({"name": name, "path": entry.resolve().as_posix()})

    return {
        "folders": sorted(dirs, key=lambda i: i["name"]),
    }


class FolderOpenInFileManagerQuery(BaseModel):
    path: str = Field(
        description="The path to open in the file manager",
    )


@api.get("/show-in-files")
@admin_required()
def open_in_file_manager(query: FolderOpenInFileManagerQuery):
    """
    Open in file manager

    Opens the given path in the file manager on the host machine.
    Path must be within configured root directories.

    Admin-only: this spawns a process on the SERVER, which is meaningless for a
    remote listener and not something a guest account should be able to trigger.
    The path check below limits where it points, not who may fire it.
    """
    # Resolve path to prevent directory traversal
    resolved_path = Path(query.path).resolve()

    # Validate path is within root directories
    if not is_path_within_root_dirs(query.path):
        return {"success": False, "error": "Path not within allowed directories"}, 403

    if not resolved_path.exists():
        return {"success": False, "error": "Path does not exist"}, 404

    show_in_file_manager(str(resolved_path))

    return {"success": True}


class GetTracksInPathQuery(BaseModel):
    path: str = Field(
        description="The path to get tracks from",
    )


@api.get("/tracks/all")
def get_tracks_in_path(query: GetTracksInPathQuery):
    """
    Get tracks in path

    Gets all (or a max of 300) tracks from the given path and its subdirectories.

    Used when adding tracks to the queue.
    """
    # Resolve path to prevent directory traversal
    resolved_path = Path(query.path).resolve()

    # Validate path is within root directories
    if not is_path_within_root_dirs(str(resolved_path)):
        return {"tracks": [], "error": "Path not within allowed directories"}, 403

    # From the RAM store, and capped BEFORE the stat and the serialisation:
    # "Play" on a root folder card used to load the whole track table and
    # stat every file of the library on the single request thread (#295).
    # The prefix ends in a separator, so /music/Rock no longer takes
    # /music/Rock and Roll along (the SQL matched any substring). And it is
    # the scanner's POSIX form: on Windows `str()` gives `C:\Music\Album`, no
    # stored `C:/Music/Album/...` started with it, and "Play" queued nothing.
    inside = dir_prefix(resolved_path)
    # In the folder view's own order (`folder_order`).
    tracks = sorted(
        (t for t in TrackStore.get_flat_list() if t.filepath.startswith(inside)),
        key=folder_order,
    )
    existing = (t for t in tracks if Path(t.filepath).exists())

    return {
        "tracks": [serialize_track(t) for t in itertools.islice(existing, 300)],
    }


# Folders are not DB rows either, so — like pinned albums (`api/album.py`) — a
# pin is a row in the per-user FavoritesTable under its own type, keyed by the
# folder's path. Pinned folders surface in the library sidebar next to pinned
# albums and playlists and share their position space.
PINNED_FOLDER_TYPE = "pinned_folder"


def pin_key(path: str) -> str:
    """
    The one spelling a folder is pinned under: the scanner's POSIX form,
    resolved, with exactly one trailing `/` (`safe_dir_prefix`).

    Without it the same folder could be pinned twice — once as `/music/Rock`
    from the breadcrumb, once as `/music/Rock/` from a folder card — and on
    Windows a backslash spelling would never match the stored one.
    """
    return safe_dir_prefix(path)


def _pinned_rows():
    pinned, _ = FavoritesTable.get_all_of_type(PINNED_FOLDER_TYPE, 0, -1)
    return favorites_to_dataclass(pinned)


@api.get("/pinned")
def get_pinned_folders():
    """
    Get pinned folders

    The current user's pinned folders (most recently pinned first) for the
    library sidebar. Each carries its explicit sidebar `position` (None until
    reordered), shared with pinned albums, playlist folders and pinned playlists.

    A pin whose folder is no longer inside a configured root dir (the root was
    removed in the settings) is left out but kept: re-adding the root brings it
    back. A folder that is merely empty right now (a share that is offline)
    stays listed with `trackcount` 0, so it can still be unpinned.
    """
    favs = [f for f in _pinned_rows() if is_path_within_root_dirs(f.hash)]
    counts = FolderStore.count_tracks_containing_paths([f.hash for f in favs])

    folders = []
    for fav, count in zip(favs, counts, strict=True):
        folder = asdict(create_folder(fav.hash, count["trackcount"]))
        # The stored key, not create_folder's re-spelling of it: it is what
        # pin_unpin and the reorder endpoint match on.
        folder["path"] = fav.hash
        folder["position"] = (fav.extra or {}).get("position")
        folders.append(folder)

    return {"folders": folders}


class PinFolderBody(BaseModel):
    path: str = Field(description="The folder to pin or unpin")


@api.post("/pin_unpin")
def pin_unpin_folder(body: PinFolderBody):
    """
    Pin/unpin a folder

    Toggles whether the folder appears in the library sidebar. Returns the new
    pinned state and the `path` the pin is stored under (resolved, POSIX, one
    trailing `/`), so the client can match it.

    Unpinning always works, even for a folder that no longer exists. Pinning is
    checked first: a folder outside the configured root dirs is 403, one that
    is not a directory 400 — and in both cases nothing is written.
    """
    key = pin_key(body.path)

    if FavoritesTable.check_exists(key, PINNED_FOLDER_TYPE):
        FavoritesTable.remove_item({"hash": key, "type": PINNED_FOLDER_TYPE})
        return {"pinned": False, "path": key}, 200

    if not is_path_within_root_dirs(key):
        return {"error": "Path not within allowed directories"}, 403

    if not Path(key).is_dir():
        return {"error": "Invalid directory"}, 400

    FavoritesTable.insert_item({"hash": key, "type": PINNED_FOLDER_TYPE, "extra": {}})
    return {"pinned": True, "path": key}, 200


class PinnedFolderPosition(BaseModel):
    path: str = Field(description="The pinned folder's path, as GET /folder/pinned returns it")
    position: int = Field(description="Explicit sidebar position")


class ReorderPinnedFoldersBody(BaseModel):
    positions: list[PinnedFolderPosition] = Field(description="Explicit pinned-folder positions")


@api.post("/pinned/order")
def reorder_pinned_folders(body: ReorderPinnedFoldersBody):
    """
    Set each pinned folder's sidebar position explicitly. Positions share one
    space with pinned albums, playlist folders and pinned playlists, so all of
    them interleave freely in the library sidebar. Unlisted folders keep their
    position; a path that is not pinned is ignored.
    """
    for item in body.positions:
        FavoritesTable.set_extra(pin_key(item.path), PINNED_FOLDER_TYPE, {"position": item.position})

    return {"msg": "Done"}, 200
