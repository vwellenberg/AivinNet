"""Tests for the MusicBrainz batch-status tracker."""

import time

from swingmusic.lib.musicbrainz import (
    _batch_status,
    status_finish,
    status_is_running,
    status_record,
    status_reset,
    status_snapshot,
)


class TestBatchStatus:
    def _clear(self):
        """Reset module state between tests (in-process global)."""
        _batch_status.update(
            in_progress=False,
            total=0,
            fetched=0,
            failed=0,
            started_at=None,
            finished_at=None,
        )

    def setup_method(self):
        self._clear()

    def teardown_method(self):
        self._clear()

    def test_snapshot_is_copy_not_reference(self):
        snap = status_snapshot()
        snap["total"] = 999
        assert status_snapshot()["total"] == 0

    def test_reset_sets_in_progress_and_total(self):
        status_reset(total=42)
        snap = status_snapshot()
        assert snap["in_progress"] is True
        assert snap["total"] == 42
        assert snap["fetched"] == 0
        assert snap["failed"] == 0
        assert snap["started_at"] is not None
        assert snap["finished_at"] is None

    def test_record_success_increments_fetched(self):
        status_reset(total=3)
        status_record(True)
        status_record(True)
        snap = status_snapshot()
        assert snap["fetched"] == 2
        assert snap["failed"] == 0

    def test_record_failure_increments_failed(self):
        status_reset(total=3)
        status_record(False)
        snap = status_snapshot()
        assert snap["fetched"] == 0
        assert snap["failed"] == 1

    def test_finish_clears_in_progress(self):
        status_reset(total=1)
        status_record(True)
        status_finish()
        snap = status_snapshot()
        assert snap["in_progress"] is False
        assert snap["finished_at"] is not None
        # Counts must survive after finish so the UI can show "done: X of Y".
        assert snap["fetched"] == 1
        assert snap["total"] == 1

    def test_full_cycle_counts_consistent(self):
        status_reset(total=5)
        for _ in range(3):
            status_record(True)
        for _ in range(2):
            status_record(False)
        status_finish()
        snap = status_snapshot()
        assert snap["fetched"] == 3
        assert snap["failed"] == 2
        assert snap["fetched"] + snap["failed"] == snap["total"]

    def test_started_at_is_unix_timestamp(self):
        before = time.time()
        status_reset(total=1)
        snap = status_snapshot()
        assert snap["started_at"] >= before
        assert snap["started_at"] <= time.time()

    def test_is_running_reflects_state(self):
        assert status_is_running() is False
        status_reset(total=1)
        assert status_is_running() is True
        status_finish()
        assert status_is_running() is False
