"""
MusicBrainz / Cover Art Archive integration.

Provides a single helper function that, given an album title and artist name,
searches MusicBrainz for a matching release group and downloads the front
cover from the Cover Art Archive.

Usage policy notes (https://musicbrainz.org/doc/MusicBrainz_API):
- A descriptive User-Agent header is required.
- Anonymous clients are limited to ~1 request/second.

Failures of any kind return None; this module never raises.
"""

from __future__ import annotations

import logging
import threading
import time

import requests

log = logging.getLogger(__name__)


# INFO: Module-global batch status. The frontend polls GET /musicbrainz/status
# to render a progress bar. A lock guards every read/write so a polling
# request sees a consistent snapshot (no torn values like fetched > total).
# Lives in this lib (not the api module) so it can be tested without Flask
# or pydantic on PATH.
_status_lock = threading.Lock()
_batch_status: dict = {
    "in_progress": False,
    "total": 0,
    "fetched": 0,
    "failed": 0,
    "started_at": None,
    "finished_at": None,
}


def status_snapshot() -> dict:
    with _status_lock:
        return dict(_batch_status)


def status_reset(total: int) -> None:
    with _status_lock:
        _batch_status["in_progress"] = True
        _batch_status["total"] = total
        _batch_status["fetched"] = 0
        _batch_status["failed"] = 0
        _batch_status["started_at"] = time.time()
        _batch_status["finished_at"] = None


def status_record(success: bool) -> None:
    with _status_lock:
        if success:
            _batch_status["fetched"] += 1
        else:
            _batch_status["failed"] += 1


def status_finish() -> None:
    with _status_lock:
        _batch_status["in_progress"] = False
        _batch_status["finished_at"] = time.time()


def status_is_running() -> bool:
    with _status_lock:
        return _batch_status["in_progress"]


# INFO: Negative cache of albumhashes that MusicBrainz had no cover for. These
# are skipped on subsequent batch runs so we don't hammer MusicBrainz with the
# same hopeless lookups every time (most game soundtracks simply aren't there).
# Persisted to a small JSON file so it survives restarts; load it lazily.
_failed_lock = threading.Lock()
_failed_cache: set[str] | None = None


def _failed_cache_file():
    # Imported here to avoid any import-time cost / circular import.
    from swingmusic.settings import Paths

    return Paths().config_dir / "mb_failed_covers.json"


def _persist_failed_locked() -> None:
    import json

    try:
        path = _failed_cache_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(sorted(_failed_cache or []), fh)
    except OSError as e:
        log.warning("Could not persist MusicBrainz failed-cover cache: %s", e)


def load_failed() -> set[str]:
    """Return (and lazily load) the set of albumhashes with no MB cover."""
    global _failed_cache
    import json

    with _failed_lock:
        if _failed_cache is None:
            try:
                with open(_failed_cache_file(), "r", encoding="utf-8") as fh:
                    _failed_cache = set(json.load(fh))
            except (FileNotFoundError, ValueError, OSError):
                _failed_cache = set()
        return set(_failed_cache)


def is_failed(albumhash: str) -> bool:
    return albumhash in load_failed()


def mark_failed(albumhash: str) -> None:
    """Record that MusicBrainz had no cover for this album, and persist."""
    global _failed_cache
    load_failed()  # ensure loaded
    with _failed_lock:
        if _failed_cache is None:
            _failed_cache = set()
        if albumhash in _failed_cache:
            return
        _failed_cache.add(albumhash)
        _persist_failed_locked()


def clear_failed() -> None:
    """Forget all previously-failed albums so they get retried."""
    global _failed_cache
    with _failed_lock:
        _failed_cache = set()
        _persist_failed_locked()


# INFO: MusicBrainz mandates a contact-identifying User-Agent.
USER_AGENT = "AivinNet/1.0 (https://github.com/vwellenberg/AivinNet)"

MB_SEARCH_URL = "https://musicbrainz.org/ws/2/release-group/"
CAA_RELEASE_GROUP_URL = "https://coverartarchive.org/release-group/{mbid}/front-500"

# INFO: MusicBrainz rate limit ~1 req/sec for anonymous clients.
# The Cover Art Archive is hosted on archive.org and is not subject to the
# same limit, so we only throttle calls to musicbrainz.org.
_MB_RATE_LIMIT_SECONDS = 1.1
_mb_lock = threading.Lock()
_mb_last_request_ts: float = 0.0


def _lucene_escape(s: str) -> str:
    """
    Escape a string for safe inclusion inside a Lucene double-quoted phrase.

    Backslashes MUST be escaped first so that the backslashes we then add
    in front of the double quotes are not themselves doubled.
    """
    return s.replace("\\", "\\\\").replace('"', '\\"')


def _mb_throttle() -> None:
    """Block (briefly) so we do not exceed 1 req/sec against MusicBrainz."""
    global _mb_last_request_ts
    with _mb_lock:
        now = time.monotonic()
        elapsed = now - _mb_last_request_ts
        if elapsed < _MB_RATE_LIMIT_SECONDS:
            time.sleep(_MB_RATE_LIMIT_SECONDS - elapsed)
        _mb_last_request_ts = time.monotonic()


def _search_release_group_mbid(album_title: str, artist_name: str) -> str | None:
    """
    Search MusicBrainz for a release group matching the album+artist.
    Returns the best-matching release group MBID, or None.
    """
    if not album_title:
        return None

    # INFO: Lucene-style query. Quote values to be safe with whitespace,
    # and escape any embedded backslashes / double quotes so titles like
    # `Say "Hello"` do not break the parser or inject extra terms.
    query_parts = [f'releasegroup:"{_lucene_escape(album_title)}"']
    if artist_name:
        query_parts.append(f'artist:"{_lucene_escape(artist_name)}"')
    query = " AND ".join(query_parts)

    params = {
        "query": query,
        "fmt": "json",
        "limit": 5,
    }
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }

    try:
        _mb_throttle()
        resp = requests.get(MB_SEARCH_URL, params=params, headers=headers, timeout=10)
        if resp.status_code != 200:
            log.debug("MusicBrainz search returned HTTP %s for %r / %r",
                      resp.status_code, album_title, artist_name)
            return None
        data = resp.json()
    except (requests.RequestException, ValueError) as e:
        log.debug("MusicBrainz search failed for %r / %r: %s",
                  album_title, artist_name, e)
        return None

    groups = data.get("release-groups") or []
    if not groups:
        return None

    # INFO: Results are sorted by score. Pick the highest-score release group
    # that actually has an MBID.
    for group in groups:
        mbid = group.get("id")
        if mbid:
            return mbid

    return None


def _fetch_cover_bytes(mbid: str) -> bytes | None:
    """
    Download the front cover (500px) for the given release group MBID.
    The CAA serves a 307 redirect to archive.org; requests follows it by default.
    """
    url = CAA_RELEASE_GROUP_URL.format(mbid=mbid)
    headers = {"User-Agent": USER_AGENT}

    try:
        resp = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
    except requests.RequestException as e:
        log.debug("Cover Art Archive request failed for %s: %s", mbid, e)
        return None

    if resp.status_code != 200:
        # 404 just means there is no front cover for this release group.
        log.debug("Cover Art Archive returned HTTP %s for %s", resp.status_code, mbid)
        return None

    content = resp.content
    if not content:
        return None

    return content


def fetch_cover_for_album(album_title: str, artist_name: str) -> bytes | None:
    """
    Look up an album on MusicBrainz and fetch its front cover from the
    Cover Art Archive.

    :param album_title: The album title to search for.
    :param artist_name: The (primary) album artist name. May be empty.
    :return: Raw image bytes (typically JPEG) on success, otherwise None.
    """
    if not album_title:
        return None

    mbid = _search_release_group_mbid(album_title.strip(), (artist_name or "").strip())
    if not mbid:
        return None

    return _fetch_cover_bytes(mbid)
