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
