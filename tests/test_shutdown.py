"""
ServerShutdown: SIGTERM stops the server the way Ctrl+C does, the cleanup runs
exactly once, and a process that is still around after the deadline exits.

The real process (bjoern, PID-1 semantics, the cron thread) is covered by
tests_api/test_graceful_shutdown.py and the Docker smoke test; this pins the
logic in the fast lane.
"""

import signal
import threading
import time
from unittest.mock import patch

import pytest

from aivinnet.utils.shutdown import ServerShutdown

# Every deadline in here is this short, and the fixture waits for it: a timer
# left running would call the REAL os._exit later and end the pytest session.
DRAIN = 0.05


@pytest.fixture(autouse=True)
def isolated():
    term, intr = signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGINT)
    # Python's own SIGINT handler, which is what waitress relies on.
    signal.signal(signal.SIGINT, signal.default_int_handler)
    exited = threading.Event()
    with patch("aivinnet.utils.shutdown.os._exit", side_effect=lambda code: exited.set()) as exit_:
        exit_.happened = exited
        yield exit_
        for thread in threading.enumerate():
            if thread.name == "shutdown-deadline":
                thread.join()
    signal.signal(signal.SIGTERM, term)
    signal.signal(signal.SIGINT, intr)


def test_sigterm_is_handled_at_all():
    # The bug: no handler, so as PID 1 the kernel dropped the signal.
    ServerShutdown(cleanup=lambda: None, drain=DRAIN).install()
    assert signal.getsignal(signal.SIGTERM) not in (signal.SIG_DFL, signal.SIG_IGN, None)


def test_sigterm_arrives_as_keyboard_interrupt():
    ServerShutdown(cleanup=lambda: None, drain=DRAIN).install()
    with pytest.raises(KeyboardInterrupt):
        signal.raise_signal(signal.SIGTERM)


def test_server_that_does_not_return_is_cut_off_after_cleanup(isolated):
    calls = []
    ServerShutdown(cleanup=lambda: calls.append("cleanup"), drain=DRAIN).install()

    with pytest.raises(KeyboardInterrupt):
        signal.raise_signal(signal.SIGTERM)
    # No finish(): an idle keep-alive connection keeps bjoern's loop running.
    assert isolated.happened.wait(2), "deadline never fired"

    assert calls == ["cleanup"]
    isolated.assert_called_once_with(0)


def test_cleanup_runs_once_when_finish_and_deadline_both_come():
    # finish() ran, but a non-daemon thread (a rescan) still holds the process:
    # the deadline has to exit anyway — without cleaning up a second time.
    calls = []
    shutdown = ServerShutdown(cleanup=lambda: calls.append("cleanup"), drain=DRAIN)
    shutdown.install()

    with pytest.raises(KeyboardInterrupt):
        signal.raise_signal(signal.SIGTERM)
    shutdown.finish()
    time.sleep(DRAIN * 4)

    assert calls == ["cleanup"]


def test_process_still_alive_after_finish_is_cut_off(isolated):
    shutdown = ServerShutdown(cleanup=lambda: None, drain=DRAIN)
    shutdown.install()

    with pytest.raises(KeyboardInterrupt):
        signal.raise_signal(signal.SIGTERM)
    shutdown.finish()

    assert isolated.happened.wait(2), "a lingering thread would hold the process until SIGKILL"


def test_a_second_sigterm_is_not_handed_over_again():
    # After bjoern's watcher fired, SIGINT is back at its default action: a
    # second handover would kill the process mid-drain, without the cleanup.
    ServerShutdown(cleanup=lambda: None, drain=DRAIN).install()
    with pytest.raises(KeyboardInterrupt):
        signal.raise_signal(signal.SIGTERM)

    # Caught here, or pytest would take the KeyboardInterrupt for Ctrl+C and
    # end the whole session instead of failing this one test.
    try:
        signal.raise_signal(signal.SIGTERM)
    except KeyboardInterrupt:
        pytest.fail("the second SIGTERM was handed over as SIGINT again")

    assert sum(t.name == "shutdown-deadline" for t in threading.enumerate()) <= 1


# ------------------------------------------------- library writers (#296)
# An album apply rewrites a file's tags, then its row, then its references.
# A stop between those left a file with new tags under its old row, and the rest
# of the album unprocessed and unreported.


def test_sigterm_asks_library_writers_to_stop_at_once():
    from aivinnet.utils.shutdown import LibraryWriters

    writers = LibraryWriters()
    ServerShutdown(cleanup=lambda: None, drain=DRAIN, writers=writers).install()

    with pytest.raises(KeyboardInterrupt):
        signal.raise_signal(signal.SIGTERM)

    assert writers.stopping(), "an apply would start its next file"


def test_cleanup_waits_for_the_file_in_hand():
    from aivinnet.utils.shutdown import LibraryWriters

    writers = LibraryWriters()
    order = []
    shutdown = ServerShutdown(cleanup=lambda: order.append("cleanup"), drain=DRAIN, writers=writers, write_grace=2)

    def write_one_file():
        with writers.active():
            time.sleep(0.2)
            order.append("file done")

    worker = threading.Thread(target=write_one_file)
    worker.start()
    time.sleep(0.05)
    shutdown.finish()
    worker.join()

    assert order == ["file done", "cleanup"], "the database was closed under a write"


def test_a_write_that_never_ends_does_not_hold_the_stop_for_ever():
    from aivinnet.utils.shutdown import LibraryWriters

    writers = LibraryWriters()
    calls = []
    shutdown = ServerShutdown(cleanup=lambda: calls.append("cleanup"), drain=DRAIN, writers=writers, write_grace=0.1)
    release = threading.Event()

    def stuck():
        with writers.active():
            release.wait(5)

    worker = threading.Thread(target=stuck)
    worker.start()
    time.sleep(0.05)
    started = time.monotonic()
    shutdown.finish()
    took = time.monotonic() - started
    release.set()
    worker.join()

    assert calls == ["cleanup"]
    assert took < 1
