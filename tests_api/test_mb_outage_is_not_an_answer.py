"""A MusicBrainz outage is not "MusicBrainz has nothing" (#296).

Every failure used to come back as None, the same value as "no match". A cover
batch running through a five-minute 503 remembered every album of that stretch
as hopeless and never asked again; the metadata dialog told the admin there was
no such album and nudged them to the file-name source.
"""

from types import SimpleNamespace

import pytest
import requests


def _answer(status, payload=None):
    return SimpleNamespace(status_code=status, json=lambda: payload or {}, content=b"img" if status == 200 else b"")


@pytest.fixture()
def mb(monkeypatch):
    from aivinnet.lib import musicbrainz

    monkeypatch.setattr(musicbrainz, "mb_throttle", lambda: None)
    return musicbrainz


def _get_returns(monkeypatch, module, value):
    def fake_get(*_a, **_k):
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(module.requests, "get", fake_get)


# ------------------------------------------------------------- the source


@pytest.mark.parametrize(
    "outage", [_answer(503), _answer(429), _answer(500), requests.ConnectionError("down"), requests.Timeout("slow")]
)
def test_an_outage_raises_instead_of_answering_none(mb, monkeypatch, outage):
    _get_returns(monkeypatch, mb, outage)

    with pytest.raises(mb.LookupUnavailable):
        mb._search_release_group_mbid("Discovery", "Daft Punk")


def test_no_match_is_still_a_plain_none(mb, monkeypatch):
    _get_returns(monkeypatch, mb, _answer(200, {"release-groups": []}))

    assert mb._search_release_group_mbid("Discovery", "Daft Punk") is None


def test_a_missing_front_cover_is_none_but_a_broken_archive_raises(mb, monkeypatch):
    _get_returns(monkeypatch, mb, _answer(404))
    assert mb._fetch_cover_bytes("mbid") is None

    _get_returns(monkeypatch, mb, _answer(502))
    with pytest.raises(mb.LookupUnavailable):
        mb._fetch_cover_bytes("mbid")


# ------------------------------------------------------------- the chain


@pytest.fixture()
def chain(monkeypatch):
    from aivinnet.api import musicbrainz as api_mb

    album = SimpleNamespace(title="Discovery", og_title="Discovery", albumartists=[{"name": "Daft Punk"}])
    monkeypatch.setattr(api_mb.AlbumStore, "albummap", {"hash1": SimpleNamespace(album=album)})
    monkeypatch.setattr(api_mb, "save_album_cover_bytes", lambda albumhash, image: f"{albumhash}.webp")

    def unavailable(_title, _artist):
        raise api_mb.LookupUnavailable("MusicBrainz is not reachable right now (HTTP 503)")

    monkeypatch.setattr(api_mb, "fetch_cover_for_album", unavailable)
    return api_mb


def test_an_outage_with_empty_stores_is_not_no_cover(chain, monkeypatch):
    monkeypatch.setattr(chain, "fetch_verified_cover", lambda *_a: None)

    assert chain._fetch_and_save_for_albumhash("hash1") == (False, chain.SOURCES_UNAVAILABLE)


def test_the_stores_still_help_during_an_outage(chain, monkeypatch):
    monkeypatch.setattr(chain, "fetch_verified_cover", lambda *_a: b"img")

    assert chain._fetch_and_save_for_albumhash("hash1") == (True, "hash1.webp")


def test_the_batch_remembers_no_cover_but_not_an_outage(chain, monkeypatch):
    class Inline:
        def __init__(self, target, args=(), kwargs=None, **_):
            self.run = lambda: target(*args, **(kwargs or {}))

        def start(self):
            self.run()

    monkeypatch.setattr("aivinnet.utils.threading.threading", SimpleNamespace(Thread=Inline))
    outcomes = {"down": (False, chain.SOURCES_UNAVAILABLE), "none": (False, chain.NO_COVER_FOUND)}
    monkeypatch.setattr(chain, "_fetch_and_save_for_albumhash", lambda h: outcomes[h])
    monkeypatch.setattr(chain, "_album_has_cover", lambda _h: False)
    for name in ("status_record", "status_finish"):
        monkeypatch.setattr(chain, name, lambda *_a: None)
    monkeypatch.setattr(chain, "status_snapshot", lambda: {"fetched": 0, "failed": 2, "total": 2})
    remembered = []
    monkeypatch.setattr(chain, "mark_failed", remembered.append)

    chain._fetch_missing_in_background(["down", "none"])

    assert remembered == ["none"]


# ------------------------------------------------------- the metadata dialog


def test_the_release_search_reports_the_outage(monkeypatch):
    from aivinnet.lib import mbrelease

    monkeypatch.setattr(mbrelease, "mb_throttle", lambda: None)
    _get_returns(monkeypatch, mbrelease, _answer(503))

    with pytest.raises(mbrelease.LookupUnavailable, match="not reachable"):
        mbrelease.search_releases("Discovery", "Daft Punk")


def test_the_dialog_job_fails_with_the_reason_instead_of_finding_nothing(api_client, monkeypatch):
    import time

    import aivinnet.api.metadata as metadata
    from aivinnet.lib import mbjobs, mbrelease

    monkeypatch.setattr("aivinnet.api.auth.current_user", {"roles": ["admin"]})
    mbjobs.reset_for_tests()
    album = SimpleNamespace(title="Discovery", og_title="Discovery", albumartists=[{"name": "Daft Punk"}])
    monkeypatch.setattr(metadata.AlbumStore, "albummap", {"bfe300e966a1b2c3": SimpleNamespace(album=album)})
    monkeypatch.setattr(mbrelease, "mb_throttle", lambda: None)
    _get_returns(monkeypatch, mbrelease, requests.ConnectionError("down"))
    api = api_client("aivinnet.api.metadata")

    job = api.post("/metadata/album/candidates", json={"albumhash": "bfe300e966a1b2c3"}).json["job"]
    for _ in range(250):
        state = api.get(f"/metadata/job/{job}").json
        if state["state"] != "running":
            break
        time.sleep(0.02)

    assert state["state"] == "error"
    assert "not reachable" in state["error"]


# ------------------------------------------------- the silence measurement
# Same theme, other source: one measurement that never answers must not stop
# the next ones (#296).


class _Stalled:
    """A measuring process that never finishes (a decode on a dead mount)."""

    instances: list = []

    def __init__(self, target=None, args=()):
        self.daemon = False
        self.alive = True
        self.terminated = False
        self.waited = []
        _Stalled.instances.append(self)

    def start(self):
        pass

    def join(self, timeout=None):
        self.waited.append(timeout)
        if self.terminated:
            self.alive = False
        return None

    def is_alive(self):
        return self.alive

    def terminate(self):
        self.terminated = True


def test_a_measurement_that_never_answers_is_given_up(monkeypatch):
    from aivinnet.lib import trackslib

    _Stalled.instances.clear()
    monkeypatch.setattr(trackslib, "ProcessWithReturnValue", _Stalled)

    assert trackslib.measure_silence("leading", "/music/stalled.flac") is None

    (process,) = _Stalled.instances
    assert process.waited[0] == trackslib.MEASURE_DEADLINE_SECONDS, "waited without a deadline"
    assert process.terminated, "the stalled process was left running"


def test_a_measurement_in_time_returns_its_value(monkeypatch):
    from aivinnet.lib import trackslib

    class Quick(_Stalled):
        def join(self, timeout=None):
            self.alive = False
            return 1234

    monkeypatch.setattr(trackslib, "ProcessWithReturnValue", Quick)

    assert trackslib.measure_silence("trailing", "/music/fine.flac") == 1234
