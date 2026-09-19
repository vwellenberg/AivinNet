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
  with a deadline: whatever is still connected after `DRAIN_SECONDS` is cut
  off, after the cleanup ran. Nothing is lost by it — the handler only runs
  between events, so no request is ever halfway through the app when it fires.
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
        # Taken by whoever cleans up — the normal exit or the deadline — and
        # never released, so the loser cannot run the cleanup a second time.
        self._cleaning = threading.Lock()

    def install(self) -> None:
        """Only from the main thread, the one Python lets set handlers."""
        signal.signal(signal.SIGTERM, self._on_sigterm)

    def finish(self) -> None:
        """Run the cleanup after the server returned, unless the deadline already does."""
        self._cleaning.acquire()
        self.cleanup()

    def _on_sigterm(self, signum, frame) -> None:
        deadline = threading.Timer(self.drain, self._cut_off)
        deadline.name = "shutdown-deadline"
        deadline.daemon = True
        deadline.start()
        signal.raise_signal(signal.SIGINT)

    def _cut_off(self) -> None:
        if not self._cleaning.acquire(blocking=False):
            return

        print(f"Connections still open {self.drain:g} s after the stop request. Closing them.", flush=True)
        self.cleanup()
        sys.stdout.flush()
        sys.stderr.flush()
        # Not sys.exit: this is not the main thread, and the main thread is the
        # one stuck in the server loop.
        os._exit(0)
