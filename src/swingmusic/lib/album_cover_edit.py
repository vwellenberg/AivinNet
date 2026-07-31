"""
Write an album's cover into the audio files themselves (issue #97 P1b).

A cover is a property of the ALBUM, so this touches every file of it. That also
makes it the most destructive thing the app does to a user's library, hence the
same discipline ``track_edit`` uses for text tags: copy the file first, write,
restore the copy if anything goes wrong, and — the one deviation — carry on with
the remaining files instead of aborting the album. A per-file report goes back to
the caller, because "12 of 13 written" is information the user needs, and one
odd file must not block the other twelve.

⚠️ THE TRACKHASH DOES NOT CHANGE. ``taglib.get_tags`` derives it as
``create_hash(artists, album, title)`` — three TEXT tags, nothing else (see
``lib/albumhash.py`` for the album-side rule, which is equally text-only).
Embedding a picture touches none of them, so every playlist entry, favourite,
scrobble and queue reference survives untouched and no reindex or reference
migration is needed here. This is the opposite of ``track_edit.edit_track_tags``,
which has to migrate references precisely because it rewrites those fields — do
not copy its reindex machinery over here looking for symmetry.
"""

from __future__ import annotations

import logging
import os
import shutil
from io import BytesIO

from swingmusic.lib.cover_writer import CoverWriteError, UnsupportedCoverFormatError, supports, write_cover
from swingmusic.store.albums import AlbumStore
from swingmusic.store.tracks import TrackStore

# NOTE: do not use `from swingmusic.logger import log` — that global is None
# until setup_logger() runs and the imported name never picks up the reassignment.
log = logging.getLogger(__name__)

# JPEG, because it is the one embedded-cover format every player understands.
# The stored thumbnails are webp, which plenty of hardware players choke on.
EMBED_MIME = "image/jpeg"
EMBED_QUALITY = 90


class AlbumCoverError(Exception):
    """Raised when an album's cover cannot be embedded at all."""


def get_album_filepaths(albumhash: str) -> list[str]:
    """
    Every audio file belonging to the album, duplicates included.

    Reads the album's own track group rather than scanning the whole library
    (``TrackStore.get_tracks_by_albumhash`` walks every track and drops
    duplicates — both wrong here: this is O(album), and a duplicate file is
    still a file that needs the cover).

    A trackhash groups files by title/artists/album TEXT, so one group can span
    albums (two folders, same tags, different album hash) — hence the explicit
    albumhash check per file.
    """
    entry = AlbumStore.albummap.get(albumhash)
    if entry is None:
        raise AlbumCoverError("Album not found")

    # dict instead of set: stable order, so the report reads the same twice.
    filepaths: dict[str, None] = {}

    for trackhash in entry.trackhashes:
        group = TrackStore.trackhashmap.get(trackhash)
        if not group:
            continue

        for track in group.tracks:
            if track.albumhash == albumhash:
                filepaths[track.filepath] = None

    return list(filepaths)


def build_embeddable_cover(albumhash: str) -> tuple[bytes, int, int]:
    """
    The album's stored cover, re-encoded as a JPEG ready to embed.

    Source is the largest thumbnail on disk. The originals are not kept
    anywhere — ``coverart.save_album_cover_bytes`` only persists the four sizes
    — so the 512 px large thumbnail is the best copy the app owns. That is in
    the same league as the embedded art most files ship with, and it keeps the
    embedded picture identical to what the UI shows.

    :returns: (jpeg_bytes, width, height)
    :raises AlbumCoverError: If the album has no cover on disk.
    """
    from PIL import Image, UnidentifiedImageError

    from swingmusic.settings import Paths

    paths = Paths()
    filename = f"{albumhash}.webp"
    candidates = [
        paths.lg_thumb_path / filename,
        paths.md_thumb_path / filename,
        paths.sm_thumb_path / filename,
        paths.xsm_thumb_path / filename,
    ]

    source = next((p for p in candidates if p.exists()), None)
    if source is None:
        raise AlbumCoverError("This album has no cover to write")

    try:
        with Image.open(source) as img:
            # JPEG has no alpha channel; a webp cover may well have one.
            rgb = img.convert("RGB")
            buffer = BytesIO()
            rgb.save(buffer, "JPEG", quality=EMBED_QUALITY)
            size = rgb.size
            rgb.close()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise AlbumCoverError(f"Cover image could not be read: {exc}") from exc

    return buffer.getvalue(), size[0], size[1]


def _embed_one(filepath: str, image_bytes: bytes, width: int, height: int) -> None:
    """
    Write the cover into a single file, restoring it verbatim on failure.

    :raises CoverWriteError: With the reason, after the file was put back.
    """
    backup_path = filepath + ".bak"

    try:
        shutil.copy2(filepath, backup_path)
    except OSError as exc:
        raise CoverWriteError(f"Could not create backup: {exc}") from exc

    try:
        write_cover(filepath, image_bytes, EMBED_MIME, width, height)
    except Exception as exc:
        log.error("Embedding cover failed for %s: %s", filepath, exc)
        # Rollback must never mask the original failure with a fresh exception.
        try:
            _restore(filepath, backup_path)
        except Exception as rollback_exc:
            log.error("Rollback failed for %s: %s", filepath, rollback_exc)
        if isinstance(exc, CoverWriteError):
            raise
        raise CoverWriteError(str(exc)) from exc

    _remove_backup(backup_path)


def _restore(filepath: str, backup_path: str) -> None:
    if not os.path.exists(backup_path):
        return

    try:
        shutil.copy2(backup_path, filepath)
    except OSError as exc:
        # Do NOT delete the backup here: the restore failed, so this ``.bak`` is
        # the only intact copy of the original file. Keep it and surface its
        # path so the file can be recovered manually.
        log.error(
            "CRITICAL: failed to restore backup %s -> %s: %s. Backup KEPT at %s for manual recovery.",
            backup_path,
            filepath,
            exc,
            backup_path,
        )
        return

    _remove_backup(backup_path)


def _remove_backup(backup_path: str) -> None:
    try:
        if os.path.exists(backup_path):
            os.remove(backup_path)
    except OSError as exc:
        log.warning("Could not remove backup %s: %s", backup_path, exc)


def embed_album_cover(albumhash: str) -> dict:
    """
    Write the album's current cover into every one of its audio files.

    Runs synchronously: the caller wants the per-file verdict, and there is no
    job store to poll. A large album therefore occupies the (single-threaded)
    server for as long as copying and rewriting its files takes — acceptable for
    a deliberate one-off admin action, but the reason this is not offered as a
    bulk "do my whole library" button.

    :returns: ``{"total": int, "written": int, "failed": [{"file", "error"}]}``
    :raises AlbumCoverError: If the album is unknown, has no cover, or no files.
    """
    filepaths = get_album_filepaths(albumhash)
    if not filepaths:
        raise AlbumCoverError("This album has no files on disk")

    image_bytes, width, height = build_embeddable_cover(albumhash)

    written = 0
    failed: list[dict] = []

    for filepath in filepaths:
        if not os.path.exists(filepath):
            failed.append({"file": filepath, "error": "File not found on disk"})
            continue

        # Checked before the backup copy: no point duplicating a 200 MB file
        # only to discover its container has nowhere to put a picture.
        if not supports(filepath):
            failed.append({"file": filepath, "error": f"Unsupported format: {os.path.splitext(filepath)[1] or '?'}"})
            continue

        try:
            _embed_one(filepath, image_bytes, width, height)
        except UnsupportedCoverFormatError as exc:
            failed.append({"file": filepath, "error": str(exc)})
        except CoverWriteError as exc:
            failed.append({"file": filepath, "error": str(exc)})
        else:
            written += 1

    return {"total": len(filepaths), "written": written, "failed": failed}
