"""
Rename track files on disk and keep the library pointing at them (#144).

What a rename has to carry along, and what it does not:

- **The trackhash does not change.** It is derived from title/album/artists,
  never from the path, so playlists, favourites and history stay attached
  without any migration. That is what makes this the harmless one of the
  track-editing operations.
- **The database row does.** `track.filepath` is UNIQUE and it is how the
  rescan recognises a file: it compares the stored path and mtime with the
  disk. `os.rename` keeps the mtime, so once the row carries the new path the
  next scan sees an unchanged file — no delete-and-re-add, no lost play counts.
- **Two in-memory indexes do:** the Track objects in `TrackStore`, and
  `FolderStore`, which the folder view reads (path -> trackhash).
- **The lyrics file does.** Lyrics are found as ``<same name>.lrc`` next to
  the audio file (`lib/lyrics.py`), so a renamed track would silently lose them.

Nothing is ever overwritten: a name that is taken is a conflict and the file
stays where it is. See `filename_pattern.plan` for how moves that free each
other's names are ordered.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from aivinnet.db.libdata import TrackTable
from aivinnet.lib import filename_pattern
from aivinnet.store.folder import FolderStore
from aivinnet.store.tracks import TrackStore

log = logging.getLogger(__name__)

# The longest name ext4 and most other file systems accept, in bytes.
_MAX_NAME_BYTES = 255


def valid_name(filepath: str, name: str) -> str | None:
    """
    Why `name` may not replace the name of `filepath`, or None when it may.

    The name comes from the client — it is what the preview showed and the
    person confirmed. So it is checked as input, not trusted as our own output:
    a bare name in the same folder, not hidden, the same kind of file.
    """
    if not name or name != os.path.basename(name) or "/" in name or "\\" in name:
        return "Not a plain file name"

    stem, suffix = os.path.splitext(name)
    if suffix.lower() != Path(filepath).suffix.lower():
        return "A rename must keep the file type"

    # The same rules the pattern writes by: no characters another system
    # rejects, no leading dot (the indexer skips dot-files as hidden).
    if not stem or filename_pattern.clean_title(stem) != stem:
        return "The name has characters a file name cannot carry"

    if len(name.encode("utf-8")) > _MAX_NAME_BYTES:
        return "The name is too long"

    return None


def _taken(path: str, source: str) -> bool:
    """Whether moving `source` to `path` would land on ANOTHER file."""
    if not os.path.exists(path):
        return False
    # A case-only rename on a case-insensitive disk: the "existing" target is
    # the file itself.
    try:
        return not os.path.samefile(path, source)
    except OSError:
        return True


def _move_lyrics(old: str, new: str) -> str | None:
    """Move ``<old>.lrc`` along. Returns a warning when it had to stay."""
    old_lrc = Path(old).with_suffix(".lrc")
    if not old_lrc.exists():
        return None

    new_lrc = Path(new).with_suffix(".lrc")
    if new_lrc.exists():
        return f"Lyrics file {new_lrc.name} already exists, {old_lrc.name} was left as it is"

    try:
        os.rename(old_lrc, new_lrc)
    except OSError as exc:
        return f"Could not move the lyrics file: {exc}"
    return None


def _move_one(old: str, new: str, tracks: list) -> str | None:
    """
    Rename one file and repoint the library at it. Returns a lyrics warning.

    Raises OSError when the file could not be moved, or when the database could
    not be updated — in which case the file has been moved back first, so disk
    and database never disagree about where the track is.

    ⚠️ Not crash-proof, and it cannot be with two separate stores: a process
    killed between the rename and the database update leaves the row on a path
    that no longer exists. The next scan then drops the row as missing and
    indexes the new name as a new file — the track is back, under the same
    hash (playlists, favourites and history hold), but the play counters kept
    in the row start over. Updating the database first would only swap which
    side is stale.
    """
    os.rename(old, new)

    try:
        if TrackTable.update_filepath(old, new) != 1:
            raise OSError("the library has no record of this file")
    except Exception as exc:
        try:
            os.rename(new, old)
        except OSError as back_exc:
            log.error(
                "CRITICAL: renamed %s -> %s, database update failed and the rename back failed too: %s",
                old,
                new,
                back_exc,
            )
        raise OSError(f"Could not update the library: {exc}") from exc

    # The Track objects are changed in place: every list, group and map that
    # holds them sees the new path, and their identity (the hash) is untouched.
    for track in tracks:
        track.filepath = new
    FolderStore.move_filepath(old, new, tracks[0].trackhash)
    return _move_lyrics(old, new)


def rename_files(moves: list[tuple[str, str]]) -> tuple[list[dict], list[dict]]:
    """
    Rename each ``(filepath, new name)``. Returns ``(applied, failed)``.

    One file failing does not stop the others. A file whose name is already
    right is neither: it is simply left alone.
    """
    applied: list[dict] = []
    failed: list[dict] = []

    # ONE pass over the store, not two per file: an album of 94 in a library of
    # 12,693 tracks would otherwise walk ~2.4M objects on a server that serves
    # one request at a time.
    requested = {filepath for filepath, _name in moves}
    by_path: dict[str, list] = {}
    for track in TrackStore.get_flat_list():
        if track.filepath in requested:
            by_path.setdefault(track.filepath, []).append(track)

    wanted: list[tuple[str, str]] = []
    for filepath, name in moves:
        if filepath not in by_path or not os.path.exists(filepath):
            failed.append({"filepath": filepath, "error": "Track not found"})
            continue
        problem = valid_name(filepath, name)
        if problem:
            failed.append({"filepath": filepath, "error": problem})
            continue
        wanted.append((filepath, name))

    # Plan against what is on disk NOW, not what the preview saw: the folder may
    # have changed in between, and the preview's answer is not a promise.
    occupied: dict[str, set[str]] = {}
    for filepath, _name in wanted:
        folder = os.path.dirname(filepath)
        if folder not in occupied:
            try:
                occupied[folder] = set(os.listdir(folder))
            except OSError:
                occupied[folder] = set()

    pending: dict[str, str] = {}
    for planned in filename_pattern.plan(wanted, occupied):
        if planned.status == filename_pattern.RENAME:
            pending[planned.filepath] = planned.target_path  # type: ignore[assignment]
        elif planned.status == filename_pattern.CONFLICT:
            failed.append({"filepath": planned.filepath, "error": "Another file already has that name"})

    # Execute in the order that frees each name before it is needed — the same
    # loop the plan simulated, now against the real disk.
    progress = True
    while pending and progress:
        progress = False
        for old, new in list(pending.items()):
            if _taken(new, old):
                continue

            del pending[old]
            progress = True
            try:
                warning = _move_one(old, new, by_path[old])
            except OSError as exc:
                log.error("Rename failed for %s: %s", old, exc)
                failed.append({"filepath": old, "error": str(exc)})
                continue

            entry = {"filepath": old, "new_filepath": new}
            if warning:
                entry["warning"] = warning
            applied.append(entry)

    for old in pending:
        failed.append({"filepath": old, "error": "Another file already has that name"})

    return applied, failed
