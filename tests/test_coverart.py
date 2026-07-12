"""Tests for swingmusic.lib.coverart (online cover search)."""

import pytest

from swingmusic.lib import coverart


@pytest.fixture(autouse=True)
def clear_cache():
    with coverart._cache_lock:
        coverart._cache.clear()
    yield
    with coverart._cache_lock:
        coverart._cache.clear()


class TestUpscaleItunesArtwork:
    def test_substitutes_size(self):
        url = "https://is1-ssl.mzstatic.com/image/thumb/x/dj.jpg/100x100bb.jpg"
        assert coverart.upscale_itunes_artwork(url) == (
            "https://is1-ssl.mzstatic.com/image/thumb/x/dj.jpg/600x600bb.jpg"
        )

    def test_custom_size(self):
        url = "https://x.mzstatic.com/a/100x100bb.jpg"
        assert coverart.upscale_itunes_artwork(url, "1200x1200") == ("https://x.mzstatic.com/a/1200x1200bb.jpg")

    def test_no_marker_unchanged(self):
        url = "https://x.mzstatic.com/a/original.jpg"
        assert coverart.upscale_itunes_artwork(url) == url


class TestParsers:
    def test_parse_itunes(self):
        payload = {
            "results": [
                {
                    "artworkUrl100": "https://x.mzstatic.com/a/100x100bb.jpg",
                    "collectionName": "Discovery",
                    "artistName": "Daft Punk",
                },
                # No artwork: skipped
                {"collectionName": "No Art", "artistName": "Nobody"},
            ]
        }
        results = coverart._parse_itunes(payload)
        assert results == [
            {
                "url": "https://x.mzstatic.com/a/600x600bb.jpg",
                "source": "itunes",
                "album": "Discovery",
                "artist": "Daft Punk",
            }
        ]

    def test_parse_deezer(self):
        payload = {
            "data": [
                {
                    "cover_xl": "https://cdn-images.dzcdn.net/c/1000x1000.jpg",
                    "title": "Discovery",
                    "artist": {"name": "Daft Punk"},
                },
                # No cover: skipped
                {"cover_xl": None, "cover_big": None, "title": "X", "artist": {"name": "Y"}},
            ]
        }
        results = coverart._parse_deezer(payload)
        assert results == [
            {
                "url": "https://cdn-images.dzcdn.net/c/1000x1000.jpg",
                "source": "deezer",
                "album": "Discovery",
                "artist": "Daft Punk",
            }
        ]

    def test_parse_deezer_falls_back_to_cover_big(self):
        payload = {
            "data": [
                {
                    "cover_xl": "",
                    "cover_big": "https://cdn-images.dzcdn.net/c/500x500.jpg",
                    "title": "A",
                    "artist": {"name": "B"},
                }
            ]
        }
        results = coverart._parse_deezer(payload)
        assert results[0]["url"] == "https://cdn-images.dzcdn.net/c/500x500.jpg"

    def test_parse_empty_payloads(self):
        assert coverart._parse_itunes({}) == []
        assert coverart._parse_deezer({}) == []


def _result(album: str, artist: str, source: str = "itunes") -> dict:
    return {"url": f"https://x/{album}", "source": source, "album": album, "artist": artist}


class TestMerge:
    def test_interleaves_sources(self):
        a = [_result("A1", "x"), _result("A2", "x")]
        b = [_result("B1", "y", "deezer"), _result("B2", "y", "deezer")]
        merged = coverart._merge(a, b)
        assert [r["album"] for r in merged] == ["A1", "B1", "A2", "B2"]

    def test_dedupes_case_insensitive(self):
        a = [_result("Discovery", "Daft Punk")]
        b = [_result("DISCOVERY", "daft punk", "deezer")]
        merged = coverart._merge(a, b)
        assert len(merged) == 1
        assert merged[0]["source"] == "itunes"

    def test_uneven_lengths(self):
        a = [_result("A1", "x")]
        b = [_result("B1", "y"), _result("B2", "y"), _result("B3", "y")]
        merged = coverart._merge(a, b)
        assert [r["album"] for r in merged] == ["A1", "B1", "B2", "B3"]


def _itunes_payload(count: int = 1) -> dict:
    return {
        "results": [
            {
                "artworkUrl100": f"https://x.mzstatic.com/{i}/100x100bb.jpg",
                "collectionName": f"iTunes Album {i}",
                "artistName": "A",
            }
            for i in range(count)
        ]
    }


def _deezer_payload(count: int = 1) -> dict:
    return {
        "data": [
            {
                "cover_xl": f"https://cdn-images.dzcdn.net/{i}/1000x1000.jpg",
                "title": f"Deezer Album {i}",
                "artist": {"name": "B"},
            }
            for i in range(count)
        ]
    }


class TestSearchCovers:
    def test_empty_query_returns_empty(self, monkeypatch):
        called = []
        monkeypatch.setattr(coverart, "_fetch_json", lambda *a, **kw: called.append(1) or {})
        assert coverart.search_covers("   ") == []
        assert called == []

    def test_merges_and_caches(self, monkeypatch):
        calls = []

        def fake_fetch(url, params):
            calls.append(url)
            return _itunes_payload() if "itunes" in url else _deezer_payload()

        monkeypatch.setattr(coverart, "_fetch_json", fake_fetch)

        results = coverart.search_covers("daft punk")
        assert [r["album"] for r in results] == ["iTunes Album 0", "Deezer Album 0"]
        assert len(calls) == 2

        # Second call (case-insensitive): served from cache, no new fetches.
        again = coverart.search_covers("Daft Punk")
        assert again == results
        assert len(calls) == 2

    def test_cache_serves_any_limit(self, monkeypatch):
        calls = []

        def fake_fetch(url, params):
            calls.append(url)
            return _itunes_payload(5) if "itunes" in url else _deezer_payload(5)

        monkeypatch.setattr(coverart, "_fetch_json", fake_fetch)

        assert len(coverart.search_covers("q", limit=30)) == 10
        assert len(coverart.search_covers("q", limit=3)) == 3
        # The second call must not refetch.
        assert len(calls) == 2

    def test_cached_list_is_copied(self, monkeypatch):
        monkeypatch.setattr(
            coverart,
            "_fetch_json",
            lambda url, params: _itunes_payload() if "itunes" in url else _deezer_payload(),
        )

        first = coverart.search_covers("q")
        first.clear()
        assert len(coverart.search_covers("q")) == 2

    def test_total_failure_not_cached(self, monkeypatch):
        calls = []
        monkeypatch.setattr(coverart, "_fetch_json", lambda *a, **kw: calls.append(1) or {})

        assert coverart.search_covers("nothing") == []
        assert coverart.search_covers("nothing") == []
        # Two searches, two sources each: all four hit the network (no caching).
        assert len(calls) == 4

    def test_partial_failure_not_cached(self, monkeypatch):
        calls = []

        def fake_fetch(url, params):
            calls.append(url)
            return _itunes_payload() if "itunes" in url else {}

        monkeypatch.setattr(coverart, "_fetch_json", fake_fetch)

        assert len(coverart.search_covers("q")) == 1
        assert len(coverart.search_covers("q")) == 1
        # Deezer failed, so the (degraded) result must not be pinned in cache.
        assert len(calls) == 4

    def test_empty_but_successful_answer_is_cached(self, monkeypatch):
        calls = []

        def fake_fetch(url, params):
            calls.append(url)
            # Non-empty payloads (HTTP success) with zero usable results.
            return {"resultCount": 0, "results": []} if "itunes" in url else {"data": [], "total": 0}

        monkeypatch.setattr(coverart, "_fetch_json", fake_fetch)

        assert coverart.search_covers("hopeless") == []
        assert coverart.search_covers("hopeless") == []
        # Second search must be served from cache.
        assert len(calls) == 2

    def test_limit_applied(self, monkeypatch):
        monkeypatch.setattr(
            coverart,
            "_fetch_json",
            lambda url, params: _itunes_payload(10) if "itunes" in url else {},
        )
        assert len(coverart.search_covers("q", limit=4)) == 4


class TestAllowedCoverUrl:
    def test_allows_known_cdns(self):
        assert coverart.is_allowed_cover_url("https://is1-ssl.mzstatic.com/image/a.jpg")
        assert coverart.is_allowed_cover_url("https://cdn-images.dzcdn.net/images/c.jpg")
        assert coverart.is_allowed_cover_url("https://api.deezer.com/album/1/image")

    def test_rejects_http(self):
        assert not coverart.is_allowed_cover_url("http://is1-ssl.mzstatic.com/a.jpg")

    def test_rejects_other_hosts(self):
        assert not coverart.is_allowed_cover_url("https://evil.com/a.jpg")
        assert not coverart.is_allowed_cover_url("https://evilmzstatic.com/a.jpg")
        assert not coverart.is_allowed_cover_url("https://mzstatic.com.evil.com/a.jpg")

    def test_rejects_userinfo_trick(self):
        # hostname is evil.com here, not mzstatic.com
        assert not coverart.is_allowed_cover_url("https://x.mzstatic.com@evil.com/a.jpg")

    def test_rejects_garbage(self):
        assert not coverart.is_allowed_cover_url("not a url")
        assert not coverart.is_allowed_cover_url("")


class FakeResponse:
    """Minimal stand-in for a streamed requests.Response."""

    def __init__(self, content=b"imagebytes", headers=None, redirect_to=None):
        self._content = content
        self.headers = dict(headers or {})
        self.is_redirect = redirect_to is not None
        self.is_permanent_redirect = False
        if redirect_to is not None:
            self.headers["Location"] = redirect_to

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size):
        for i in range(0, len(self._content), chunk_size):
            yield self._content[i : i + chunk_size]

    def close(self):
        pass


class TestDownloadCover:
    def test_disallowed_url_never_fetches(self, monkeypatch):
        def boom(*a, **kw):  # pragma: no cover - must not be called
            raise AssertionError("requests.get must not be called")

        monkeypatch.setattr(coverart.requests, "get", boom)
        assert coverart.download_cover("https://evil.com/a.jpg") is None

    def test_downloads_allowed_url(self, monkeypatch):
        monkeypatch.setattr(coverart.requests, "get", lambda *a, **kw: FakeResponse())
        assert coverart.download_cover("https://is1-ssl.mzstatic.com/a.jpg") == b"imagebytes"

    def test_follows_allowed_redirect(self, monkeypatch):
        seen = []

        def fake_get(url, **kw):
            seen.append(url)
            if url == "https://api.deezer.com/album/1/image":
                return FakeResponse(redirect_to="https://cdn-images.dzcdn.net/c/1000x1000.jpg")
            return FakeResponse(content=b"cdnbytes")

        monkeypatch.setattr(coverart.requests, "get", fake_get)
        assert coverart.download_cover("https://api.deezer.com/album/1/image") == b"cdnbytes"
        assert seen == [
            "https://api.deezer.com/album/1/image",
            "https://cdn-images.dzcdn.net/c/1000x1000.jpg",
        ]

    def test_rejects_redirect_to_disallowed_host(self, monkeypatch):
        seen = []

        def fake_get(url, **kw):
            seen.append(url)
            return FakeResponse(redirect_to="https://evil.internal/a.jpg")

        monkeypatch.setattr(coverart.requests, "get", fake_get)
        assert coverart.download_cover("https://api.deezer.com/album/1/image") is None
        # The disallowed hop must never be requested.
        assert seen == ["https://api.deezer.com/album/1/image"]

    def test_rejects_redirect_loop(self, monkeypatch):
        def fake_get(url, **kw):
            return FakeResponse(redirect_to="https://api.deezer.com/album/1/image")

        monkeypatch.setattr(coverart.requests, "get", fake_get)
        assert coverart.download_cover("https://api.deezer.com/album/1/image") is None

    def test_rejects_declared_oversize(self, monkeypatch):
        headers = {"Content-Length": str(coverart.MAX_DOWNLOAD_BYTES + 1)}
        monkeypatch.setattr(coverart.requests, "get", lambda *a, **kw: FakeResponse(headers=headers))
        assert coverart.download_cover("https://is1-ssl.mzstatic.com/a.jpg") is None

    def test_rejects_oversized_content(self, monkeypatch):
        content = b"x" * (coverart.MAX_DOWNLOAD_BYTES + 1)
        monkeypatch.setattr(coverart.requests, "get", lambda *a, **kw: FakeResponse(content=content))
        assert coverart.download_cover("https://is1-ssl.mzstatic.com/a.jpg") is None

    def test_request_exception_returns_none(self, monkeypatch):
        def boom(*a, **kw):
            raise coverart.requests.ConnectionError("nope")

        monkeypatch.setattr(coverart.requests, "get", boom)
        assert coverart.download_cover("https://is1-ssl.mzstatic.com/a.jpg") is None


class TestSaveAlbumCoverBytes:
    def test_garbage_bytes_return_none(self):
        assert coverart.save_album_cover_bytes("abc123", b"definitely not an image") is None
