"""The three steps of fetching album metadata, through the real request cycle.

The lane matters here for two reasons beyond the usual one. The endpoints hand
back a **job id** instead of a result, so "did it answer?" and "did it do the
work?" are two different questions and a handler call could not tell them apart.
And `apply` is the one endpoint in this feature that writes to files on disk —
what it passes on, and what it refuses to do on its own, is the whole safety
story.

The network is stubbed everywhere. A test that reached musicbrainz.org would be
rate-limited, slow and dependent on someone else's data.
"""

import time
from dataclasses import dataclass, field

import pytest

ALBUM_HASH = "bfe300e966a1b2c3"


@dataclass
class FakeAlbum:
    title: str = "The Album"
    og_title: str = "The Album"
    albumartists: list = field(default_factory=lambda: [{"name": "The Band"}])


@dataclass
class FakeEntry:
    album: FakeAlbum


@dataclass
class FakeTrack:
    trackhash: str
    filepath: str
    title: str
    duration: int
    track: int = 1
    disc: int = 1


@dataclass
class FakeRemote:
    title: str
    position: int
    disc: int = 1
    length: int = 0


@pytest.fixture()
def metadata_api(api_client, monkeypatch):
    """An admin talking to a real /metadata blueprint, with no network behind it."""
    import aivinnet.api.metadata as metadata_module
    from aivinnet.lib import mbjobs

    monkeypatch.setattr("aivinnet.api.auth.current_user", {"roles": ["admin"]})
    mbjobs.reset_for_tests()

    api = api_client("aivinnet.api.metadata")
    return api, metadata_module


def await_job(api, job_id: str, timeout: float = 5.0) -> dict:
    """Poll a job the way the client does, and fail loudly on a stuck slot."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        res = api.get(f"/metadata/job/{job_id}")
        assert res.status_code == 200, res.json
        if res.json["state"] != "running":
            return res.json
        time.sleep(0.02)

    pytest.fail(f"job {job_id} never finished")


def stub_album(monkeypatch, module, tracks: list[FakeTrack]):
    monkeypatch.setattr(module.AlbumStore, "albummap", {ALBUM_HASH: FakeEntry(FakeAlbum())})
    monkeypatch.setattr(module.TrackStore, "get_tracks_by_albumhash", staticmethod(lambda _hash: list(tracks)))


class TestCandidates:
    def test_the_search_happens_off_the_request(self, metadata_api, monkeypatch):
        api, module = metadata_api
        stub_album(monkeypatch, module, [])

        started = []
        monkeypatch.setattr(
            module,
            "search_releases",
            lambda title, artist, *a, **k: (started.append((title, artist)), [_candidate()])[1],
        )

        res = api.post("/metadata/album/candidates", json={"albumhash": ALBUM_HASH})

        # The handler answers with an id, not with the answer.
        assert res.status_code == 200
        assert "job" in res.json
        assert "candidates" not in res.json

        done = await_job(api, res.json["job"])
        assert done["state"] == "done"
        assert done["result"]["candidates"][0]["title"] == "The Album"
        assert started == [("The Album", "The Band")]

    def test_an_unknown_album_is_refused_before_any_lookup(self, metadata_api, monkeypatch):
        api, module = metadata_api
        monkeypatch.setattr(module.AlbumStore, "albummap", {})

        calls = []
        monkeypatch.setattr(module, "search_releases", lambda *a, **k: calls.append(1) or [])

        res = api.post("/metadata/album/candidates", json={"albumhash": ALBUM_HASH})

        assert res.status_code == 404
        assert calls == [], "a missing album still went out to the network"


def _candidate():
    from aivinnet.lib.mbrelease import ReleaseCandidate

    return ReleaseCandidate(
        mbid="rel-1",
        title="The Album",
        artist="The Band",
        date="1999-01-01",
        country="DE",
        format="1xCD",
        track_count=3,
        score=100,
    )


class TestPreview:
    def test_it_lines_the_two_lists_up_and_writes_nothing(self, metadata_api, monkeypatch):
        api, module = metadata_api
        stub_album(
            monkeypatch,
            module,
            [
                # The reported shape: placeholder titles, every file "track 1".
                FakeTrack("h1", "/m/01.mp3", "Track 01", 180),
                FakeTrack("h2", "/m/02.mp3", "Track 02", 240),
            ],
        )
        monkeypatch.setattr(
            module,
            "fetch_release_tracks",
            lambda mbid: [FakeRemote("Opening", 1, length=181_000), FakeRemote("Closing", 2, length=240_000)],
        )
        writes = []
        monkeypatch.setattr(module, "edit_track_tags", lambda *a, **k: writes.append(1))

        res = api.post("/metadata/album/preview", json={"albumhash": ALBUM_HASH, "mbid": "rel-1"})
        done = await_job(api, res.json["job"])

        rows = done["result"]["rows"]
        assert [(r["current"]["title"], r["proposed"]["title"]) for r in rows] == [
            ("Track 01", "Opening"),
            ("Track 02", "Closing"),
        ]
        assert [r["proposed"]["track"] for r in rows] == [1, 2]
        assert done["result"]["summary"]["confident"] == 2
        # The whole point of a preview.
        assert writes == [], "the preview wrote to the library"

    def test_it_says_when_the_order_came_from_the_file_names(self, metadata_api, monkeypatch):
        api, module = metadata_api
        stub_album(
            monkeypatch,
            module,
            [FakeTrack("h1", "/m/01.mp3", "a", 180), FakeTrack("h2", "/m/02.mp3", "b", 240)],
        )
        monkeypatch.setattr(
            module,
            "fetch_release_tracks",
            lambda mbid: [FakeRemote("One", 1, length=180_000), FakeRemote("Two", 2, length=240_000)],
        )

        res = api.post("/metadata/album/preview", json={"albumhash": ALBUM_HASH, "mbid": "rel-1"})
        done = await_job(api, res.json["job"])

        # Both files say "track 1", so the order is a guess from the paths and
        # the person deserves to be told before they confirm anything.
        assert done["result"]["summary"]["ordered_by_filepath"] is True

    def test_a_missing_local_track_does_not_shift_the_titles(self, metadata_api, monkeypatch):
        api, module = metadata_api
        stub_album(
            monkeypatch,
            module,
            [FakeTrack("h1", "/m/01.mp3", "a", 180), FakeTrack("h2", "/m/02.mp3", "b", 300)],
        )
        monkeypatch.setattr(
            module,
            "fetch_release_tracks",
            lambda mbid: [
                FakeRemote("One", 1, length=180_000),
                FakeRemote("Two", 2, length=120_000),
                FakeRemote("Three", 3, length=300_000),
            ],
        )

        res = api.post("/metadata/album/preview", json={"albumhash": ALBUM_HASH, "mbid": "rel-1"})
        done = await_job(api, res.json["job"])

        pairs = [(r["current"], r["proposed"]) for r in done["result"]["rows"]]
        matched = [(c["title"], p["title"]) for c, p in pairs if c and p]
        # "b" is the release's THIRD track, not its second.
        assert matched == [("a", "One"), ("b", "Three")]
        assert done["result"]["summary"]["unmatched_remote"] == 1

    def test_a_release_without_a_track_list_says_so(self, metadata_api, monkeypatch):
        api, module = metadata_api
        stub_album(monkeypatch, module, [FakeTrack("h1", "/m/01.mp3", "a", 180)])
        monkeypatch.setattr(module, "fetch_release_tracks", lambda mbid: [])

        res = api.post("/metadata/album/preview", json={"albumhash": ALBUM_HASH, "mbid": "rel-1"})
        done = await_job(api, res.json["job"])

        assert done["result"]["rows"] == []
        assert "error" in done["result"]


class TestApply:
    def test_it_writes_exactly_what_was_confirmed(self, metadata_api, monkeypatch):
        api, module = metadata_api

        calls = []

        def fake_edit(trackhash, fields):
            calls.append((trackhash, dict(fields)))
            return type("T", (), {"trackhash": trackhash + "-new"})()

        monkeypatch.setattr(module, "edit_track_tags", fake_edit)
        looked_up = []
        monkeypatch.setattr(module, "fetch_release_tracks", lambda *a, **k: looked_up.append(1) or [])
        monkeypatch.setattr(module, "search_releases", lambda *a, **k: looked_up.append(1) or [])

        res = api.post(
            "/metadata/album/apply",
            json={"changes": [{"trackhash": "h1", "title": "Opening", "track": 1}]},
        )
        done = await_job(api, res.json["job"])

        assert calls == [("h1", {"title": "Opening", "track": 1})]
        # ⚠️ No second lookup. What the person confirmed is what gets written —
        # a fresh request here could answer differently than the preview did.
        assert looked_up == [], "apply went back to the network"
        assert done["result"]["applied"] == [{"trackhash": "h1", "new_trackhash": "h1-new"}]

    def test_one_bad_track_does_not_stop_the_others(self, metadata_api, monkeypatch):
        api, module = metadata_api
        from aivinnet.lib.track_edit import TrackEditError

        def fake_edit(trackhash, fields):
            if trackhash == "bad":
                raise TrackEditError("file is read-only")
            return type("T", (), {"trackhash": trackhash})()

        monkeypatch.setattr(module, "edit_track_tags", fake_edit)

        res = api.post(
            "/metadata/album/apply",
            json={
                "changes": [
                    {"trackhash": "h1", "track": 1},
                    {"trackhash": "bad", "track": 2},
                    {"trackhash": "h3", "track": 3},
                ]
            },
        )
        done = await_job(api, res.json["job"])

        assert [a["trackhash"] for a in done["result"]["applied"]] == ["h1", "h3"]
        assert done["result"]["failed"] == [{"trackhash": "bad", "error": "file is read-only"}]

    def test_an_empty_change_set_is_refused(self, metadata_api, monkeypatch):
        api, module = metadata_api
        calls = []
        monkeypatch.setattr(module, "edit_track_tags", lambda *a, **k: calls.append(1))

        res = api.post("/metadata/album/apply", json={"changes": []})

        assert res.status_code == 400
        assert calls == []

    def test_a_change_with_no_fields_writes_nothing(self, metadata_api, monkeypatch):
        """A row the person unticked everything on must not open the file."""
        api, module = metadata_api
        calls = []
        monkeypatch.setattr(module, "edit_track_tags", lambda *a, **k: calls.append(1))

        res = api.post("/metadata/album/apply", json={"changes": [{"trackhash": "h1"}]})
        done = await_job(api, res.json["job"])

        assert calls == []
        assert done["result"] == {"applied": [], "failed": []}


class TestJobs:
    def test_an_unknown_job_is_a_404(self, metadata_api):
        api, _ = metadata_api

        assert api.get("/metadata/job/nope").status_code == 404

    def test_a_worker_that_raises_reports_an_error_instead_of_running_forever(self, metadata_api, monkeypatch):
        api, module = metadata_api
        stub_album(monkeypatch, module, [])

        def boom(*a, **k):
            raise RuntimeError("musicbrainz said no")

        monkeypatch.setattr(module, "search_releases", boom)

        res = api.post("/metadata/album/candidates", json={"albumhash": ALBUM_HASH})
        done = await_job(api, res.json["job"])

        # Without the catch in mbjobs.run the slot would say "running" forever
        # and the client would poll a dead job.
        assert done["state"] == "error"
        assert "musicbrainz said no" in done["error"]
