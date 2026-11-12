"""
The two jobs that move ratings between the database and the audio files (#789).

- ``write_group``: after a rating is set or cleared, writes the track's ONE
  rating into every file that shares its trackhash. Queued from the request
  (``api/ratings.py``), run in a job (``mbjobs``), never in the request: bjoern
  serves one request at a time.
- ``start_import``: reads the rating of every library file and creates the
  requesting user's ratings where that user has none (existing wins).

Which rating a file gets is decided by the database when the job runs, not by
the request that queued it: ``TrackRatingTable.latest_rating_of_track`` is the
last rater, so two quick ratings of one track always end in the newer one even
if the jobs run in the other order.

Write safety follows ``lib/track_edit.py``: a ``.bak`` copy of the file before
the write, restored on failure, removed on success. The copy costs one read and
one write of the whole file; a rating is a few bytes, so the copy is the price
of being able to put the file back if mutagen dies in the middle of a save.
"""

from __future__ import annotations

import logging
import os
import shutil
import threading

from aivinnet.db.userdata import TrackRatingTable
from aivinnet.lib import mbjobs, rating_tags
from aivinnet.lib.rating_tags import RatingTagError
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.shutdown import WRITERS

log = logging.getLogger(__name__)

# One file-writing job at a time. Two jobs for one file would interleave their
# backup and save; with the lock, each job reads the database state when it runs.
_write_lock = threading.Lock()

# One import at a time: a second one would count the same ratings twice.
_import_lock = threading.Lock()

# Tracks with a write queued but not started. Clicking through the stars queued a
# job (and a whole-file backup copy) per click; the job reads the rating when it
# runs, so one waiting job per track already writes the last state.
_queued: set[str] = set()
_queued_lock = threading.Lock()


def _group_filepaths(trackhash: str) -> list[str]:
    group = TrackStore.trackhashmap.get(trackhash)
    if group is None:
        return []
    return [track.filepath for track in group.tracks]


def _write_one(filepath: str, stars: int | None) -> str:
    """One file: "written", "cleared", "unsupported", or raises RatingTagError."""
    if not rating_tags.is_supported(filepath):
        return rating_tags.UNSUPPORTED

    backup_path = filepath + ".bak"
    # The same guard as the tag editor: a leftover backup may be the only intact copy.
    if os.path.exists(backup_path):
        raise RatingTagError(f"A backup from an earlier write is still there: {backup_path}")

    shutil.copy2(filepath, backup_path)
    try:
        result = rating_tags.write_rating(filepath, stars)
    except Exception:
        try:
            # copy2 also gives the original mtime back.
            shutil.copy2(backup_path, filepath)
            os.remove(backup_path)
        except Exception as restore_exc:
            log.critical("Rating write failed and the backup %s was KEPT: %s", backup_path, restore_exc)
        raise

    try:
        os.remove(backup_path)
    except OSError as exc:
        log.warning("Could not remove backup %s: %s", backup_path, exc)
    return result


def write_group(trackhash: str) -> dict:
    """
    Write the track's current rating (or its absence) into every file of the hash.

    Returns `{written, cleared, unsupported, failed: [{filepath, error}], stopped}`.
    """
    report: dict = {"written": 0, "cleared": 0, "unsupported": 0, "failed": [], "stopped": False}

    with _write_lock:
        stars = TrackRatingTable.latest_rating_of_track(trackhash)

        for filepath in _group_filepaths(trackhash):
            # A stop ends the job between files and says so (#296).
            if WRITERS.stopping():
                report["stopped"] = True
                break
            try:
                with WRITERS.active():
                    result = _write_one(filepath, stars)
            except (RatingTagError, OSError) as exc:
                # Nobody polls a write job: the log is where a failure is seen.
                log.warning("Rating not written into %s: %s", filepath, exc)
                report["failed"].append({"filepath": filepath, "error": str(exc)})
                continue

            if result == rating_tags.UNSUPPORTED:
                report["unsupported"] += 1
            elif result == rating_tags.CLEARED:
                report["cleared"] += 1
            else:
                report["written"] += 1

    return report


def queue_write(trackhash: str) -> str | None:
    """Start `write_group` in a job and return its id; None when one is already waiting for the track."""
    with _queued_lock:
        if trackhash in _queued:
            return None
        _queued.add(trackhash)

    def work() -> dict:
        # Leaves the queue before reading the rating: a click after this point
        # queues a new job, which then writes the newer state.
        with _queued_lock:
            _queued.discard(trackhash)
        return write_group(trackhash)

    job_id = mbjobs.create()
    # writes=True: a non-daemon thread, so a stop waits for the file in hand.
    mbjobs.spawn(job_id, work, writes=True)
    return job_id


def read_group(userid: int) -> dict:
    """
    Read the files and create `userid`'s ratings where that user has none.

    Counts per TRACK (trackhash), not per file:
    - imported: the user had no rating and a file carried one;
    - skipped: the user already rated it, no supported file carries a rating,
      or the files are in no format this reads;
    - unreadable: supported files exist but none of them could be read.
    """
    existing = TrackRatingTable.of_user(userid)
    report = {"imported": 0, "skipped": 0, "unreadable": 0}
    found: dict[str, int] = {}

    for trackhash, group in list(TrackStore.trackhashmap.items()):
        if WRITERS.stopping():
            # Nothing is written when stopping: the shutdown closes the database
            # pool, and an insert racing it is the SIGSEGV / leftover-WAL case.
            report["stopped"] = True
            return report

        if trackhash in existing:
            report["skipped"] += 1
            continue

        rating = None
        readable = 0
        supported = 0
        for track in group.tracks:
            if not rating_tags.is_supported(track.filepath):
                continue
            supported += 1
            try:
                value = rating_tags.read_rating(track.filepath)
            except RatingTagError as exc:
                log.warning("Rating import: %s", exc)
                continue
            readable += 1
            if value is not None:
                rating = value
                break  # one rating per track; the other files need not be opened

        if rating is not None:
            found[trackhash] = rating
        elif supported and not readable:
            report["unreadable"] += 1
        else:
            report["skipped"] += 1

    if found:
        # Held as a writer, so a stop waits for the insert instead of closing the pool under it.
        with WRITERS.active():
            TrackRatingTable.insert_missing(userid, found)
            # RAM from the table, not from the files: a rating the user set while the
            # import ran survives the insert (existing wins), and RAM must say the same.
            stored = TrackRatingTable.of_user(userid)
        for trackhash in found:
            group = TrackStore.trackhashmap.get(trackhash)
            if group is not None and trackhash in stored:
                group.set_rating(userid, stored[trackhash])
    report["imported"] = len(found)
    return report


def start_import(userid: int) -> str | None:
    """Start `read_group` in a job; None when an import is already running."""
    if not _import_lock.acquire(blocking=False):
        return None

    job_id = mbjobs.create()

    def work() -> dict:
        try:
            return read_group(userid)
        finally:
            _import_lock.release()

    mbjobs.spawn(job_id, work, writes=True)
    return job_id
