"""
AivinNet MCP server — manage playlists from an MCP client (e.g. Claude).

Phase 1-3: auth + read tools (list/get) + action tools (sort tracks,
create, rename, pin).

Auth: the AivinNet API accepts a JWT in the Authorization header
(JWT_TOKEN_LOCATION includes "headers"). Configure via env:

  AIVINNET_URL   base URL (default http://192.168.0.4:1970)
  AIVINNET_TOKEN a pre-minted JWT (preferred for a quick start)
  AIVINNET_USER  / AIVINNET_PASS  used to (re)login if no/expired token

Run (stdio): python server.py
"""

from __future__ import annotations

import json
import os

import requests
from mcp.server.fastmcp import FastMCP

BASE = os.environ.get("AIVINNET_URL", "http://192.168.0.4:1970").rstrip("/")
USER = os.environ.get("AIVINNET_USER")
PASS = os.environ.get("AIVINNET_PASS")

_session = requests.Session()
_token = os.environ.get("AIVINNET_TOKEN", "")

mcp = FastMCP("aivinnet")


def _login() -> bool:
    """Log in with username/password and store the access token. Returns success."""
    global _token
    if not (USER and PASS):
        return False
    try:
        r = _session.post(f"{BASE}/auth/login", json={"username": USER, "password": PASS}, timeout=15)
    except requests.RequestException:
        return False
    if r.status_code == 200:
        _token = r.json().get("accesstoken", "") or ""
        return bool(_token)
    return False


def _api(method: str, path: str, **kw) -> requests.Response:
    """Call the AivinNet API with bearer auth; retry once after re-login on 401."""
    global _token
    url = f"{BASE}{path}"
    headers = kw.pop("headers", {})
    if _token:
        headers["Authorization"] = f"Bearer {_token}"
    r = _session.request(method, url, headers=headers, timeout=30, **kw)
    if r.status_code == 401 and _login():
        headers["Authorization"] = f"Bearer {_token}"
        r = _session.request(method, url, headers=headers, timeout=30, **kw)
    return r


def _slim_track(t: dict, index: int) -> dict:
    return {
        "index": index,
        "title": t.get("title"),
        "artists": [a.get("name") for a in (t.get("artists") or [])],
        "album": t.get("album"),
        "duration": t.get("duration"),
        "trackhash": t.get("trackhash"),
    }


# ---------------------------------------------------------------- read tools


@mcp.tool()
def list_playlists() -> list[dict]:
    """List all playlists with id, name, track count and pinned state."""
    r = _api("GET", "/playlists")
    data = r.json().get("data", []) if r.ok else []
    return [
        {"id": p.get("id"), "name": p.get("name"), "count": p.get("count"), "pinned": p.get("pinned", False)}
        for p in data
    ]


@mcp.tool()
def get_playlist(playlist_id: int) -> dict:
    """Get a playlist's info and its tracks (title, artists, album, duration, trackhash)."""
    r = _api("GET", f"/playlists/{playlist_id}?no_tracks=false&start=0&limit=-1")
    if not r.ok:
        return {"error": f"HTTP {r.status_code}"}
    j = r.json()
    info = j.get("info", {})
    tracks = j.get("tracks", [])
    return {
        "id": info.get("id"),
        "name": info.get("name"),
        "count": info.get("count"),
        "pinned": info.get("pinned", False),
        "tracks": [_slim_track(t, i) for i, t in enumerate(tracks)],
    }


# -------------------------------------------------------------- action tools


@mcp.tool()
def sort_playlist_tracks(playlist_id: int, by: str = "title", reverse: bool = False) -> dict:
    """
    Sort a playlist's tracks and save the new order.
    `by` is one of: title, artist, album, duration.
    """
    keyfns = {
        "title": lambda t: (t.get("title") or "").casefold(),
        "artist": lambda t: ((t.get("artists") or [{}])[0].get("name") or "").casefold(),
        "album": lambda t: (t.get("album") or "").casefold(),
        "duration": lambda t: t.get("duration") or 0,
    }
    keyfn = keyfns.get(by)
    if keyfn is None:
        return {"error": f"Unknown sort key '{by}'. Use one of: {', '.join(keyfns)}."}

    r = _api("GET", f"/playlists/{playlist_id}?no_tracks=false&start=0&limit=-1")
    if not r.ok:
        return {"error": f"Could not load playlist (HTTP {r.status_code})"}
    tracks = r.json().get("tracks", [])

    ordered = sorted(tracks, key=keyfn, reverse=reverse)
    hashes = [t.get("trackhash") for t in ordered if t.get("trackhash")]

    pr = _api("PUT", f"/playlists/{playlist_id}/reorder", json={"trackhashes": hashes})
    return {"ok": pr.ok, "count": len(hashes), "sorted_by": by, "reverse": reverse}


@mcp.tool()
def create_playlist(name: str) -> dict:
    """Create a new, empty playlist."""
    r = _api("POST", "/playlists/new", json={"name": name})
    if r.status_code == 201:
        return {"ok": True, "playlist": r.json().get("playlist")}
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text
    return {"ok": False, "status": r.status_code, "error": body}


@mcp.tool()
def rename_playlist(playlist_id: int, name: str) -> dict:
    """Rename a playlist (name only; keeps tracks and image)."""
    r = _api("PUT", f"/playlists/{playlist_id}/rename", json={"name": name})
    return {"ok": r.ok, "status": r.status_code, "name": name}


@mcp.tool()
def pin_playlist(playlist_id: int) -> dict:
    """Toggle pin/unpin for a playlist (pinned playlists show at the top)."""
    r = _api("POST", f"/playlists/{playlist_id}/pin_unpin")
    return {"ok": r.ok}


if __name__ == "__main__":
    # Surface a clear hint if auth isn't configured.
    if not _token and not _login():
        import sys

        print(
            "AivinNet MCP: no valid auth. Set AIVINNET_TOKEN, or AIVINNET_USER/AIVINNET_PASS.",
            file=sys.stderr,
        )
    mcp.run()
