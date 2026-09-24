"""
Silence padding for the gapless skip, measured OFF the request path.

⚠️ Why this exists: measuring means decoding the whole audio file, and the
request used to wait for that (`join()` on the measuring process). bjoern serves
one request at a time, so every track change stopped the app for everyone for as
long as two files took to decode — seconds for a long FLAC.

So a request never measures. It gets what is already known, and anything that is
not known yet is queued for ONE background worker and reported as missing. The
client asks again a moment later (`client/public/workers/silence.js`). The first
play of a transition may go without the skip; from then on the value is there.

Results are keyed by path AND the file's mtime and size, so a re-encoded or
re-tagged file is measured again instead of reusing a stale number.

The measuring itself is injected (`measure`), which keeps this module free of
pydub and multiprocessing — and testable in the fast lane.
"""

import os
import queue
import threading
from collections import OrderedDict
from collections.abc import Callable

LEADING = "leading"
TRAILING = "trailing"

# "Not measured yet". Distinct from None, which is a measurement that failed.
MISSING = object()

Key = tuple[str, str, int, int]


class SilenceCache:
    def __init__(
        self,
        measure: Callable[[str, str], int | None],
        maxsize: int = 4096,
        autostart: bool = True,
    ):
        """
        :param measure: `(kind, path) -> milliseconds | None`. Blocking; only the
            worker thread ever calls it.
        :param maxsize: results kept, least recently used dropped first. Two small
            ints per track — 4096 covers a long listening history.
        :param autostart: start the worker thread on demand. Off in tests, which
            call `drain()` instead.
        """
        self._measure = measure
        self._maxsize = maxsize
        self._autostart = autostart

        self._results: OrderedDict[Key, int | None] = OrderedDict()
        self._queued: set[Key] = set()
        self._queue: queue.Queue[Key] = queue.Queue()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None

    @staticmethod
    def _key(kind: str, path: str) -> Key | None:
        try:
            stat = os.stat(path)
        except OSError:
            return None

        return (kind, path, stat.st_mtime_ns, stat.st_size)

    def lookup(self, kind: str, path: str):
        """
        The measured value, None if measuring failed or the file is gone, or
        MISSING after queueing a measurement. Never blocks on decoding.
        """
        key = self._key(kind, path)
        if key is None:
            return None

        with self._lock:
            if key in self._results:
                self._results.move_to_end(key)
                return self._results[key]

            if key not in self._queued:
                self._queued.add(key)
                self._queue.put(key)

        self._ensure_worker()
        return MISSING

    def _ensure_worker(self):
        if not self._autostart:
            return

        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return

            # ⚠️ Daemon: an endless thread without it keeps the process alive after
            # the server stops (CLAUDE.md, "STOPPEN"). Safe here because it never
            # touches the database — it only waits on a queue or on the measuring
            # process, which is a daemon process itself (lib/trackslib.py).
            self._thread = threading.Thread(target=self._run, name="silence-measure", daemon=True)
            self._thread.start()

    def _run(self):
        while True:
            self._process(self._queue.get())

    def _process(self, key: Key):
        kind, path = key[0], key[1]

        try:
            value = self._measure(kind, path)
        except Exception:
            value = None

        with self._lock:
            self._queued.discard(key)
            self._results[key] = value

            while len(self._results) > self._maxsize:
                self._results.popitem(last=False)

    def drain(self):
        """Measure everything queued, on the calling thread. For tests."""
        while True:
            try:
                key = self._queue.get_nowait()
            except queue.Empty:
                return

            self._process(key)
