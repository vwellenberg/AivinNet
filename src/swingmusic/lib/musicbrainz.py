"""
MusicBrainz / Cover Art Archive integration.

Provides a single helper function that, given an album title and artist name,
searches MusicBrainz for a matching release group and downloads the front
cover from the Cover Art Archive.

A search result is only trusted once it clears a confidence gate — a relevance
floor plus a cross-check of the credited artist against our own album artist.
See MIN_SEARCH_SCORE and _artist_matches; the guiding rule is that no cover is
better than a wrong one.

Usage policy notes (https://musicbrainz.org/doc/MusicBrainz_API):
- A descriptive User-Agent header is required.
- Anonymous clients are limited to ~1 request/second.

Failures of any kind return None; this module never raises.
"""

from __future__ import annotations

import logging
import re
import threading
import time
import unicodedata
from collections.abc import Iterable

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
                with open(_failed_cache_file(), encoding="utf-8") as fh:
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


_DECORATION_RE = re.compile(r"[\(\[\{][^\)\]\}]*[\)\]\}]")

# A leading disc marker: "CD3: ", "Disc 2 - ", "Disk 1 ". Multi-disc rips carry
# it in the album tag of every track, and MusicBrainz stores the WORK under its
# own title with the discs as media inside it — so an exact-phrase search for
# "CD3: The Red Shoes" returns zero results while "The Red Shoes" is right
# there. Measured on this library: the Kate Bush disc that has a cover today is
# the only one of five sampled control albums the gate could not re-find, and
# this prefix was the whole reason.
_DISC_PREFIX_RE = re.compile(r"^\s*(?:cd|disc|disk)\s*\d+\s*[:\-–—.]?\s*", re.IGNORECASE)


def simplify_title(title: str) -> str:
    """
    Strip decorations from an album title so a decorated tag (e.g.
    "By The Way (2002)", "CD3: The Red Shoes (Remastered)") can still match
    MusicBrainz, whose exact-phrase search fails on the extra text. Returns the
    cleaned title (may be empty if the title was only decoration).

    Only ever used for a RETRY after the verbatim title found nothing — the
    stripped form is a weaker claim, so it must not be what we search first.
    """
    cleaned = _DECORATION_RE.sub("", title)
    cleaned = _DISC_PREFIX_RE.sub("", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip(" -–—:·,")


# INFO: Confidence gate. Before this, the search took the FIRST result and ran
# with it, so a sparsely tagged album reliably got a confidently WRONG cover.
# The rule for this library is explicit: rather no cover than a wrong one — a
# wrong cover looks correct, so nobody ever goes looking for it.
#
# Note what the floor can and cannot do. MusicBrainz normalises search scores
# against the best hit OF THE SAME QUERY, so the top result is essentially
# always 100 no matter how bad it is; a floor alone would never reject it.
# Its real job is the walk DOWN the result list: once the artist cross-check
# has thrown out the better-ranked hits, the floor stops us from settling for
# a leftover that is materially weaker than the best that query could find.
# 85 therefore reads as "within 15% of the best hit". The load-bearing check
# is the artist comparison below; the floor is the second lock on that door.
MIN_SEARCH_SCORE = 85

# INFO: Album artist values that carry no information. `lib/taglib.py` writes
# the literal "Unknown" when a file has no album artist tag and none could be
# parsed out of the filename — it means "we know nothing", not "an artist
# called Unknown".
#
# "Various Artists" is deliberately NOT in here: it is a real statement about
# the album (it is a compilation), and MusicBrainz credits compilations to an
# artist of that name, so it cross-checks like any other name.
_PLACEHOLDER_ARTISTS = {"unknown", "unknown artist"}

# Leading-article noise. Dropped from both sides so "The Beatles", "Beatles"
# and the MusicBrainz sort name "Beatles, The" compare equal.
_ARTICLE_TOKENS = {"the"}

# Guest-credit markers. Everything from the marker to the end of the name is
# dropped, so "Santana feat. Rob Thomas" compares as "Santana".
#
# The list is deliberately short and every marker must be preceded by
# whitespace and (bar "w/") followed by a word boundary. Both restrictions
# guard against the failure mode that matters here — a marker matched inside a
# real name truncates it, and a truncated name is a SUBSET of the untruncated
# one, i.e. it turns into a false ACCEPT. "Fleet Feathers" must not become
# "Fleet", and a bare "w" is left out because middle initials exist.
# "and"/"with"/"vs" are left out for the same reason: they sit inside real band
# names ("Nick Cave and the Bad Seeds").
_FEATURED_RE = re.compile(r"\s(?:(?:feat|feats|featuring|ft)\b\.?|w/).*$", re.IGNORECASE)

# Everything that is not a word character becomes a separator. \W keeps
# non-Latin scripts intact (CJK, Cyrillic), which matters for the game
# soundtracks that make up much of this library — stripping to [a-z] would
# reduce those names to the empty string and reject every one of them.
_NON_WORD_RE = re.compile(r"[\W_]+", re.UNICODE)

# Straight and typographic apostrophes, plus the modifier letter Apple and
# several stores use. See where it is applied for why it is not a separator.
_APOSTROPHE_RE = re.compile(r"['‘’ʼ]")


def _normalise_artist(name: str) -> str:
    """
    Reduce an artist name to a form that can be compared across sources.

    Folds accents ("Björk" == "Bjork"), case, punctuation and spacing, expands
    "&" to "and", and drops bracketed additions and trailing guest credits.
    Returns "" when nothing comparable is left.
    """
    if not name:
        return ""

    # Decompose, then drop the combining marks — "Sigur Rós" becomes "sigur ros"
    # rather than losing the accented character entirely.
    text = unicodedata.normalize("NFKD", name)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.casefold()

    text = _DECORATION_RE.sub(" ", text)
    text = _FEATURED_RE.sub(" ", text)
    text = text.replace("&", " and ")
    # Apostrophes are REMOVED, not turned into a separator like every other
    # non-word character. Inside a word the separator is wrong in a way that
    # only shows up when the two sides spell it differently: "Sgt. Pepper's"
    # folds to "sgt pepper s" and no longer equals "Sgt Peppers". Dropping it
    # gives "peppers" from both, and leaves the cases where it stands alone
    # untouched ("Guns N' Roses" folds the same either way).
    text = _APOSTROPHE_RE.sub("", text)
    text = _NON_WORD_RE.sub(" ", text)

    return " ".join(text.split())


def _artist_tokens(normalised: str) -> frozenset[str]:
    """
    Word set of an already-normalised artist name, minus article noise.

    Keeps the article when dropping it would leave nothing at all, so the band
    "The The" still has something to compare.
    """
    tokens = set(normalised.split())
    stripped = tokens - _ARTICLE_TOKENS
    return frozenset(stripped or tokens)


def is_usable_albumartist(artist_name: str) -> bool:
    """
    Whether our own album artist says anything a match can be verified against.

    False for an empty tag and for the "Unknown" placeholder — and those albums
    consequently never get a cover. That is the decision the whole gate turns
    on, so it is worth writing down why:

    An unknown album artist IS the case that produces wrong covers. The title
    alone is frequently ambiguous ("Greatest Hits", "Live", "Vol. 2") and, for
    untagged files, is not even a title but the folder name (see
    lib/albumhash.py::album_title). Nor can we lean on the score instead: with
    no artist term in the query, MusicBrainz ranks on the title alone and
    returns a confident 100 for a release group that has nothing to do with
    this album. Measured against the live API while writing this:

        "Hearthstone"   -> 100  "Hearthstone" by Chamberfield
        "Greatest Hits" -> 100  "Greatest Hits" by Adam Wade
        "Soundtrack"    -> 100  "Soundtrack Bloody Soundtrack" by Vendetta 33

    Every one of those would have been accepted by the old "take the first
    result" code, and the third one does not even have a matching title.

    So the choice is between two errors. A missing cover on an untagged album
    is visible, is honest about what we know, and the user can fix it by fixing
    the tags. A wrong cover on an untagged album looks correct, is never
    noticed, and quietly misrepresents the library — and it also poisons the
    negative cache in the opposite direction, because it counts as a success.
    The first error is recoverable, the second is not. So: fail the check.

    Public, because the store lookup in `lib/coverart.py` turns on the same
    decision: an album we cannot verify a match for gets no cover from ANY
    source. Adding a source must never become a way around the gate.
    """
    normalised = _normalise_artist(artist_name)
    return bool(normalised) and normalised not in _PLACEHOLDER_ARTISTS


def _artist_credit_display(group: dict) -> str:
    """The artist credit as MusicBrainz renders it, e.g. "Jay-Z & Linkin Park"."""
    parts: list[str] = []

    for entry in group.get("artist-credit") or []:
        if not isinstance(entry, dict):
            continue
        artist = entry.get("artist")
        name = entry.get("name") or (artist.get("name") if isinstance(artist, dict) else None)
        parts.append(str(name or ""))
        parts.append(str(entry.get("joinphrase") or ""))

    return "".join(parts).strip()


def _artist_credit_names(group: dict) -> list[str]:
    """
    Every name a release group is credited to, in each form a local tag might
    plausibly use.

    That is the joined credit ("Jay-Z & Linkin Park") plus, per contributor,
    the credited name, the canonical artist name and the sort name
    ("Beatles, The"). A tag may legitimately hold any one of them, so the
    comparison gets to see all of them.
    """
    names: list[str] = []

    display = _artist_credit_display(group)
    if display:
        names.append(display)

    for entry in group.get("artist-credit") or []:
        if not isinstance(entry, dict):
            continue
        artist = entry.get("artist")
        if not isinstance(artist, dict):
            artist = {}
        for candidate in (entry.get("name"), artist.get("name"), artist.get("sort-name")):
            if candidate:
                names.append(str(candidate))

    return names


def _artist_matches(artist_name: str, candidates: Iterable[str]) -> bool:
    """
    Whether any of the credited names plausibly denotes our album artist.

    A match is either equality after normalisation, or one name's words being a
    subset of the other's. The subset rule works in BOTH directions on purpose:
    MusicBrainz spells collaborations out in full where a tag names only the
    lead, and tags add guests that MusicBrainz keeps on the track rather than on
    the release group — requiring equality would reject both. The price is that
    a strictly narrower name is accepted (a tag "Nirvana" would match a credit
    "Nirvana UK"); that is an acceptable residue, since the title still had to
    match and the result still had to clear the score floor.
    """
    ours = _normalise_artist(artist_name)
    if not ours:
        return False

    our_tokens = _artist_tokens(ours)

    for candidate in candidates:
        theirs = _normalise_artist(candidate)
        if not theirs:
            continue
        if theirs == ours:
            return True

        their_tokens = _artist_tokens(theirs)
        if their_tokens <= our_tokens or our_tokens <= their_tokens:
            return True

    return False


def _normalise_title(title: str) -> str:
    """
    Reduce an album title to a form that can be compared across sources.

    Deliberately runs the title through `_normalise_artist`: what that function
    actually does is fold a NAME (accents, case, punctuation, "&", bracketed
    additions), and both sides of a comparison must be folded by exactly the
    same rules or the comparison means nothing. `simplify_title` runs first so
    a disc prefix ("CD3: ") disappears too.
    """
    return _normalise_artist(simplify_title(title))


def title_matches(album_title: str, candidate_title: str) -> bool:
    """
    Whether a candidate album title denotes the same album as ours.

    Equality after folding, and nothing looser. The subset rule that
    `_artist_matches` uses would be wrong here: album titles are frequently
    prefixes of unrelated ones ("Greatest Hits" is a subset of "Greatest Hits
    Vol. 2", "Live" of "Live in Tokyo"), so a subset match would accept the
    wrong record of the right artist — the exact failure this gate exists to
    prevent.

    Folding still absorbs the differences that are only spelling: decorations
    ("By The Way (2002)"), disc prefixes, accents, punctuation and "&"/"and".
    """
    ours = _normalise_title(album_title)
    if not ours:
        return False

    return ours == _normalise_title(candidate_title)


def album_matches(
    album_title: str,
    artist_name: str,
    candidate_title: str,
    candidate_artists: Iterable[str],
) -> bool:
    """
    Whether a candidate from a FUZZY source is plausibly this exact album.

    Used by the store lookup in `lib/coverart.py`, which is why the title is
    checked here but not in the MusicBrainz path: that one searches with an
    exact-phrase title query, so MusicBrainz has already done this half of the
    job and its score expresses how well. iTunes and Deezer take free text and
    always answer with *something* — for them, "the title actually matches" has
    to be asserted on this side or not at all.
    """
    return title_matches(album_title, candidate_title) and _artist_matches(artist_name, candidate_artists)


def _result_score(group: dict) -> int:
    """
    A search result's relevance score, 0-100.

    MusicBrainz documents it as an integer, but it has been seen as a string in
    the wild, hence the parse. Anything missing or unparsable counts as 0 and is
    therefore rejected: an unscored result is exactly what must not be trusted
    silently.
    """
    try:
        return int(group.get("score", 0))
    except (TypeError, ValueError):
        return 0


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

    Returns the MBID of the best result that clears the confidence gate
    (MIN_SEARCH_SCORE plus the artist cross-check), or None when nothing does.
    None is a perfectly good outcome here — see MIN_SEARCH_SCORE.
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
            log.debug("MusicBrainz search returned HTTP %s for %r / %r", resp.status_code, album_title, artist_name)
            return None
        data = resp.json()
    except (requests.RequestException, ValueError) as e:
        log.debug("MusicBrainz search failed for %r / %r: %s", album_title, artist_name, e)
        return None

    groups = data.get("release-groups") or []
    if not groups:
        return None

    # INFO: Results arrive sorted by descending score, so the first one that
    # clears the gate is also the best one that does. We keep walking instead
    # of breaking on the first sub-floor score, because that ordering is a
    # property of the server's response, not something we get to rely on.
    #
    # Every rejection is logged at INFO (the level the stdout handler ships,
    # see logger.py) with the score and both names, so a cover that looks wrong
    # — or an album that mysteriously got none — can be traced in the log.
    for group in groups:
        mbid = group.get("id")
        if not mbid:
            continue

        score = _result_score(group)
        credit = _artist_credit_display(group)
        matched_title = group.get("title") or album_title

        if score < MIN_SEARCH_SCORE:
            log.info(
                "MusicBrainz: rejected %r by %r for %r by %r — score %d below floor %d (mbid %s)",
                matched_title,
                credit,
                album_title,
                artist_name,
                score,
                MIN_SEARCH_SCORE,
                mbid,
            )
            continue

        if not _artist_matches(artist_name, _artist_credit_names(group)):
            log.info(
                "MusicBrainz: rejected %r by %r for %r by %r — artist credit does not match (score %d, mbid %s)",
                matched_title,
                credit,
                album_title,
                artist_name,
                score,
                mbid,
            )
            continue

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

    Returns None whenever the match cannot be verified — see
    is_usable_albumartist and _search_release_group_mbid.

    :param album_title: The album title to search for.
    :param artist_name: The (primary) album artist name. May be empty.
    :return: Raw image bytes (typically JPEG) on success, otherwise None.
    """
    if not album_title:
        return None

    title = album_title.strip()
    artist = (artist_name or "").strip()

    if not is_usable_albumartist(artist):
        # No result could ever clear the artist cross-check, so skip the lookup
        # rather than spend a rate-limited second (1.1s each, ~350 albums in the
        # pending batch) on a result we would throw away anyway.
        log.info(
            "MusicBrainz: skipped %r — album artist %r says nothing we could verify a match against",
            title,
            artist_name,
        )
        return None

    mbid = _search_release_group_mbid(title, artist)

    # Many real albums fail the exact-phrase search only because the tag title
    # carries decorations (year, "Original Soundtrack", "Remastered", ...).
    # Retry once with those stripped before giving up.
    if not mbid:
        simplified = simplify_title(title)
        if simplified and simplified.casefold() != title.casefold():
            mbid = _search_release_group_mbid(simplified, artist)

    if not mbid:
        return None

    return _fetch_cover_bytes(mbid)
