"""
Online cover art search ("Find cover online").

Queries the iTunes Search API and the Deezer API (both keyless) for album
artwork matching a free-text query, merges and dedupes the results and hands
back a list of candidate image URLs with a little metadata. Also provides the
server-side download helper used when the user confirms a suggestion (browsers
generally cannot pull the foreign image URLs as blobs due to CORS, so the
download happens here) and the thumbnail persistence helper shared with the
MusicBrainz cover fetcher.

Failures of any kind degrade gracefully: a failing source contributes zero
results, a failing download returns None. This module never raises.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from itertools import zip_longest
from urllib.parse import urljoin, urlsplit

import requests
from PIL import Image, UnidentifiedImageError

from swingmusic.lib.musicbrainz import USER_AGENT

log = logging.getLogger(__name__)

ITUNES_SEARCH_URL = "https://itunes.apple.com/search"
DEEZER_SEARCH_URL = "https://api.deezer.com/search/album"

# How many results to request from each source. The merged list is cached
# per query and sliced to the caller's limit on the way out.
FETCH_LIMIT_PER_SOURCE = 25

# Hard ceiling on how long search_covers waits for its sources. The requests
# timeout does not cover everything (e.g. connect attempts across many
# unroutable addresses), and with an evented single-threaded WSGI server a
# stuck handler freezes the whole app — so the wait is bounded here too.
FETCH_DEADLINE_SECONDS = 12

# INFO: Hosts we are willing to download a confirmed cover from. The save
# endpoints accept a URL from the client, so without this allowlist they
# would be an SSRF vector (fetch arbitrary internal URLs server-side).
# - *.mzstatic.com: iTunes/Apple Music artwork CDN
# - *.dzcdn.net:    Deezer image CDN
# - *.deezer.com:   Deezer API image redirects (api.deezer.com/album/<id>/image)
ALLOWED_HOST_SUFFIXES = (".mzstatic.com", ".dzcdn.net", ".deezer.com")

# Covers are album art; anything beyond this is not a cover image.
MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
DOWNLOAD_CHUNK_SIZE = 64 * 1024
MAX_REDIRECTS = 4

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

    cache_key = query.casefold()
    cached = _cache_get(cache_key)
    if cached is not None:
        # Copy so callers can't mutate the cached list.
        return list(cached[:limit])

    # The two sources are independent; fetch them in parallel so a slow
    # source doesn't stack on top of the other one's latency. Both waits
    # share one deadline, and shutdown must not join stuck workers — either
    # would block the request handler past FETCH_DEADLINE_SECONDS.
    pool = ThreadPoolExecutor(max_workers=2)
    try:
        itunes_future = pool.submit(
            _fetch_json,
            ITUNES_SEARCH_URL,
            {"term": query, "entity": "album", "media": "music", "limit": FETCH_LIMIT_PER_SOURCE},
        )
        deezer_future = pool.submit(_fetch_json, DEEZER_SEARCH_URL, {"q": query, "limit": FETCH_LIMIT_PER_SOURCE})

        deadline = time.monotonic() + FETCH_DEADLINE_SECONDS
        itunes_payload: dict = {}
        deezer_payload: dict = {}

        try:
            itunes_payload = itunes_future.result(timeout=max(0.0, deadline - time.monotonic()))
        except TimeoutError:
            log.warning("iTunes cover search timed out after %ss", FETCH_DEADLINE_SECONDS)

        try:
            deezer_payload = deezer_future.result(timeout=max(0.0, deadline - time.monotonic()))
        except TimeoutError:
            log.warning("Deezer cover search timed out after %ss", FETCH_DEADLINE_SECONDS)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    results = _merge(_parse_itunes(itunes_payload), _parse_deezer(deezer_payload))

    # Only cache when BOTH sources answered (an empty dict means the fetch
    # failed). A partial or total outage must not pin a degraded result set
    # for the whole TTL; a legitimate "no hits" answer may be cached.
    if itunes_payload and deezer_payload:
        _cache_put(cache_key, results)

    return list(results[:limit])


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

    Redirects are followed manually so EVERY hop is validated against the
    host allowlist BEFORE it is requested — with allow_redirects=True an
    open redirect on an allowed host could make the server fetch an
    internal URL (SSRF) even if the final response were discarded.
    """
    try:
        res = None
        for _ in range(MAX_REDIRECTS + 1):
            if not is_allowed_cover_url(url):
                log.warning("Refusing to download cover from disallowed URL: %s", url)
                return None

            res = requests.get(
                url,
                headers={"User-Agent": USER_AGENT},
                timeout=15,
                allow_redirects=False,
                stream=True,
            )

            if res.is_redirect or res.is_permanent_redirect:
                location = res.headers.get("Location")
                res.close()
                res = None
                if not location:
                    return None
                url = urljoin(url, location)
                continue

            break

        if res is None:
            log.warning("Cover download exceeded %d redirects", MAX_REDIRECTS)
            return None

        res.raise_for_status()

        declared = res.headers.get("Content-Length")
        if declared and declared.isdigit() and int(declared) > MAX_DOWNLOAD_BYTES:
            log.warning("Cover download from %s rejected: declares %s bytes", url, declared)
            return None

        # Stream with a running cap so an oversized (or lying) response
        # never gets fully buffered in memory.
        chunks: list[bytes] = []
        total = 0
        for chunk in res.iter_content(DOWNLOAD_CHUNK_SIZE):
            total += len(chunk)
            if total > MAX_DOWNLOAD_BYTES:
                log.warning("Cover download from %s rejected: exceeds %d bytes", url, MAX_DOWNLOAD_BYTES)
                return None
            chunks.append(chunk)
    except requests.RequestException as e:
        log.warning("Cover download from %s failed: %s", url, e)
        return None

    content = b"".join(chunks)
    return content or None


def _album_cover_paths(albumhash: str) -> list:
    """The album's cover file in every thumbnail size folder."""
    from swingmusic.settings import Paths

    filename = f"{albumhash}.webp"
    paths = Paths()
    return [
        paths.lg_thumb_path / filename,
        paths.md_thumb_path / filename,
        paths.sm_thumb_path / filename,
        paths.xsm_thumb_path / filename,
    ]


def backup_album_cover(albumhash: str) -> None:
    """
    Snapshot the album's current cover files for a one-level undo.

    For each size: an existing file is copied to '<file>.undo'; a missing
    file leaves a zero-byte '<file>.undo' marker meaning "there was no cover
    here — delete on restore". A later save overwrites the snapshot.
    """
    import shutil

    for path in _album_cover_paths(albumhash):
        undo = path.with_name(path.name + ".undo")
        path.parent.mkdir(parents=True, exist_ok=True)

        if path.exists():
            shutil.copy2(path, undo)
        else:
            undo.write_bytes(b"")


def undo_album_cover(albumhash: str) -> bool:
    """
    Restore the cover snapshot taken by backup_album_cover.

    Returns True when a snapshot existed and was restored, False when there
    is nothing to undo.
    """
    restored = False

    for path in _album_cover_paths(albumhash):
        undo = path.with_name(path.name + ".undo")
        if not undo.exists():
            continue

        restored = True
        if undo.stat().st_size == 0:
            # Marker: no cover existed before the save.
            path.unlink(missing_ok=True)
            undo.unlink()
        else:
            os.replace(undo, path)

    return restored


def save_album_cover_bytes(albumhash: str, image_bytes: bytes) -> str | None:
    """
    Persist a downloaded album cover as a webp in all thumbnail sizes used
    by the image server. Shared by the MusicBrainz fetcher and the online
    cover search.

    The previous cover files are snapshotted first (see backup_album_cover),
    so the save can be reverted once via undo_album_cover.

    Returns the filename ('<albumhash>.webp') on success, otherwise None.
    """
    # INFO: Imported lazily so this module stays importable in lightweight
    # unit tests that only exercise the search/download helpers.
    from swingmusic.settings import Defaults, Paths

    try:
        img = Image.open(BytesIO(image_bytes))
    except (UnidentifiedImageError, OSError) as e:
        log.warning("Cover for %s could not be decoded: %s", albumhash, e)
        return None

    filename = f"{albumhash}.webp"
    paths = Paths()
    targets = [
        (paths.lg_thumb_path / filename, Defaults.LG_THUMB_SIZE),
        (paths.md_thumb_path / filename, Defaults.MD_THUMB_SIZE),
        (paths.sm_thumb_path / filename, Defaults.SM_THUMB_SIZE),
        (paths.xsm_thumb_path / filename, Defaults.XSM_THUMB_SIZE),
    ]

    backup_album_cover(albumhash)

    try:
        width, height = img.size
        ratio = (width / height) if height else 1.0

        def _save_all(source: Image.Image) -> None:
            for path, size in targets:
                path.parent.mkdir(parents=True, exist_ok=True)
                resized = source.resize((size, max(1, int(size / ratio))), Image.Resampling.LANCZOS)
                resized.save(path, "webp")
                resized.close()

        try:
            _save_all(img)
        except OSError:
            # INFO: webp can fail on RGBA/P-mode source images; fall back to RGB.
            rgb = img.convert("RGB")
            try:
                _save_all(rgb)
            finally:
                rgb.close()
    except (OSError, ValueError) as e:
        log.warning("Saving cover for %s failed: %s", albumhash, e)
        return None
    finally:
        img.close()

    return filename
