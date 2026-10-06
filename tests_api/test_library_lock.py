"""Everything that rewrites the library takes turns (#296).

A rescan, an album apply and a single-track edit changed files, rows and the
RAM stores without knowing about each other. Background work now waits for
the others; a request never waits (the server answers one at a time) and
answers 409 instead.
"""

import threading
import time

import pytest

HASH = "0123456789abcdef"


@pytest.fixture()
def held():
    """The library lock, held by another thread until the test lets go."""
    from aivinnet.lib import library_lock

    taken, release = threading.Event(), threading.Event()

    def holder():
        with library_lock.hold():
            taken.set()
            release.wait(5)

    thread = threading.Thread(target=holder)
    thread.start()
    assert taken.wait(2)
    yield release
    release.set()
    thread.join()


def test_a_request_does_not_wait_for_a_busy_library(held):
    from aivinnet.lib import library_lock

    started = time.monotonic()
    with pytest.raises(library_lock.LibraryBusy), library_lock.try_hold():
        pass
    assert time.monotonic() - started < 0.5


def test_the_lock_is_reentrant_for_an_apply_that_edits_and_renames():
    from aivinnet.lib import library_lock

    with library_lock.hold(), library_lock.try_hold(), library_lock.hold():
        pass


def test_a_tag_edit_during_a_scan_is_refused_without_writing(held, api_client, monkeypatch):
    import aivinnet.api.track as track_api

    monkeypatch.setattr("aivinnet.api.auth.current_user", {"roles": ["admin"]})
    monkeypatch.setattr(track_api, "edit_track_tags", lambda *a, **k: pytest.fail("wrote while the library was busy"))

    res = api_client("aivinnet.api.track").put(f"/track/{HASH}/tags", json={"title": "New"})

    assert res.status_code == 409
    assert res.json["busy"] is True
    assert "try again" in res.json["error"]


def test_an_apply_waits_for_a_scan_and_then_runs(held, api_client, monkeypatch):
    import aivinnet.api.metadata as metadata
    from aivinnet.lib import mbjobs

    monkeypatch.setattr("aivinnet.api.auth.current_user", {"roles": ["admin"]})
    mbjobs.reset_for_tests()
    written = []
    monkeypatch.setattr(
        metadata,
        "edit_track_tags_by_filepath",
        lambda filepath, fields, batch=None: written.append(filepath) or type("T", (), {"trackhash": "h"})(),
    )
    api = api_client("aivinnet.api.metadata")

    job = api.post("/metadata/album/apply", json={"changes": [{"filepath": "/m/01.mp3", "track": 1}]}).json["job"]
    time.sleep(0.2)
    assert written == [], "the apply ran alongside the scan"

    held.set()
    for _ in range(250):
        if api.get(f"/metadata/job/{job}").json["state"] != "running":
            break
        time.sleep(0.02)
    assert written == ["/m/01.mp3"]


def test_a_scan_waits_for_an_apply(held, monkeypatch):
    from aivinnet.lib import index

    ran = threading.Event()
    monkeypatch.setattr(index, "_index_everything", ran.set)

    index.index_everything()  # a background thread

    assert not ran.wait(0.2), "the scan ran alongside the apply"
    held.set()
    assert ran.wait(2)


def test_reading_the_store_survives_a_group_added_meanwhile(monkeypatch):
    """find_tracks_by iterated the live dict: another thread's edit raised 'changed size during iteration'."""
    from types import SimpleNamespace

    from aivinnet.store.tracks import TrackStore

    monkeypatch.setattr(TrackStore, "trackhashmap", {})
    TrackStore.add_track(SimpleNamespace(trackhash="h1", filepath="/a.mp3", albumhash="al", bitrate=1))

    def predicate(prop, value):
        # An edit on another thread lands right now.
        TrackStore.add_track(SimpleNamespace(trackhash="h2", filepath="/b.mp3", albumhash="al", bitrate=1))
        return prop == value

    found = TrackStore.find_tracks_by(key="albumhash", value="al", predicate=predicate, including_duplicates=True)

    assert [t.filepath for t in found] == ["/a.mp3"]
