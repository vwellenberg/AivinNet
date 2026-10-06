"""Lookups at other services must not hold the one request thread (#295).

The server answers one request at a time, so a handler that waits on
musicbrainz.org or Musixmatch stops playback for every listener. The cover
fetch now runs as a job the client polls; the lyrics lookups get one deadline
over their whole chain and remember an outage instead of rediscovering it on
every track change.
"""

import threading
import time
from dataclasses import dataclass, field
from types import SimpleNamespace

import pytest

ALBUM_HASH = "0123456789abcdef"


@dataclass
class _Album:
    title: str = "The Album"
    og_title: str = "The Album"
    albumartists: list = field(default_factory=lambda: [{"name": "The Band"}])


# ------------------------------------------------------------- cover fetch


@pytest.fixture()
def cover_api(api_client, monkeypatch):
    import aivinnet.api.musicbrainz as mb
    from aivinnet.lib import mbjobs

    monkeypatch.setattr("aivinnet.api.auth.current_user", {"roles": ["admin"]})
    monkeypatch.setattr(mb.AlbumStore, "albummap", {ALBUM_HASH: SimpleNamespace(album=_Album())})
    mbjobs.reset_for_tests()
    return api_client("aivinnet.api.musicbrainz", "aivinnet.api.metadata"), mb


def _await_job(api, job_id: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        res = api.get(f"/metadata/job/{job_id}")
        assert res.status_code == 200, res.json
        if res.json["state"] != "running":
            return res.json
        time.sleep(0.02)
    pytest.fail(f"job {job_id} never finished")


def test_the_cover_fetch_answers_before_the_lookup_is_done(cover_api, monkeypatch):
    api, mb = cover_api
    release = threading.Event()

    def slow_chain(albumhash):
        assert release.wait(5), "the test never released the lookup"
        return True, f"{albumhash}.webp"

    monkeypatch.setattr(mb, "_fetch_and_save_for_albumhash", slow_chain)

    started = time.monotonic()
    res = api.post("/musicbrainz/fetch-cover", json={"albumhash": ALBUM_HASH})
    answered_in = time.monotonic() - started

    release.set()
    assert res.status_code == 200, res.json
    assert answered_in < 1, f"the request waited {answered_in:.1f} s for the lookup"

    done = _await_job(api, res.json["job"])
    assert done["state"] == "done"
    assert done["result"] == {"success": True, "image": f"{ALBUM_HASH}.webp"}


def test_no_cover_found_is_a_result_not_an_error(cover_api, monkeypatch):
    api, mb = cover_api
    monkeypatch.setattr(mb, "_fetch_and_save_for_albumhash", lambda _h: (False, mb.NO_COVER_FOUND))

    res = api.post("/musicbrainz/fetch-cover", json={"albumhash": ALBUM_HASH})
    done = _await_job(api, res.json["job"])

    assert done["result"] == {"success": False, "error": mb.NO_COVER_FOUND}


def test_an_unknown_album_is_refused_without_a_job(cover_api, monkeypatch):
    api, mb = cover_api
    monkeypatch.setattr(mb.AlbumStore, "albummap", {})
    monkeypatch.setattr(mb, "_fetch_and_save_for_albumhash", lambda _h: pytest.fail("looked up an unknown album"))

    res = api.post("/musicbrainz/fetch-cover", json={"albumhash": ALBUM_HASH})

    assert res.status_code == 404
    assert "job" not in res.json


# ------------------------------------------------------------------ lyrics


@pytest.fixture()
def lyrics(monkeypatch, tmp_path):
    import aivinnet.plugins.lyrics as lyrics

    monkeypatch.setattr(lyrics, "_down_until", 0.0)
    monkeypatch.setattr(lyrics, "DEADLINE_SECONDS", 0.2)
    monkeypatch.setattr(lyrics, "Paths", lambda: SimpleNamespace(lyrics_plugins_path=tmp_path))
    return lyrics


def test_a_hanging_lookup_chain_is_given_up_at_the_deadline(lyrics):
    hang = threading.Event()

    started = time.monotonic()
    result = lyrics._within_deadline(lambda: hang.wait(5), [])
    took = time.monotonic() - started
    hang.set()

    assert result == []
    assert took < 1, f"the request waited {took:.1f} s"
    assert lyrics._is_down()


def test_during_an_outage_no_call_leaves_the_server(lyrics, monkeypatch):
    provider = lyrics.LyricsProvider()
    calls = []

    def unreachable(*_a, **_k):
        calls.append(1)
        raise ConnectionError("black hole")

    monkeypatch.setattr(provider.session, "get", unreachable)
    provider.token = "t"

    assert provider.get_lrc("Title", "Ärtist") == []  # the failed search marks the outage
    assert calls == [1], "the non-ASCII retry went out although the first call had failed"

    assert lyrics._within_deadline(lambda: provider.get_lrc("Other", "Band"), []) == []
    assert calls == [1], "a lookup went out during the outage"


def test_not_found_is_an_answer_not_an_outage(lyrics, monkeypatch):
    provider = lyrics.LyricsProvider()
    provider.token = "t"
    monkeypatch.setattr(provider.session, "get", lambda *_a, **_k: SimpleNamespace(ok=False, status_code=404))

    assert provider._get("track.subtitle.get", []) is None
    assert not lyrics._is_down()


def test_a_refusal_is_an_outage(lyrics, monkeypatch):
    provider = lyrics.LyricsProvider()
    provider.token = "t"
    monkeypatch.setattr(provider.session, "get", lambda *_a, **_k: SimpleNamespace(ok=False, status_code=503))

    assert provider._get("track.search", []) is None
    assert lyrics._is_down()


def test_lookups_resume_once_the_outage_is_over(lyrics, monkeypatch):
    monkeypatch.setattr(lyrics, "_down_until", time.monotonic() - 1)

    assert lyrics._within_deadline(lambda: ["found"], []) == ["found"]
