"""
The cover lookup chain: MusicBrainz first, the iTunes/Deezer stores second.

Lives in this lane because `aivinnet.api.musicbrainz` imports flask_openapi3
and the stores, which the fast lane does not have. The subject under test is the
ORDER and the fall-through, not the sources themselves — those are covered by
tests/test_coverart.py and tests/test_musicbrainz_confidence.py.
"""

from types import SimpleNamespace

import pytest


@pytest.fixture()
def chain(monkeypatch):
    """
    The api module with one album in the store and both sources stubbed.

    Yields (module, calls) where `calls` records which sources were asked.
    """
    from aivinnet.api import musicbrainz as api_mb

    album = SimpleNamespace(
        title="Discovery",
        og_title="Discovery",
        albumartists=[{"name": "Daft Punk"}],
    )
    monkeypatch.setattr(api_mb.AlbumStore, "albummap", {"hash1": SimpleNamespace(album=album)})
    monkeypatch.setattr(api_mb, "save_album_cover_bytes", lambda albumhash, image: f"{albumhash}.webp")

    calls: dict[str, list] = {"mb": [], "stores": []}
    yield api_mb, calls


def _stub(monkeypatch, api_mb, calls, *, mb_result, store_result):
    def fake_mb(title, artist):
        calls["mb"].append((title, artist))
        return mb_result

    def fake_stores(title, artist):
        calls["stores"].append((title, artist))
        return store_result

    monkeypatch.setattr(api_mb, "fetch_cover_for_album", fake_mb)
    monkeypatch.setattr(api_mb, "fetch_verified_cover", fake_stores)


def test_musicbrainz_wins_and_the_stores_are_never_asked(monkeypatch, chain):
    api_mb, calls = chain
    _stub(monkeypatch, api_mb, calls, mb_result=b"MB", store_result=b"STORE")

    assert api_mb._fetch_and_save_for_albumhash("hash1") == (True, "hash1.webp")
    assert calls["mb"] == [("Discovery", "Daft Punk")]
    # The better-evidenced source answered; asking the fuzzy ones anyway would
    # spend two requests to maybe overwrite it with something weaker.
    assert calls["stores"] == []


def test_the_stores_are_asked_when_musicbrainz_has_nothing(monkeypatch, chain):
    api_mb, calls = chain
    _stub(monkeypatch, api_mb, calls, mb_result=None, store_result=b"STORE")

    assert api_mb._fetch_and_save_for_albumhash("hash1") == (True, "hash1.webp")
    assert calls["mb"] == [("Discovery", "Daft Punk")]
    assert calls["stores"] == [("Discovery", "Daft Punk")]


def test_both_empty_reports_the_cacheable_outcome(monkeypatch, chain):
    api_mb, calls = chain
    _stub(monkeypatch, api_mb, calls, mb_result=None, store_result=None)

    success, payload = api_mb._fetch_and_save_for_albumhash("hash1")
    assert success is False
    # The batch worker writes the negative cache on exactly this value. It is
    # asserted against the constant rather than a literal so the two cannot
    # drift apart — which is what would happen if a third source arrived and
    # brought its own message.
    assert payload == api_mb.NO_COVER_FOUND


def test_a_save_failure_is_not_the_cacheable_outcome(monkeypatch, chain):
    api_mb, calls = chain
    _stub(monkeypatch, api_mb, calls, mb_result=b"MB", store_result=None)
    monkeypatch.setattr(api_mb, "save_album_cover_bytes", lambda albumhash, image: None)

    success, payload = api_mb._fetch_and_save_for_albumhash("hash1")
    assert success is False
    # A cover WAS found; the disk write failed. Caching this would make a
    # transient error permanent.
    assert payload != api_mb.NO_COVER_FOUND


def test_an_unknown_album_asks_nobody(monkeypatch, chain):
    api_mb, calls = chain
    _stub(monkeypatch, api_mb, calls, mb_result=b"MB", store_result=b"STORE")

    assert api_mb._fetch_and_save_for_albumhash("nope") == (False, "Album not found")
    assert calls["mb"] == []
    assert calls["stores"] == []
