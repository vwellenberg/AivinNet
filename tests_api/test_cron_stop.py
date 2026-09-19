"""
The shutdown stops the cron loop BEFORE it closes the database.

The cron thread is a daemon, so it never holds the process — but a daemon that
is inside SQLite when the interpreter finalizes crashes the process (SIGSEGV,
3 of 12 stops right after startup on a throttled CPU), and the connection it
holds keeps the WAL from being checkpointed (7 of 12). It showed up in CI as a
leftover `aivinnet.db-wal`; timing-dependent there, deterministic here.
"""

import threading
import time

import pytest
import schedule


@pytest.fixture
def crons(monkeypatch):
    from aivinnet import crons

    # Fresh state: the stop flag is one-way on purpose.
    monkeypatch.setattr(crons, "_stop", threading.Event())
    monkeypatch.setattr(crons, "_thread", None)
    monkeypatch.setattr(crons, "schedule", schedule.Scheduler())
    for job in ("RecentlyPlayed", "RecentlyAdded", "TopArtists"):
        monkeypatch.setattr(crons, job, lambda *a, **kw: None)
    yield crons
    crons._stop.set()
    if crons._thread is not None:
        crons._thread.join(5)


def test_stop_waits_for_the_job_in_progress(crons, monkeypatch):
    running, finished = threading.Event(), []

    def slow_job(*a, **kw):
        running.set()
        time.sleep(0.5)  # a query that is still running when the stop comes
        finished.append(True)

    monkeypatch.setattr(crons, "RecentlyPlayed", slow_job)
    crons.start_cron_jobs()
    assert running.wait(5)

    crons.stop_cron_jobs(timeout=5)

    assert finished == [True], "the database would have been closed under a running job"
    assert not crons._thread.is_alive()


def test_an_idle_loop_stops_at_once(crons):
    crons.start_cron_jobs()
    time.sleep(0.3)  # startup jobs done, the loop is waiting for the next tick

    started = time.monotonic()
    crons.stop_cron_jobs(timeout=5)

    # Not a full `sleep(1)` tick: the loop waits on the stop flag itself.
    assert time.monotonic() - started < 0.5
    assert not crons._thread.is_alive()


def test_a_stop_during_startup_runs_no_job(crons, monkeypatch):
    # The thread is started from another background thread, after the plugins
    # are registered — a stop can come first, and the database is closed then.
    ran = []
    monkeypatch.setattr(crons, "RecentlyPlayed", lambda *a, **kw: ran.append(True))

    crons.stop_cron_jobs(timeout=1)
    crons.start_cron_jobs()
    crons._thread.join(5)

    assert ran == []
