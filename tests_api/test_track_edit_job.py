"""PUT /track/<hash>/tags writes in a job, not in the request (#376).

The edit backs the whole audio file up before it writes the tags. In the
request that copy held every listener — the server answers one request at a
time — for as long as it took: seconds for a 400 MB WAV on a slow disk. Now
the route answers what it can from RAM at once and hands the write to a job;
the client polls `/metadata/job/<id>`.
"""

import threading

import pytest


class FakeTrack:
    filepath = "/m/A/song.wav"
    trackhash = "new-hash"
    fav_userids: set = set()


@pytest.fixture()
def track_api(api_client, monkeypatch):
    import aivinnet.api.track as module
    from aivinnet.lib import mbjobs

    mbjobs.reset_for_tests()
    monkeypatch.setattr("aivinnet.api.auth.current_user", {"id": 7, "roles": ["admin"]})
    # The requesting user, as the route reads it (the JWT proxy needs a real token).
    monkeypatch.setattr(module, "get_current_userid", lambda: 7)
    monkeypatch.setattr(module, "resolve_track", lambda trackhash, filepath=None: FakeTrack())
    return api_client("aivinnet.api.track"), module


def test_the_request_returns_before_the_file_is_written(track_api, monkeypatch, finish_job):
    api, module = track_api
    release = threading.Event()
    written = []

    def slow_edit(trackhash, fields, filepath=None):
        # The backup copy of a large file on a slow disk.
        assert release.wait(5), "the test never released the write"
        written.append(filepath)
        return FakeTrack()

    monkeypatch.setattr(module, "edit_track_tags", slow_edit)
    monkeypatch.setattr(module, "serialize_track", lambda track, **kw: {"filepath": track.filepath})

    res = api.put("/track/old-hash/tags", json={"title": "New"})

    # Answered while the write still waits: the server was free all along.
    assert res.status_code == 200
    assert set(res.json) == {"job"}
    assert written == []

    release.set()
    slot = finish_job(res)
    assert slot["state"] == "done"
    assert written == ["/m/A/song.wav"]
    assert slot["result"]["track"] == {"filepath": "/m/A/song.wav"}


def test_the_favourite_flag_is_the_requesting_users(track_api, monkeypatch, finish_job):
    """The job has no current user; without the id from the request it fell back to user 1."""
    api, module = track_api
    track = FakeTrack()
    track.fav_userids = {7}
    seen = []
    monkeypatch.setattr(module, "edit_track_tags", lambda trackhash, fields, filepath=None: track)
    monkeypatch.setattr(module, "serialize_track", lambda t, **kw: seen.append(kw) or {"filepath": t.filepath})

    finish_job(api.put("/track/old-hash/tags", json={"title": "New"}))

    assert seen == [{"userid": 7}]


def test_what_ram_can_answer_is_answered_in_the_request(track_api, monkeypatch):
    api, module = track_api
    from aivinnet.lib.track_edit import AmbiguousTrackError, TrackNotFoundError

    monkeypatch.setattr(module, "edit_track_tags", lambda *a, **k: pytest.fail("no job for a refused edit"))

    def missing(trackhash, filepath=None):
        raise TrackNotFoundError("Track not found")

    monkeypatch.setattr(module, "resolve_track", missing)
    assert api.put("/track/x/tags", json={"title": "New"}).status_code == 404

    def ambiguous(trackhash, filepath=None):
        raise AmbiguousTrackError(["/m/a.mp3", "/m/a.wav"])

    monkeypatch.setattr(module, "resolve_track", ambiguous)
    res = api.put("/track/x/tags", json={"title": "New"})
    assert res.status_code == 409
    assert res.json["filepaths"] == ["/m/a.mp3", "/m/a.wav"]
