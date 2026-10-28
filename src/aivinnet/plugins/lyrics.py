import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from unidecode import unidecode

from aivinnet.db.userdata import PluginTable
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

_down_until = 0.0


def _is_down() -> bool:
    return time.monotonic() < _down_until


def _mark_down(reason: str) -> None:
    global _down_until
    _down_until = time.monotonic() + OUTAGE_SECONDS
    log.warning("LRCLIB: %s; no lyrics lookups for %s s", reason, OUTAGE_SECONDS)


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


def pick_best(results: list[dict], title: str, album: str) -> dict | None:
    """
    The result to download. Synced lyrics beat plain ones — the lyrics page
    follows the song only with time tags — and within that, the same title
    beats a near one and the same album beats another release of it.
    """
    if not results:
        return None

    def score(track: dict) -> tuple[bool, bool, bool]:
        return (
            bool(track["synced"]),
            create_hash(track["title"]) == create_hash(title),
            create_hash(track["album"]) == create_hash(album),
        )

    # `max` keeps the first of equals, and the service ranks its own results.
    return max(results, key=score)


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

    def _get(self, action: str, params: dict | None = None):
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

        # A refusal or a broken server is an outage; "not found" is an answer.
        status = getattr(response, "status_code", 0)
        if status >= 500 or status in (401, 403, 429):
            _mark_down(f"{action} answered HTTP {status}")
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
        if not path.exists():
            path.touch()
        path.write_text(lrc)

        return lrc
