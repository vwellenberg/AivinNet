"""One bad scrobble row must not take the home rows down for every user.

Found by the review of the release delta: untrusted scrobble fields (`source`,
`timestamp`) reached code on the shared cron thread, and one exception there
ended the thread — no home row was filled again, at every start.
"""

import threading
import time
from types import SimpleNamespace

import pytest
import schedule


def test_a_playlist_id_past_sqlites_integer_is_simply_not_a_playlist():
    from aivinnet.lib.home.create_items import _playlist_exists

    assert _playlist_exists("99999999999999999999", 1) is False
    assert _playlist_exists("-3", 1) is False
    assert _playlist_exists("abc", 1) is False


def test_rediscover_survives_plays_with_a_timestamp_at_or_before_1970():
    from aivinnet.lib.home.homerows import rank_rediscover

    plays = [SimpleNamespace(trackhash="t1", timestamp=-1) for _ in range(5)]

    ranked = rank_rediscover(plays, album_of=lambda h: "al1", now=1_800_000_000)

    assert ranked == [("al1", 5, -1)]


@pytest.fixture
def crons(monkeypatch):
    from aivinnet import crons

    monkeypatch.setattr(crons, "_stop", threading.Event())
    monkeypatch.setattr(crons, "_thread", None)
    monkeypatch.setattr(crons, "schedule", schedule.Scheduler())
    for job in ("RecentlyPlayed", "RecentlyAdded", "ContinueListening"):
        monkeypatch.setattr(crons, job, lambda *a, **kw: None)
    for job in ("Rediscover", "OnThisDay"):
        monkeypatch.setattr(crons, job, type(job, (), {"hours": 1, "__init__": lambda self, *a, **kw: None}))
    yield crons
    crons._stop.set()
    if crons._thread is not None:
        crons._thread.join(5)


def test_a_failing_startup_job_does_not_end_the_cron_thread(crons, monkeypatch):
    def boom(*a, **kw):
        raise OverflowError("Python int too large to convert to SQLite INTEGER")

    later = []
    monkeypatch.setattr(crons, "RecentlyPlayed", boom)
    monkeypatch.setattr(crons, "ContinueListening", lambda *a, **kw: later.append(True))

    crons.start_cron_jobs()
    time.sleep(0.3)

    assert later == [True], "the jobs after the failing one still ran"
    assert crons._thread.is_alive(), "the loop is still there for the reaper and the routines"


def test_an_edit_that_leaves_the_old_hash_to_another_file_carries_no_favourites(monkeypatch):
    """The database references stay on the old hash, so the RAM view must too."""
    import aivinnet.lib.track_edit as track_edit

    previous = SimpleNamespace(fav_userids=[1], playcount=7, playduration=900, lastplayed=5, color="#abc")
    new = SimpleNamespace(trackhash="h2", fav_userids=[], playcount=0, playduration=0, lastplayed=0, color="")
    monkeypatch.setattr(track_edit.TrackStore, "get_tracks_by_filepaths", classmethod(lambda cls, p: [previous]))
    monkeypatch.setattr(track_edit.TrackStore, "remove_track_by_filepath", classmethod(lambda cls, p: None))
    monkeypatch.setattr(track_edit.TrackStore, "add_track", classmethod(lambda cls, t: None))
    monkeypatch.setattr(track_edit.FolderStore, "index_file", classmethod(lambda cls, p, h: None))

    track_edit._store_track("/m/x.wav", new, carry_references=False)

    assert (new.fav_userids, new.playcount) == ([], 0)
    assert new.color == "#abc"
