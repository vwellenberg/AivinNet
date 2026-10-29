import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from unidecode import unidecode

from aivinnet.db.userdata import PluginTable
from aivinnet.lib.lyrics import Lyrics as LrcText
from aivinnet.plugins import Plugin, plugin_method
from aivinnet.utils.hashing import create_hash

log = logging.getLogger(__name__)

# ⚠️ The lookups run inside a request, and the server answers ONE request at a
# time: every listener's playback waits for them (#295). `timeout=10` bounds a
# single call, not the chain — a search, its shortened-title retry and its
# non-ASCII retry are three calls, 30 s and more while the service black-holes
# packets, on every track change with the lyrics view open. Hence a deadline
# over the whole chain, and an outage that is remembered instead of
# rediscovered per track.
DEADLINE_SECONDS = 5
OUTAGE_SECONDS = 300
# A quick 5xx is the service saying "not right now", not a black hole: LRCLIB
# answers one now and then and the same search succeeds a second later
# (measured 2026-10-28). Five minutes without lyrics for everyone is too much
# for that; the chain deadline already bounds what one such answer costs.
HICCUP_SECONDS = 30

_down_until = 0.0


def _is_down() -> bool:
    return time.monotonic() < _down_until


def _mark_down(reason: str, seconds: int = OUTAGE_SECONDS) -> None:
    global _down_until
    _down_until = time.monotonic() + seconds
    log.warning("LRCLIB: %s; no lyrics lookups for %s s", reason, seconds)


def _within_deadline(work, default):
    """Run one lookup chain, giving up on it after DEADLINE_SECONDS."""
    if _is_down():
        return default

    # A pool per call, shut down without waiting: a worker stuck on a dead
    # socket must not hold the request past the deadline (lib/coverart.py).
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        return pool.submit(work).result(timeout=DEADLINE_SECONDS)
    except TimeoutError:
        _mark_down(f"no answer within {DEADLINE_SECONDS} s")
        return default
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


# A trailing "(…)", "[…]" or " - …" is an edition note more often than part of
# the name ("Song (Remastered 2009)", "Song - Live"), and a cut-off tag leaves
# an unclosed one ("Stretch (My Friends B"). The search matches the whole
# title, so either kind finds nothing.
_TITLE_SUFFIX = re.compile(r"\s*(?:[(\[].*|\s-\s.*)$")


def bare_title(title: str) -> str:
    """The title without a trailing bracket or dash suffix, or "" if that is all of it."""
    return _TITLE_SUFFIX.sub("", title).strip()


def _squash(text: str) -> str:
    return "".join(c for c in unidecode(text).lower() if c.isalnum())


def _same_artist(wanted: str, found: str) -> bool:
    """
    Loose on purpose: the client joins several artists with ", ", tags write
    duos as "A and B", and LRCLIB lists them its own way. One containing the
    other — for the whole credit or any single name in it — is the same act.
    """
    found = _squash(found)
    names = [_squash(n) for n in [wanted, *wanted.split(", ")]]
    return any(n and found and (n in found or found in n) for n in names)


def pick_best(results: list[dict] | None, title: str, artist: str, album: str) -> dict | None:
    """
    The result to download, or None when nothing is by this artist.

    ⚠️ The pick is written next to the track as its `.lrc` and never looked up
    again, so a wrong song costs more than no song. LRCLIB's search is fuzzy —
    the shortened-title retry even asks for less than the tag says — hence the
    artist filter, and the same title ranks ABOVE synced: plain lyrics of the
    right song beat timed lyrics of a neighbour. Then the same album beats
    another release of it.
    """
    candidates = [r for r in results or [] if _same_artist(artist, r["artist"])]
    if not candidates:
        return None

    wanted = {create_hash(title), create_hash(bare_title(title) or title)}

    def score(track: dict) -> tuple[bool, bool, bool]:
        return (
            create_hash(track["title"]) in wanted,
            bool(track["synced"]),
            create_hash(track["album"]) == create_hash(album),
        )

    # `max` keeps the first of equals, and the service ranks its own results.
    return max(candidates, key=score)


class LyricsProvider:
    """
    LRCLIB (https://lrclib.net): an open, community-run lyrics database with a
    documented API, no account and no token.

    It replaced Musixmatch's unofficial desktop API, which since 2026 hands out
    an all-zero user token: with it, `track.subtitle.get` answers 404 for every
    track, and `track.lyrics.get` returns scrambled placeholder text.
    """

    ROOT_URL = "https://lrclib.net/api/"

    # LRCLIB asks clients to name themselves instead of posing as a browser.
    USER_AGENT = "AivinNet (https://github.com/vwellenberg/AivinNet)"

    session = requests.Session()

    def __init__(self) -> None:
        self.session.headers.update({"user-agent": self.USER_AGENT})

        # A search already carries the lyrics. Downloading the pick reads them
        # from here instead of asking the service a second time.
        self._found: dict[str, str] = {}

    def _get(self, action: str, params: dict | None = None, retry: bool = True):
        # Once one call of a chain failed, the rest of it fails at once too.
        if _is_down():
            return None

        try:
            response = self.session.get(self.ROOT_URL + action, params=params, timeout=10)
        except Exception as e:
            _mark_down(f"{action} failed ({e.__class__.__name__})")
            return None

        if response is not None and response.ok:
            return response

        # A refusal is an outage, a server error a hiccup; "not found" is an answer.
        status = getattr(response, "status_code", 0)
        if status in (401, 403, 429):
            _mark_down(f"{action} answered HTTP {status}")
        elif status >= 500 and retry:
            # Once, at once: the hiccups measured cleared by the next call.
            return self._get(action, params, retry=False)
        elif status >= 500:
            _mark_down(f"{action} answered HTTP {status}", HICCUP_SECONDS)
        return None

    def _search(self, title: str, artist: str) -> list[dict]:
        res = self._get("search", {"track_name": title, "artist_name": artist})

        try:
            tracks = res.json()
        except (AttributeError, ValueError):
            return []

        if not isinstance(tracks, list):
            return []

        results = []
        for t in tracks:
            lyrics = t.get("syncedLyrics") or t.get("plainLyrics")
            if not lyrics or t.get("instrumental"):
                continue

            track_id = str(t["id"])
            self._found[track_id] = lyrics
            results.append(
                {
                    "track_id": track_id,
                    "title": t.get("trackName") or "",
                    "artist": t.get("artistName") or "",
                    "album": t.get("albumName") or "",
                    "synced": bool(t.get("syncedLyrics")),
                }
            )

        return results

    def get_lrc(self, title: str, artist: str) -> list[dict]:
        tracks = self._search(title, artist)

        if not tracks:
            bare = bare_title(title)
            if bare and bare != title:
                tracks = self._search(bare, artist)

        if not tracks:
            # if the artist name contains non-ascii characters, try to decode it
            decoded = unidecode(artist)
            if decoded != artist:
                return self.get_lrc(title, decoded)

        return tracks

    def get_lrc_by_id(self, track_id: str) -> str | None:
        if track_id in self._found:
            return self._found[track_id]

        res = self._get(f"get/{track_id}")

        try:
            track = res.json()
        except (AttributeError, ValueError):
            return None

        return track.get("syncedLyrics") or track.get("plainLyrics") or None


class Lyrics(Plugin):
    def __init__(self) -> None:
        plugin = PluginTable.get_by_name("lyrics_finder")

        if not plugin:
            return

        name = plugin.name
        super().__init__(name, "LRCLIB lyrics finder")

        self.provider = LyricsProvider()

        if plugin:
            self.set_active(bool(int(plugin.active)))

    @plugin_method
    def search_lyrics_by_title_and_artist(self, title: str, artist: str):
        return _within_deadline(lambda: self.provider.get_lrc(title, artist), [])

    @plugin_method
    def download_lyrics(self, trackid: str, path: str):
        lrc = _within_deadline(lambda: self.provider.get_lrc_by_id(trackid), None)

        if lrc is None or len(lrc.replace("\n", "").strip()) < 1:
            return None

        path = Path(path).with_suffix(".lrc")

        # Only timed lyrics replace a file that is already there: that is what
        # "override unsynced" asks for. Plain text over the listener's own
        # plain file would trade their version for ours and gain nothing.
        if path.exists() and not LrcText(lrc).is_synced:
            return lrc

        path.write_text(lrc)

        return lrc
