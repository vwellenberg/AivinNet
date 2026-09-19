import logging
import threading

import schedule

from aivinnet.lib.groupsession import manager as group_session_manager
from aivinnet.lib.recipes.recents import RecentlyAdded, RecentlyPlayed
from aivinnet.lib.recipes.topstreamed import TopArtists

# NOTE: do not use `from aivinnet.logger import log` — that global is None until
# setup_logger() runs and the imported name never picks up the reassignment.
log = logging.getLogger(__name__)


def _reap_group_sessions():
    """
    Drop stale devices and empty sessions from the in-RAM group-session registry.

    The removed-list is intentionally ignored: the persistent device registry is
    kept fresh lazily on register/leave, not from the reaper. Wrapped in a broad
    guard so a bug here can never kill the shared cron loop thread.
    """
    try:
        group_session_manager.reap()
    except Exception:
        log.error("group-session reaper failed", exc_info=True)


# Set once, on shutdown: the loop runs no further job after the one in progress.
_stop = threading.Event()
_thread: threading.Thread | None = None


def start_cron_jobs():
    """
    Start the cron loop in a background thread.

    ⚠️ A DAEMON thread, unlike `@background`: the loop never returns, and the
    interpreter waits for every non-daemon thread before it exits. As one, it
    kept the process alive after the server had already stopped, until Docker
    SIGKILLed it.

    Daemon is only the fallback, though — the shutdown STOPS the loop first
    (`stop_cron_jobs`). A daemon thread that is inside SQLite when the
    interpreter finalizes crashes the process (SIGSEGV), and the connection it
    holds keeps the WAL from being folded back into the database.
    """
    global _thread

    _thread = threading.Thread(target=_run_cron_jobs, name="cron", daemon=True)
    _thread.start()


def stop_cron_jobs(timeout: float) -> None:
    """
    Let the job in progress finish, start no further one, and wait for the
    thread — at most `timeout` seconds. Call it BEFORE closing the database.
    """
    _stop.set()
    if _thread is not None:
        _thread.join(timeout)
        if _thread.is_alive():
            log.warning("cron job still running %s s into the shutdown", timeout)


def _run_cron_jobs():
    # The stop can come while startup still runs: the thread is started from
    # another background thread, after the plugins are registered.
    if _stop.is_set():
        return

    # NOTE: RecentlyPlayed is not a CRON job, it's triggered here to
    # populate the values for the very first time.
    RecentlyPlayed()
    RecentlyAdded()

    # Initialized CRON jobs
    TopArtists()
    TopArtists(duration="week")

    # Multiroom group-session reaper: prune offline devices / empty sessions.
    schedule.every(2).seconds.do(_reap_group_sessions)

    # Trigger all CRON jobs when the app is started. This is what makes `hours`
    # on a CronJob an INTERVAL rather than a delay before the first run — the
    # job classes themselves cannot show that, so it is spelled out there too.
    #
    # Note for anyone debugging an empty homepage row right after boot: this
    # whole function runs in a background thread (see start_cron_jobs). A job that talks
    # to anything slow has not necessarily finished, so "empty one second after
    # start" means nothing on its own.
    schedule.run_all()

    # Run all CRON jobs on a loop, until the shutdown asks it to stop.
    while not _stop.is_set():
        schedule.run_pending()
        _stop.wait(1)
