"""
Which image the server answers an image request with: real artwork, or None
for the placeholder.

One decision for two readers. The image endpoints (`api/imgserver.py`) serve
the file `find_image` finds, and `GET /getall/<type>?artwork=true` reports
`has_artwork` from it, so a list cannot promise a cover the image server then
answers with its placeholder, or the reverse. A file-check-only copy of this
logic missed covers the server finds in the album's own folder ("Front
Cover.jpg" beside "Back.jpg": names the scanner does not take as a cover).

Reads files only. Serving the album folder's cover caches its thumbnails;
that is the image server's business (`FoundImage.cache_as`), not this module's.
"""

import logging
import os
from pathlib import Path
from typing import NamedTuple

from aivinnet.lib.coverart import album_cover_removed
from aivinnet.settings import Paths
from aivinnet.store.albums import AlbumStore
from aivinnet.store.tracks import TrackStore

log = logging.getLogger(__name__)

# What a warning was written for already: a folder that has gone stays gone,
# and every image request for its album would log the same line again.
_warned: set[str] = set()


def warn_once(key: str, message: str, *args: object) -> None:
    """Log a warning the first time for `key` in this process, then stay quiet."""
    if key not in _warned:
        _warned.add(key)
        log.warning(message, *args)


def find_thumbnail(albumhash: str, pathhash: str) -> tuple[Path | None, str | None, str]:
    """
    A cover image in the folder of the album's track at `pathhash`:
    (folder, file name, albumhash), or (None, None, "") when there is none.

    A folder that cannot be listed (moved since the last scan, a NAS that is
    offline) counts as "no cover". It raised before, and the image request
    answered 500 instead of the placeholder.
    """
    entry = AlbumStore.albummap.get(albumhash)

    if entry is None:
        return None, None, ""

    track_file = None

    tracks = TrackStore.get_tracks_by_trackhashes(entry.trackhashes)
    for track in tracks:
        if track.pathhash == pathhash:
            track_file = track
            break

    if track_file is None:
        return None, None, ""

    folder = Path(track_file.folder)

    # INFO: Check if the folder has image files
    extensions = [".jpg", ".jpeg", ".png", ".webp"]
    hierarchy = ["cover", "front", "back", "folder", "album", "artwork"]

    try:
        # Any case: rips from Windows tools name their covers "Folder.JPG".
        # Readable files only: a directory "Covers.jpg", a dangling link or a
        # file the server may not read is no cover (it would answer 500).
        images = [
            item
            for item in folder.iterdir()
            if item.suffix.lower() in extensions and item.is_file() and os.access(item, os.R_OK)
        ]
    except OSError as error:
        # Logged: "no cover" from a broken mount must not look like a library without covers.
        warn_once(str(folder), "Album folder not readable, no cover from it: %s (%s)", folder, error)
        return None, None, ""

    if len(images) == 0:
        return None, None, ""

    # INFO: Check if the folder has image files in the hierarchy
    for item in hierarchy:
        for image in images:
            if image.name.lower().startswith(item.lower()):
                return image.parent, image.name, track_file.albumhash

    # INFO: If no image falls in the hierarchy, return the first image
    first_image = images[0]
    return first_image.parent, first_image.name, track_file.albumhash


def best_available_thumbnail(requested_folder: Path, filename: str) -> Path | None:
    """
    The folder that holds the same thumbnail in another size, largest first.

    Albums whose cover art only exists embedded in the audio tags have no
    image file in their folder, so find_thumbnail can't (re)build the
    requested size. The scanner still extracted small/xsmall thumbnails from
    the embedded art — serving one of those beats the placeholder image.
    """
    paths = Paths()
    size_folders = [
        paths.lg_thumb_path,
        paths.md_thumb_path,
        paths.sm_thumb_path,
        paths.xsm_thumb_path,
    ]

    for folder in size_folders:
        if folder == requested_folder:
            continue

        if (folder / filename).exists():
            return folder

    return None


class FoundImage(NamedTuple):
    """Where a real image for a request lies: `send_from_directory(directory, name)`."""

    directory: Path | str
    name: str
    # Set when the image is the album folder's own cover file: its thumbnails
    # get cached under this albumhash when it is served.
    cache_as: str | None = None


def find_image(folder: Path | str, filename: str, pathhash: str = "") -> FoundImage | None:
    """
    The real image the server answers `<folder>/<filename>` with, or None for
    the placeholder (see the module docstring for who else reads this).

    A file system error (an image folder that cannot be read, a stale network
    mount) is "no image" as well: the image server sends the placeholder
    instead of 500, and `has_artwork` says false, the same answer for both.
    """
    try:
        return _find_image(folder, filename, pathhash)
    except OSError as error:
        warn_once(str(folder), "Image lookup failed, serving the placeholder for %s: %s", filename, error)
        return None


def _find_image(folder: Path | str, filename: str, pathhash: str) -> FoundImage | None:
    fpath = Path(folder) / filename

    if fpath.exists():
        return FoundImage(folder, filename)

    if pathhash != "":
        # INFO: `pathhash` is only ever set for ALBUM thumbnails, so everything
        # below is the album recovery path. A cover the user removed on purpose
        # must not sneak back in through it — the folder lookup further down
        # would happily serve the very cover.jpg that was rejected.
        if album_cover_removed(filename.replace(".webp", "")):
            return None

        # INFO: Check if the image is in the cache
        cache_path = Paths().image_cache_path / fpath.parent.name / filename
        if cache_path.exists():
            return FoundImage(cache_path.parent, cache_path.name)

        # INFO: Find the thumbnail
        parent, file, albumhash = find_thumbnail(filename.replace(".webp", ""), pathhash)
        if file is not None and parent is not None:
            return FoundImage(parent, file, cache_as=albumhash)

        # INFO: No original cover file on disk (embedded-art-only album):
        # degrade to the best available extracted thumbnail size.
        other_size = best_available_thumbnail(Path(folder), filename)
        if other_size is not None:
            return FoundImage(other_size, filename)

    return None
