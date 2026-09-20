"""The result slots behind the metadata lookups.

Small on purpose, but two properties are load-bearing: the table cannot grow
without bound (there is no reaper thread, and an endless thread is exactly what
made `docker stop` end in SIGKILL), and a worker that raises must leave an
error behind rather than a slot that says "running" for ever.
"""

import pytest

from aivinnet.lib import mbjobs


@pytest.fixture(autouse=True)
def clean():
    mbjobs.reset_for_tests()
    yield
    mbjobs.reset_for_tests()


class TestSlots:
    def test_a_new_job_starts_out_running(self):
        job_id = mbjobs.create()

        assert mbjobs.snapshot(job_id)["state"] == mbjobs.RUNNING

    def test_an_unknown_id_is_none_rather_than_an_empty_job(self):
        # The endpoint turns this into a 404. An empty dict would look like a
        # job that finished with no result.
        assert mbjobs.snapshot("nope") is None

    def test_a_snapshot_cannot_be_mutated_from_outside(self):
        job_id = mbjobs.create()

        mbjobs.snapshot(job_id)["state"] = "tampered"

        assert mbjobs.snapshot(job_id)["state"] == mbjobs.RUNNING


class TestRunning:
    def test_the_result_lands_in_the_slot(self):
        job_id = mbjobs.create()

        mbjobs.run(job_id, lambda: {"candidates": []})

        snap = mbjobs.snapshot(job_id)
        assert snap["state"] == mbjobs.DONE
        assert snap["result"] == {"candidates": []}

    def test_a_raising_worker_becomes_an_error_state(self):
        job_id = mbjobs.create()

        mbjobs.run(job_id, lambda: (_ for _ in ()).throw(RuntimeError("boom")))

        snap = mbjobs.snapshot(job_id)
        assert snap["state"] == mbjobs.ERROR
        assert snap["error"] == "boom"

    def test_an_exception_with_no_message_still_says_something(self):
        job_id = mbjobs.create()

        mbjobs.run(job_id, lambda: (_ for _ in ()).throw(TimeoutError()))

        # `str(TimeoutError())` is the empty string, and an error slot with an
        # empty message reads like a successful job in the UI.
        assert mbjobs.snapshot(job_id)["error"] == "TimeoutError"

    def test_finishing_a_job_that_aged_out_is_not_an_error(self):
        # The worker outlives its slot when the table has moved on. Raising
        # here would crash a thread for no reason.
        mbjobs.finish("gone", {"x": 1})
        mbjobs.fail("gone", "nope")


class TestBounds:
    def test_the_table_stops_growing(self):
        for _ in range(mbjobs.MAX_JOBS + 20):
            mbjobs.create()

        # Reaching into the module is the point: the invariant is about the
        # table, and there is no public way to ask how big it is.
        assert len(mbjobs._jobs) == mbjobs.MAX_JOBS

    def test_it_is_the_oldest_that_goes(self):
        first = mbjobs.create()
        for _ in range(mbjobs.MAX_JOBS):
            mbjobs.create()

        assert mbjobs.snapshot(first) is None
