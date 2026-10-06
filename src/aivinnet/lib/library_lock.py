"""
One lock for everything that rewrites the library: a rescan, an album apply or
merge, a single-track tag edit (with its rename).

They all change files, database rows and the RAM stores together, and none of
them knew about the others (#296). A rescan that rebuilt the store while an
apply re-indexed a file could keep that file twice or under its old path; an
edit of a file the apply was rewriting raced it for the same backup.

⚠️ Background work waits for the lock. A request never does: the server answers
one request at a time, and a request waiting for a minutes-long rescan would
stop playback for everyone. It asks ``try_hold()`` and answers 409 instead.

Re-entrant, because an apply calls the edit, which may rename.
"""

import threading
from collections.abc import Iterator
from contextlib import contextmanager

_LOCK = threading.RLock()

BUSY_MESSAGE = "The library is being updated (a scan or an album apply); try again in a moment"


class LibraryBusy(Exception):
    pass


@contextmanager
def hold() -> Iterator[None]:
    """For background work: wait until the library is free."""
    with _LOCK:
        yield


@contextmanager
def try_hold() -> Iterator[None]:
    """For a request: the library now, or LibraryBusy."""
    if not _LOCK.acquire(blocking=False):
        raise LibraryBusy(BUSY_MESSAGE)
    try:
        yield
    finally:
        _LOCK.release()
