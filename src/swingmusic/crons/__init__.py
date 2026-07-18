import time

import schedule

from swingmusic.crons.mixes import Mixes
from swingmusic.lib.groupsession import manager as group_session_manager
from swingmusic.lib.recipes.recents import RecentlyAdded, RecentlyPlayed
from swingmusic.lib.recipes.topstreamed import TopArtists
from swingmusic.logger import log
from swingmusic.utils.threading import background


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


@background
def start_cron_jobs():
    """
    This is the function that triggers the cron jobs.
    """
    # NOTE: RecentlyPlayed is not a CRON job, it's triggered here to
    # populate the values for the very first time.
    RecentlyPlayed()
    RecentlyAdded()

    # Initialized CRON jobs
    TopArtists()
    TopArtists(duration="week")
    Mixes()

    # Multiroom group-session reaper: prune offline devices / empty sessions.
    schedule.every(2).seconds.do(_reap_group_sessions)

    # Trigger all CRON jobs when the app is started.
    schedule.run_all()

    # Run all CRON jobs on a loop.
    while True:
        schedule.run_pending()
        time.sleep(1)
