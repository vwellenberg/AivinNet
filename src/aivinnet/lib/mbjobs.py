"""
Short-lived result slots for lookups that must not happen in a request.

⚠️ **Why this exists at all.** On Linux the app runs under bjoern, which is
evented and single-threaded: there is no thread pool behind the handler that
could absorb one slow call. A request that waits ten seconds on musicbrainz.org
does not make one endpoint slow — it stops the whole server, `/` included. The
architecture note in CLAUDE.md states the rule; this module is how the
metadata lookups keep it.

So the endpoints start a worker and hand back a job id, and the client polls.
That is the same shape the cover batch already uses, minus the assumption that
there is only ever one job in flight — here every album view can start its own.

State lives in memory only. A restart loses pending jobs, which is correct:
their answers were about a library that is being re-read anyway, and a lookup
is a second of work to repeat.
"""

from __future__ import annotations

import threading
import uuid
from collections import OrderedDict
from typing import Any, Callable

# INFO: Slots are tiny (a list of candidates, or one album's preview), but they
# are never read again once the client has them. Keeping the newest N bounds the
# memory without a reaper thread — and a reaper is exactly the kind of endless
# thread that made `docker stop` end in SIGKILL (see CLAUDE.md).
MAX_JOBS = 64

RUNNING = "running"
DONE = "done"
ERROR = "error"

_lock = threading.Lock()
_jobs: OrderedDict[str, dict] = OrderedDict()


def create() -> str:
    """Reserve a slot and return its id."""
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {"state": RUNNING, "result": None, "error": None}
        while len(_jobs) > MAX_JOBS:
            _jobs.popitem(last=False)
    return job_id


def finish(job_id: str, result: Any) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job["state"] = DONE
        job["result"] = result


def fail(job_id: str, message: str) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job["state"] = ERROR
        job["error"] = message


def snapshot(job_id: str) -> dict | None:
    """A copy of the slot, or None when it never existed or has aged out."""
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def run(job_id: str, work: Callable[[], Any]) -> None:
    """
    Run `work` and put its outcome in the slot.

    ⚠️ Catches **everything**. This runs on a worker thread, so an exception
    that escapes here is printed to the log and then lost — the client would
    poll a slot that says "running" forever, with no way to tell that from a
    slow lookup.
    """
    try:
        finish(job_id, work())
    except Exception as e:  # see the docstring: nothing may escape a worker
        fail(job_id, str(e) or e.__class__.__name__)


def reset_for_tests() -> None:
    with _lock:
        _jobs.clear()
