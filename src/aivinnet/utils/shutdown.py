"""
Stopping on SIGTERM — the signal `docker stop` and systemd send.

⚠️ Without this the server IGNORES SIGTERM in a container. The app runs as
PID 1 there, and the kernel drops every signal PID 1 has no handler for. Python
installs one for SIGINT only, so `docker stop` waited out its grace period and
then SIGKILLed the process (`Exited (137)`), on every stop and every update —
with the SQLite database open in WAL mode.

Two properties of bjoern shape what the handler does:

- **A Python handler that raises cannot stop it.** bjoern runs its event loop in
  C and calls pending Python handlers from a timer that DISCARDS what they
  raise, so the loop would keep serving. Its one working exit is its own SIGINT
  watcher: stop accepting, leave the loop, raise KeyboardInterrupt from
  `bjoern.run`. SIGTERM is therefore handed over as SIGINT, which also stops
  waitress (whose SIGINT is Python's default KeyboardInterrupt).
- **That exit waits for every open connection, with no timeout.** An idle
  keep-alive connection — any open browser tab — or an audio stream keeps the
  loop alive, and the stop ends in SIGKILL all the same. So the handover comes
  with a deadline: a process still running `DRAIN_SECONDS` after the signal
  exits, after the cleanup ran. No request is cut in half by it — the handler
  only runs between events, so none is ever inside the app when it fires. The
  same deadline catches a non-daemon background thread (a library rescan)
  outliving the server; the rescan simply runs again on the next start.
"""

import os
import signal
import sys
import threading
from collections.abc import Callable

# Well inside Docker's 10 s grace period. What is left to drain when the
# handler runs is already-rendered responses on their way out.
DRAIN_SECONDS = 3.0


class ServerShutdown:
    """
    Stops the server on SIGTERM and runs `cleanup` exactly once on the way out.

    ``install()`` before the server starts, ``finish()`` after it returned.
    """

    def __init__(self, cleanup: Callable[[], None], drain: float = DRAIN_SECONDS):
        self.cleanup = cleanup
        self.drain = drain
        self._lock = threading.Lock()
        self._cleaned = False
        self._stopping = False

    def install(self) -> None:
        """Only from the main thread, the one Python lets set handlers."""
        signal.signal(signal.SIGTERM, self._on_sigterm)

    def finish(self) -> None:
        """Run the cleanup after the server returned."""
        self._cleanup_once()

    def _cleanup_once(self) -> None:
        # Both the normal exit and the deadline come through here, possibly at
        # the same moment. Waiting on the lock (instead of skipping) also keeps
        # the deadline from exiting while the other one is halfway through.
        with self._lock:
            if not self._cleaned:
                self._cleaned = True
                self.cleanup()

    def _on_sigterm(self, signum, frame) -> None:
        # ⚠️ Only the first one. bjoern's watcher fires once and libev then
        # resets SIGINT to its default action, so handing over a second SIGTERM
        # would KILL the process mid-drain, without the cleanup.
        if self._stopping:
            return
        self._stopping = True

        deadline = threading.Timer(self.drain, self._cut_off)
        deadline.name = "shutdown-deadline"
        deadline.daemon = True
        deadline.start()
        signal.raise_signal(signal.SIGINT)

    def _cut_off(self) -> None:
        # Also after a normal finish(): what still holds the process then is a
        # non-daemon background thread (a library rescan, say), and Docker
        # would SIGKILL it all the same.
        print(f"Still running {self.drain:g} s after the stop request. Exiting now.", flush=True)
        self._cleanup_once()
        sys.stdout.flush()
        sys.stderr.flush()
        # Not sys.exit: this is not the main thread, and the main thread is the
        # one stuck in the server loop (or waiting for that other thread).
        os._exit(0)
