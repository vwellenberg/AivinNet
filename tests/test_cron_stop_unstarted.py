"""
Stopping the cron jobs after a failed start must not crash the shutdown.

Regression: start_aivinnet binds the port only AFTER start_cron_jobs() has
created the cron thread. With the port taken (`OSError: [Errno 98] Address
already in use`), the shutdown ran stop_cron_jobs() on a thread that existed
but had never been started, and join() raised "RuntimeError: cannot join thread
before it is started", hiding the real error.
"""

import sys
import threading
from unittest.mock import MagicMock, patch

import pytest

# The cron module pulls in the database and every recipe at import time. The
# fast lane has neither SQLAlchemy nor schedule, so these are stubbed for the
# import only: patch.dict restores sys.modules afterwards.
_HEAVY = (
    "schedule",
    "aivinnet.db.userdata",
    "aivinnet.lib.groupsession",
    "aivinnet.lib.recipes.continuelistening",
    "aivinnet.lib.recipes.homerows",
    "aivinnet.lib.recipes.recents",
    "aivinnet.lib.recipes.records",
    "aivinnet.lib.recipes.stations",
    "aivinnet.lib.server_card",
)


@pytest.fixture
def crons():
    sys.modules.pop("aivinnet.crons", None)
    with patch.dict(sys.modules, {name: MagicMock() for name in _HEAVY}):
        import aivinnet.crons as module
    module._stop.clear()
    yield module
    module._stop.clear()


def test_stop_does_not_join_a_thread_that_was_never_started(crons, monkeypatch):
    unstarted = threading.Thread(target=lambda: None, name="cron", daemon=True)
    monkeypatch.setattr(crons, "_thread", unstarted)

    crons.stop_cron_jobs(timeout=0.1)

    assert crons._stop.is_set()
