"""
ServerShutdown: SIGTERM stops the server the way Ctrl+C does, the cleanup runs
exactly once, and a server that cannot drain is cut off after the deadline.

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


@pytest.fixture(autouse=True)
def restore_handlers():
    term, intr = signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGINT)
    # Python's own SIGINT handler, which is what waitress relies on.
    signal.signal(signal.SIGINT, signal.default_int_handler)
    yield
    signal.signal(signal.SIGTERM, term)
    signal.signal(signal.SIGINT, intr)


def test_sigterm_is_handled_at_all():
    # The bug: no handler, so as PID 1 the kernel dropped the signal.
    ServerShutdown(cleanup=lambda: None, drain=60).install()
    assert signal.getsignal(signal.SIGTERM) not in (signal.SIG_DFL, signal.SIG_IGN, None)


def test_sigterm_arrives_as_keyboard_interrupt():
    ServerShutdown(cleanup=lambda: None, drain=60).install()
    with pytest.raises(KeyboardInterrupt):
        signal.raise_signal(signal.SIGTERM)


def test_normal_exit_cleans_up_once_and_the_deadline_stays_quiet():
    calls = []
    shutdown = ServerShutdown(cleanup=lambda: calls.append("cleanup"), drain=0.05)
    shutdown.install()

    with patch("aivinnet.utils.shutdown.os._exit") as exit_:
        with pytest.raises(KeyboardInterrupt):
            signal.raise_signal(signal.SIGTERM)
        shutdown.finish()  # the server returned in time
        time.sleep(0.3)  # ... and the deadline fires after that

    assert calls == ["cleanup"]
    exit_.assert_not_called()


def test_server_that_does_not_return_is_cut_off_after_cleanup():
    calls = []
    exited = threading.Event()
    shutdown = ServerShutdown(cleanup=lambda: calls.append("cleanup"), drain=0.05)
    shutdown.install()

    with patch("aivinnet.utils.shutdown.os._exit", side_effect=lambda code: exited.set()) as exit_:
        with pytest.raises(KeyboardInterrupt):
            signal.raise_signal(signal.SIGTERM)
        # No finish(): an idle keep-alive connection keeps bjoern's loop running.
        assert exited.wait(2), "deadline never fired"

    assert calls == ["cleanup"]
    exit_.assert_called_once_with(0)
