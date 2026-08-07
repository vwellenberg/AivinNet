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

from aivinnet.lib.musicbrainz import (
    USER_AGENT,
    simplify_title,
    album_matches,
    is_usable_albumartist,
)

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


def _fallback_queries(query: str) -> list[str]:
    """
    Progressively shortened variants of a query that found nothing.

    Playlist names often carry a subtitle the stores don't know
    ("Might and Magic 6 - The Mandate of Heaven"): first cut at the
    " - " separator, then drop trailing words down to two.
    """
    variants: list[str] = []

    base = query
    if " - " in base:
        base = base.split(" - ")[0].strip()
        if base:
            variants.append(base)

    words = base.split()
    while len(words) > 2:
        words = words[:-1]
        variants.append(" ".join(words))

    # Preserve order, drop duplicates and the original query.
    seen = {query.casefold()}
    unique: list[str] = []
    for v in variants:
        key = v.casefold()
        if key not in seen:
            seen.add(key)
            unique.append(v)

    return unique


def search_covers_with_fallback(query: str, limit: int = 30) -> tuple[str, list[dict]]:
    """
    search_covers, retrying with progressively shortened queries when the
    full one has no hits. Returns (query_that_produced_the_results, results).
    """
    results = search_covers(query, limit)
    if results:
        return query, results

    for variant in _fallback_queries(query):
        results = search_covers(variant, limit)
        if results:
            return variant, results

    return query, []


def fetch_verified_cover(album_title: str, artist_name: str) -> bytes | None:
    """
    Find a cover for an album on iTunes/Deezer WITHOUT a human confirming it.

    This is the unattended sibling of `search_covers`: the interactive "Find
    cover online" hands the user a gallery and lets them judge, and there is
    nobody to judge here. So every candidate has to pass the same gate the
    MusicBrainz path uses (`lib/musicbrainz.album_matches`) — the title must
    match after folding and the artist must cross-check — and an album whose
    own album artist says nothing verifiable is skipped before a request is
    even made.

    Without that, hanging these two sources into the automatic chain would undo
    the confidence gate rather than extend it: both take free text and answer
    with *something* for almost any query, so "first result" is a wrong cover
    with extra steps.

    Returns the image bytes of the first candidate that clears the gate, or
    None. None is a perfectly good outcome.
    """
    title = (album_title or "").strip()
    artist = (artist_name or "").strip()

    if not title:
        return None

    if not is_usable_albumartist(artist):
        log.info(
            "Store covers: skipped %r — album artist %r says nothing we could verify a match against",
            title,
            artist_name,
        )
        return None

    # Queries to try, in order of how strong a claim they make. The simplified
    # title is a weaker claim, so it is only a retry — same reasoning as the
    # MusicBrainz path, where a decorated tag ("… (Original Soundtrack)")
    # regularly hides an album the store does have.
    queries = [f"{artist} {title}"]
    simplified = simplify_title(title)
    if simplified and simplified.casefold() != title.casefold():
        queries.append(f"{artist} {simplified}")

    for query in queries:
        for candidate in search_covers(query, limit=FETCH_LIMIT_PER_SOURCE):
            if not album_matches(title, artist, candidate.get("album", ""), [candidate.get("artist", "")]):
                continue

            image = download_cover(candidate["url"])
            if image:
                log.info(
                    "Store covers: %r by %r matched %r by %r on %s",
                    title,
                    artist,
                    candidate.get("album", ""),
                    candidate.get("artist", ""),
                    candidate.get("source", "?"),
                )
                return image

            # An accepted match whose download failed is worth one more
            # candidate rather than the whole album being written off.
            log.info("Store covers: download failed for %s, trying the next candidate", candidate["url"])

    log.info("Store covers: nothing matched %r by %r", title, artist)
    return None


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
    from aivinnet.settings import Paths

    filename = f"{albumhash}.webp"
    paths = Paths()
    return [
        paths.lg_thumb_path / filename,
        paths.md_thumb_path / filename,
        paths.sm_thumb_path / filename,
        paths.xsm_thumb_path / filename,
    ]


def _cached_album_cover_paths(albumhash: str) -> list:
    """
    The album's cover in the image server's derived cache.

    ``imgserver.cache_thumbnails`` copies a folder cover into
    ``<image_cache>/<size>/<albumhash>.webp`` and ``send_file_or_fallback``
    prefers that copy over rebuilding. A removal that ignored the cache would
    keep serving the very cover it was supposed to drop.
    """
    from aivinnet.settings import Paths

    filename = f"{albumhash}.webp"
    cache = Paths().image_cache_path
    return [cache / size / filename for size in ("large", "medium", "small", "xsmall")]


def _album_cover_tombstone(albumhash: str, paths=None):
    """
    Marker recording that the user deliberately removed this album's cover.

    Deleting the four thumbnails is not enough on its own, because two
    mechanisms rebuild a missing album thumbnail from scratch:
    ``imgserver.find_thumbnail`` serves a cover image sitting next to the audio
    files, and ``taglib.extract_thumb`` re-extracts the embedded art on the next
    library scan. Both would quietly bring the rejected cover straight back, so
    the removal needs a record that outlives the files it deleted.

    Lives in the thumbnails ROOT, which otherwise holds nothing but the four
    size directories — so it can never collide with a '<albumhash>.webp'.

    :param paths: A ``Paths`` instance. The scanner runs multithreaded and
        passes its own (see ``taglib.extract_thumb``); everything else lets
        this resolve the singleton itself.
    """
    if paths is None:
        from aivinnet.settings import Paths

        paths = Paths()

    return paths.thumbs_path / f"{albumhash}.removed"


def album_cover_removed(albumhash: str, paths=None) -> bool:
    """Whether the user removed this album's cover (see _album_cover_tombstone)."""
    return _album_cover_tombstone(albumhash, paths).exists()


def backup_album_cover(albumhash: str) -> None:
    """
    Snapshot the album's current cover files for a one-level undo.

    For each size: an existing file is copied to '<file>.undo'; a missing
    file leaves a zero-byte '<file>.undo' marker meaning "there was no cover
    here — delete on restore". A later save overwrites the snapshot.

    The tombstone is part of the snapshot: "the user removed this cover" is a
    state like any other, so undoing a save that cleared it must bring it back.
    """
    import shutil

    for path in _album_cover_paths(albumhash):
        undo = path.with_name(path.name + ".undo")
        path.parent.mkdir(parents=True, exist_ok=True)

        if path.exists():
            shutil.copy2(path, undo)
        else:
            undo.write_bytes(b"")

    tombstone = _album_cover_tombstone(albumhash)
    tombstone_undo = tombstone.with_name(tombstone.name + ".undo")
    tombstone.parent.mkdir(parents=True, exist_ok=True)
    # Same convention as above: zero bytes mean "there was no tombstone".
    tombstone_undo.write_bytes(b"1" if tombstone.exists() else b"")


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

    tombstone = _album_cover_tombstone(albumhash)
    tombstone_undo = tombstone.with_name(tombstone.name + ".undo")
    if tombstone_undo.exists():
        restored = True
        if tombstone_undo.stat().st_size == 0:
            tombstone.unlink(missing_ok=True)
        else:
            tombstone.write_bytes(b"")
        tombstone_undo.unlink()

    return restored


def remove_album_cover(albumhash: str) -> None:
    """
    Drop an album's cover: delete the four thumbnails, drop the derived cache
    entries and record the removal so nothing regenerates it.

    Snapshotted first, so ``undo_album_cover`` reverts a removal exactly the
    way it reverts a save.
    """
    backup_album_cover(albumhash)

    for path in _album_cover_paths(albumhash) + _cached_album_cover_paths(albumhash):
        path.unlink(missing_ok=True)

    tombstone = _album_cover_tombstone(albumhash)
    tombstone.parent.mkdir(parents=True, exist_ok=True)
    tombstone.write_bytes(b"")


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
    from aivinnet.settings import Defaults, Paths

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

    # Setting a cover overrides an earlier removal. backup_album_cover above
    # snapshotted the tombstone, so an undo still restores the removed state.
    _album_cover_tombstone(albumhash).unlink(missing_ok=True)

    return filename
