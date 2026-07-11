"""
Online cover art search ("Find cover online").

Queries the iTunes Search API and the Deezer API (both keyless) for album
artwork matching a free-text query, merges and dedupes the results and hands
back a list of candidate image URLs with a little metadata. Also provides the
server-side download helper used when the user confirms a suggestion (browsers
generally cannot pull the foreign image URLs as blobs due to CORS, so the
download happens here).

Failures of any kind degrade gracefully: a failing source contributes zero
results, a failing download returns None. This module never raises.
"""

from __future__ import annotations

import logging
import threading
import time
from itertools import zip_longest
from urllib.parse import urlsplit

import requests

log = logging.getLogger(__name__)

ITUNES_SEARCH_URL = "https://itunes.apple.com/search"
DEEZER_SEARCH_URL = "https://api.deezer.com/search/album"

USER_AGENT = "swingmusic/aivinnet (cover art search)"

# INFO: Hosts we are willing to download a confirmed cover from. The save
# endpoints accept a URL from the client, so without this allowlist they
# would be an SSRF vector (fetch arbitrary internal URLs server-side).
# - *.mzstatic.com: iTunes/Apple Music artwork CDN
# - *.dzcdn.net:    Deezer image CDN
# - *.deezer.com:   Deezer API image redirects (api.deezer.com/album/<id>/image)
ALLOWED_HOST_SUFFIXES = (".mzstatic.com", ".dzcdn.net", ".deezer.com")

# Covers are album art; anything beyond this is not a cover image.
MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024

CACHE_TTL_SECONDS = 10 * 60
CACHE_MAX_ENTRIES = 64

_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, list[dict]]] = {}


def upscale_itunes_artwork(url: str, size: str = "600x600") -> str:
    """
    The iTunes search API only returns small artwork URLs (e.g. .../100x100bb.jpg),
    but the CDN serves other resolutions via plain URL substitution.
    """
    return url.replace("100x100bb", f"{size}bb")


def _parse_itunes(payload: dict) -> list[dict]:
    """Map an iTunes search response to our result shape."""
    results = []
    for item in payload.get("results", []):
        artwork = item.get("artworkUrl100")
        if not artwork:
            continue
        results.append(
            {
                "url": upscale_itunes_artwork(artwork),
                "source": "itunes",
                "album": item.get("collectionName", "") or "",
                "artist": item.get("artistName", "") or "",
            }
        )
    return results


def _parse_deezer(payload: dict) -> list[dict]:
    """Map a Deezer album search response to our result shape."""
    results = []
    for item in payload.get("data", []):
        cover = item.get("cover_xl") or item.get("cover_big")
        if not cover:
            continue
        artist = item.get("artist") or {}
        results.append(
            {
                "url": cover,
                "source": "deezer",
                "album": item.get("title", "") or "",
                "artist": artist.get("name", "") or "",
            }
        )
    return results


def _merge(*sources: list[dict]) -> list[dict]:
    """
    Interleave results from all sources (so shuffling alternates between
    providers) and drop duplicates of the same album+artist pair.
    """
    merged: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for group in zip_longest(*sources):
        for item in group:
            if item is None:
                continue
            key = (item["album"].strip().casefold(), item["artist"].strip().casefold())
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)

    return merged


def _fetch_json(url: str, params: dict) -> dict:
    """GET a JSON endpoint; any failure returns an empty dict."""
    try:
        res = requests.get(
            url,
            params=params,
            headers={"User-Agent": USER_AGENT},
            timeout=10,
        )
        res.raise_for_status()
        return res.json()
    except (requests.RequestException, ValueError) as e:
        log.warning("Cover search request to %s failed: %s", url, e)
        return {}


def _cache_get(key: str) -> list[dict] | None:
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        timestamp, results = entry
        if time.monotonic() - timestamp > CACHE_TTL_SECONDS:
            del _cache[key]
            return None
        return results


def _cache_put(key: str, results: list[dict]) -> None:
    with _cache_lock:
        if len(_cache) >= CACHE_MAX_ENTRIES:
            # Drop the oldest entry; a full LRU is overkill for this.
            oldest = min(_cache, key=lambda k: _cache[k][0])
            del _cache[oldest]
        _cache[key] = (time.monotonic(), results)


def search_covers(query: str, limit: int = 30) -> list[dict]:
    """
    Search iTunes and Deezer for album covers matching `query`.

    Returns a merged, deduped list of dicts:
    {"url": str, "source": "itunes"|"deezer", "album": str, "artist": str}
    """
    query = query.strip()
    if not query:
        return []

    cache_key = f"{query.casefold()}|{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    per_source = max(1, limit // 2)

    itunes = _parse_itunes(
        _fetch_json(
            ITUNES_SEARCH_URL,
            {"term": query, "entity": "album", "media": "music", "limit": per_source},
        )
    )
    deezer = _parse_deezer(_fetch_json(DEEZER_SEARCH_URL, {"q": query, "limit": per_source}))

    results = _merge(itunes, deezer)[:limit]

    # Don't cache total failure; the next attempt should retry the sources.
    if results:
        _cache_put(cache_key, results)

    return results


def is_allowed_cover_url(url: str) -> bool:
    """Only https URLs on the known artwork CDNs may be downloaded."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False

    if parts.scheme != "https" or not parts.hostname:
        return False

    hostname = parts.hostname.casefold()
    return any(hostname.endswith(suffix) for suffix in ALLOWED_HOST_SUFFIXES)


def download_cover(url: str) -> bytes | None:
    """
    Download a confirmed cover image server-side. Returns the raw bytes,
    or None if the URL is not allowed or the download fails.
    """
    if not is_allowed_cover_url(url):
        log.warning("Refusing to download cover from disallowed URL: %s", url)
        return None

    try:
        res = requests.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=15,
            allow_redirects=True,
        )
        res.raise_for_status()
    except requests.RequestException as e:
        log.warning("Cover download from %s failed: %s", url, e)
        return None

    # Redirects must also land on an allowed host.
    if res.url and not is_allowed_cover_url(res.url):
        log.warning("Cover download redirected to disallowed URL: %s", res.url)
        return None

    content = res.content
    if not content or len(content) > MAX_DOWNLOAD_BYTES:
        log.warning("Cover download from %s rejected: %d bytes", url, len(content))
        return None

    return content
