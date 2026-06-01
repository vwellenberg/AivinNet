"""Tests for the MusicBrainz batch-status tracker."""

import time

from swingmusic.api.musicbrainz import (
    _batch_status,
    _status_finish,
    _status_record,
    _status_reset,
    _status_snapshot,
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
        snap = _status_snapshot()
        snap["total"] = 999
        assert _status_snapshot()["total"] == 0

    def test_reset_sets_in_progress_and_total(self):
        _status_reset(total=42)
        snap = _status_snapshot()
        assert snap["in_progress"] is True
        assert snap["total"] == 42
        assert snap["fetched"] == 0
        assert snap["failed"] == 0
        assert snap["started_at"] is not None
        assert snap["finished_at"] is None

    def test_record_success_increments_fetched(self):
        _status_reset(total=3)
        _status_record(True)
        _status_record(True)
        snap = _status_snapshot()
        assert snap["fetched"] == 2
        assert snap["failed"] == 0

    def test_record_failure_increments_failed(self):
        _status_reset(total=3)
        _status_record(False)
        snap = _status_snapshot()
        assert snap["fetched"] == 0
        assert snap["failed"] == 1

    def test_finish_clears_in_progress(self):
        _status_reset(total=1)
        _status_record(True)
        _status_finish()
        snap = _status_snapshot()
        assert snap["in_progress"] is False
        assert snap["finished_at"] is not None
        # Counts must survive after finish so the UI can show "done: X of Y".
        assert snap["fetched"] == 1
        assert snap["total"] == 1

    def test_full_cycle_counts_consistent(self):
        _status_reset(total=5)
        for _ in range(3):
            _status_record(True)
        for _ in range(2):
            _status_record(False)
        _status_finish()
        snap = _status_snapshot()
        assert snap["fetched"] == 3
        assert snap["failed"] == 2
        assert snap["fetched"] + snap["failed"] == snap["total"]

    def test_started_at_is_unix_timestamp(self):
        before = time.time()
        _status_reset(total=1)
        snap = _status_snapshot()
        assert snap["started_at"] >= before
        assert snap["started_at"] <= time.time()
