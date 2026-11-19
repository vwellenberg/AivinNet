"""Tests for the MCP tools in mcp_server/server.py (search, get_album, add_tracks_to_playlist).

The `mcp` package is not part of the fast lane, so the module is loaded by path
with a stub for the one class it imports. HTTP is replaced by a recorder, so no
server is needed.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

SERVER_PATH = Path(__file__).resolve().parent.parent / "mcp_server" / "server.py"
MODULE_NAME = "aivinnet_mcp_server_under_test"

HASH_A = "11ec2166ee4398c7"
HASH_B = "a3f09b1c7d2e5480"
HASH_C = "5d0e7b9a21c4f3e8"
ALBUM_HASH = "c94b1e0f7a2d3865"


class _StubMCPServer:
    """Stands in for mcp.server.mcpserver.MCPServer: tool() is an identity decorator."""

    def __init__(self, name: str) -> None:
        self.name = name

    def tool(self):
        return lambda fn: fn

    def run(self) -> None:  # pragma: no cover - never called in tests
        pass


class FakeResponse:
    def __init__(self, status: int = 200, body=None, text: str | None = None) -> None:
        self.status_code = status
        self.ok = status < 400
        self._body = body
        if body is not None:
            self.headers = {"content-type": "application/json"}
            self.text = text if text is not None else json.dumps(body)
        else:
            self.headers = {"content-type": "text/plain"}
            self.text = text if text is not None else ""

    def json(self):
        if self._body is None:
            raise ValueError("no JSON body")
        return self._body


class FakeApi:
    """Records every call to `_api` and returns the configured response."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self.response = FakeResponse()
        # (method, path) -> response, or a list of responses used one call at a time.
        self.routes: dict[tuple[str, str], object] = {}

    def __call__(self, method, path, **kw):
        self.calls.append((method, path, kw))
        routed = self.routes.get((method, path))
        if isinstance(routed, list):
            return routed.pop(0)
        return routed if routed is not None else self.response


@pytest.fixture(scope="module")
def srv():
    inserted: list[str] = []
    for name in ("mcp", "mcp.server", "mcp.server.mcpserver"):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
            inserted.append(name)
    sys.modules["mcp.server.mcpserver"].MCPServer = _StubMCPServer

    spec = importlib.util.spec_from_file_location(MODULE_NAME, SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    try:
        sys.modules[MODULE_NAME] = module
        spec.loader.exec_module(module)
        yield module
    finally:
        sys.modules.pop(MODULE_NAME, None)
        for name in reversed(inserted):
            sys.modules.pop(name, None)


@pytest.fixture
def api(srv, monkeypatch) -> FakeApi:
    fake = FakeApi()
    monkeypatch.setattr(srv, "_api", fake)
    return fake


def _track(title: str, trackhash: str, duration: int, artists=("Adam Sporka",)) -> dict:
    return {
        "title": title,
        "artists": [{"name": n} for n in artists],
        "album": "Ancient Days",
        "duration": duration,
        "trackhash": trackhash,
        "filepath": f"Adam Sporka/Ancient Days/{title}.mp3",
    }


# ------------------------------------------------------------------ search


def test_search_tracks_calls_search_path_with_params_and_slims_results(srv, api):
    api.response = FakeResponse(
        body={"results": [_track("Saint Wenceslaus Theme", HASH_A, 183)], "more": True},
    )

    out = srv.search("saint", itemtype="tracks", limit=5)

    assert api.calls == [
        ("GET", "/search/", {"params": {"q": "saint", "itemtype": "tracks", "start": 0, "limit": 5}}),
    ]
    assert out["ok"] is True
    assert out["itemtype"] == "tracks"
    assert out["more"] is True
    assert out["results"] == [
        {
            "index": 0,
            "title": "Saint Wenceslaus Theme",
            "artists": ["Adam Sporka"],
            "album": "Ancient Days",
            "duration": 183,
            "trackhash": HASH_A,
            "filepath": "Adam Sporka/Ancient Days/Saint Wenceslaus Theme.mp3",
        }
    ]


def test_search_passes_special_characters_as_params_not_in_path(srv, api):
    api.response = FakeResponse(body={"results": [], "more": False})

    srv.search("  AC/DC & Friends?  ")

    _method, path, kw = api.calls[0]
    assert path == "/search/"
    assert kw["params"]["q"] == "AC/DC & Friends?"
    assert "?" not in path


def test_search_albums_slims_albumartists_and_date(srv, api):
    api.response = FakeResponse(
        body={
            "results": [
                {
                    "albumhash": ALBUM_HASH,
                    "title": "Ancient Days",
                    "albumartists": [{"name": "Adam Sporka"}, {"name": "Jan Valta"}],
                    "date": 1999,
                    "trackcount": 12,
                    "duration": 2400,
                }
            ],
            "more": False,
        }
    )

    out = srv.search("ancient", itemtype="albums")

    assert api.calls[0][1] == "/search/"
    assert api.calls[0][2]["params"]["itemtype"] == "albums"
    assert out == {
        "ok": True,
        "itemtype": "albums",
        "more": False,
        "results": [
            {
                "albumhash": ALBUM_HASH,
                "title": "Ancient Days",
                "albumartists": ["Adam Sporka", "Jan Valta"],
                "date": 1999,
            }
        ],
    }


def test_search_artists_slims_name_and_hash(srv, api):
    api.response = FakeResponse(
        body={"results": [{"artisthash": HASH_B, "name": "Adam Sporka", "trackcount": 40}], "more": False}
    )

    out = srv.search("sporka", itemtype="artists")

    assert out["results"] == [{"artisthash": HASH_B, "name": "Adam Sporka"}]


def test_search_tolerates_missing_keys(srv, api):
    api.response = FakeResponse(body={"results": [{"title": "Lonely"}]})

    out = srv.search("lonely", itemtype="tracks")

    assert out["ok"] is True
    assert out["more"] is False
    assert out["results"][0]["artists"] == []
    assert out["results"][0]["trackhash"] is None


def test_search_invalid_itemtype_returns_error_without_api_call(srv, api):
    out = srv.search("x", itemtype="playlists")

    assert out["ok"] is False
    assert "playlists" in out["error"]
    assert api.calls == []


@pytest.mark.parametrize("query", ["", "   ", "\t"])
def test_search_blank_query_returns_error_without_api_call(srv, api, query):
    out = srv.search(query)

    assert out["ok"] is False
    assert "query" in out["error"].lower()
    assert api.calls == []


def test_search_http_failure_reports_status_and_body(srv, api):
    api.response = FakeResponse(status=500, body={"error": "boom"})

    out = srv.search("x")

    assert out == {"ok": False, "status": 500, "error": {"error": "boom"}}


# --------------------------------------------------------------- get_album


def test_get_album_posts_hash_and_slims_tracks_with_durations(srv, api):
    api.response = FakeResponse(
        body={
            "info": {
                "albumhash": ALBUM_HASH,
                "title": "Ancient Days",
                "albumartists": [{"name": "Adam Sporka"}],
                "trackcount": 2,
                "duration": 400,
            },
            "tracks": [
                _track("Intro", HASH_A, 12),
                _track("Saint Wenceslaus Theme", HASH_B, 388),
            ],
        }
    )

    out = srv.get_album(ALBUM_HASH)

    assert api.calls == [("POST", "/album", {"json": {"albumhash": ALBUM_HASH}})]
    assert out["ok"] is True
    assert out["albumhash"] == ALBUM_HASH
    assert out["title"] == "Ancient Days"
    assert out["albumartists"] == ["Adam Sporka"]
    assert out["trackcount"] == 2
    assert out["duration"] == 400
    assert [(t["index"], t["title"], t["duration"], t["trackhash"]) for t in out["tracks"]] == [
        (0, "Intro", 12, HASH_A),
        (1, "Saint Wenceslaus Theme", 388, HASH_B),
    ]


def test_get_album_unknown_returns_404(srv, api):
    api.response = FakeResponse(status=404, body={"error": "Album not found"})

    out = srv.get_album("0000000000000000")

    assert out["ok"] is False
    assert out["status"] == 404
    assert out["error"] == {"error": "Album not found"}


# ------------------------------------------------------ add_tracks_to_playlist


COUNT_PATH = "/playlists/7?no_tracks=true"


def _count(n: int) -> FakeResponse:
    return FakeResponse(body={"info": {"id": 7, "count": n}, "tracks": []})


def _resolves(*hashes: str) -> FakeResponse:
    return FakeResponse(body={"tracks": [_track(f"T{i}", h, 60) for i, h in enumerate(hashes)]})


def _route_add(api: FakeApi, before: int, after: int, known=(HASH_A, HASH_B, HASH_C), add=None) -> None:
    api.routes[("GET", COUNT_PATH)] = [_count(before), _count(after)]
    api.routes[("POST", "/devicesync/resolve")] = _resolves(*known)
    api.routes[("POST", "/playlists/7/add")] = add or FakeResponse(body={"msg": "Done"})


def test_add_tracks_posts_joined_hashes_in_order_and_strips_and_dedups(srv, api):
    _route_add(api, before=2, after=5)

    out = srv.add_tracks_to_playlist(7, [f" {HASH_A} ", HASH_B, HASH_A, f"{HASH_C}\n"])

    adds = [c for c in api.calls if c[1] == "/playlists/7/add"]
    assert adds == [
        (
            "POST",
            "/playlists/7/add",
            {"json": {"itemtype": "tracks", "itemhash": f"{HASH_A},{HASH_B},{HASH_C}"}},
        )
    ]
    assert out == {"ok": True, "playlist_id": 7, "requested": 3, "added": 3, "skipped": 0, "count": 5}


def test_add_tracks_reports_hashes_the_playlist_already_had_as_skipped(srv, api):
    _route_add(api, before=10, after=11)

    out = srv.add_tracks_to_playlist(7, [HASH_A, HASH_B, HASH_C])

    assert out["ok"] is True
    assert (out["added"], out["skipped"], out["count"]) == (1, 2, 11)


def test_add_tracks_unknown_hash_writes_nothing_and_names_it(srv, api):
    # A hash no track carries would be stored as an orphan (blank row in the UI).
    _route_add(api, before=2, after=2, known=(HASH_A,))

    out = srv.add_tracks_to_playlist(7, [HASH_A, HASH_B])

    assert out["ok"] is False
    assert out["unknown"] == [HASH_B]
    assert not any(c[1] == "/playlists/7/add" for c in api.calls)


def test_add_tracks_checks_the_library_with_the_cleaned_hashes(srv, api):
    _route_add(api, before=0, after=2)

    srv.add_tracks_to_playlist(7, [f" {HASH_A}", HASH_B, HASH_A])

    resolve = [c for c in api.calls if c[1] == "/devicesync/resolve"]
    assert resolve == [("POST", "/devicesync/resolve", {"json": {"trackhashes": [HASH_A, HASH_B]}})]


def test_add_tracks_unknown_playlist_reports_404_without_writing(srv, api):
    api.routes[("GET", COUNT_PATH)] = FakeResponse(status=404, body={"msg": "Playlist not found"})

    out = srv.add_tracks_to_playlist(7, [HASH_A])

    assert out == {"ok": False, "status": 404, "error": {"msg": "Playlist not found"}}
    assert [c[1] for c in api.calls] == [COUNT_PATH]


def test_add_tracks_empty_list_returns_error_without_api_call(srv, api):
    out = srv.add_tracks_to_playlist(7, [])

    assert out["ok"] is False
    assert api.calls == []


def test_add_tracks_whitespace_only_hash_returns_error_without_api_call(srv, api):
    out = srv.add_tracks_to_playlist(7, [HASH_A, "   "])

    assert out["ok"] is False
    assert api.calls == []


def test_add_tracks_comma_in_hash_names_it_and_makes_no_call(srv, api):
    bad = f"{HASH_A},{HASH_B}"

    out = srv.add_tracks_to_playlist(7, [bad])

    assert out["ok"] is False
    assert bad in out["error"]
    assert api.calls == []


def test_add_tracks_single_hash_already_there_is_a_skip_not_a_failure(srv, api):
    # The server answers 409 for one hash it already has; several are skipped silently.
    _route_add(api, before=4, after=4, add=FakeResponse(status=409, body={"msg": "Track already exists in playlist"}))

    out = srv.add_tracks_to_playlist(7, [HASH_A])

    assert out == {"ok": True, "playlist_id": 7, "requested": 1, "added": 0, "skipped": 1, "count": 4}


def test_add_tracks_other_failure_is_reported(srv, api):
    _route_add(api, before=4, after=4, add=FakeResponse(status=500, text="boom"))

    out = srv.add_tracks_to_playlist(7, [HASH_A, HASH_B])

    assert out == {"ok": False, "status": 500, "error": "boom"}


def test_search_limit_below_one_returns_error_without_api_call(srv, api):
    out = srv.search("x", limit=0)

    assert out["ok"] is False
    assert api.calls == []


def test_failure_tolerates_a_json_content_type_with_a_broken_body(srv):
    class Broken(FakeResponse):
        def json(self):
            raise ValueError("not json")

    r = Broken(status=502, body={}, text="<html>bad gateway</html>")

    assert srv._failure(r) == {"ok": False, "status": 502, "error": "<html>bad gateway</html>"}
