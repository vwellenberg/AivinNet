"""
MusicBrainz *releases* — the level that carries a track list.

The cover integration in :mod:`aivinnet.lib.musicbrainz` searches **release
groups**, because a cover belongs to the work rather than to one pressing. Track
titles and track numbers do not: they belong to a specific release, and the same
album released as a single CD, a double CD and a deluxe edition has three
different track lists. So this module searches and reads `release`, and hands
the choice between the candidates to the person looking at them.

Nothing here writes anything. It answers two questions — "which releases could
this be?" and "what does this one contain?" — and everything that follows from
the answers happens in :mod:`aivinnet.lib.track_match` and the API layer.

Failures of any kind return an empty result; this module never raises.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import requests

from aivinnet.lib.musicbrainz import (
    USER_AGENT,
    lucene_escape,
    mb_throttle,
)

log = logging.getLogger(__name__)

MB_RELEASE_SEARCH_URL = "https://musicbrainz.org/ws/2/release/"
MB_RELEASE_LOOKUP_URL = "https://musicbrainz.org/ws/2/release/{mbid}"

# INFO: A hard ceiling on every outbound call. The server is single-threaded
# under bjoern (see the architecture notes in CLAUDE.md), so a request that
# hangs does not slow one endpoint down — it stops the whole app, including `/`.
# `requests`' timeout covers connect and read separately, which is what we want
# here: MusicBrainz answers in well under a second when it answers at all.
REQUEST_TIMEOUT = (5, 10)

# How many candidates are worth showing. Beyond a handful the list stops being a
# choice and starts being a search result page.
MAX_CANDIDATES = 8


@dataclass
class ReleaseCandidate:
    """One possible answer to "which release is this?", as shown to the user."""

    mbid: str
    title: str
    artist: str
    date: str = ""
    country: str = ""
    # What the pressing is made of: "2xCD", "1xDigital Media". The single most
    # useful discriminator between a candidate and its deluxe twin, after the
    # track count.
    format: str = ""
    track_count: int = 0
    score: int = 0

    def todict(self) -> dict:
        return {
            "mbid": self.mbid,
            "title": self.title,
            "artist": self.artist,
            "date": self.date,
            "country": self.country,
            "format": self.format,
            "track_count": self.track_count,
            "score": self.score,
        }


@dataclass
class RemoteTrack:
    """One track of a release, in the order the release itself gives."""

    position: int
    disc: int
    title: str
    # Milliseconds, 0 when MusicBrainz has no length for the recording. The
    # matcher treats 0 as "no evidence" rather than as a duration of zero.
    length: int = 0
    artists: list[str] = field(default_factory=list)

    def todict(self) -> dict:
        return {
            "position": self.position,
            "disc": self.disc,
            "title": self.title,
            "length": self.length,
            "artists": self.artists,
        }


def _artist_credit(entity: dict) -> str:
    """Flatten MusicBrainz' artist-credit list into the display string."""
    parts: list[str] = []
    for credit in entity.get("artist-credit") or []:
        if isinstance(credit, str):
            parts.append(credit)
            continue
        name = credit.get("name") or (credit.get("artist") or {}).get("name") or ""
        parts.append(name)
        parts.append(credit.get("joinphrase") or "")
    return "".join(parts).strip()


def _artist_credit_names(entity: dict) -> list[str]:
    """The credited artists as separate names, join phrases dropped."""
    names: list[str] = []
    for credit in entity.get("artist-credit") or []:
        if isinstance(credit, str):
            continue
        name = credit.get("name") or (credit.get("artist") or {}).get("name") or ""
        if name:
            names.append(name)
    return names


def _format_summary(media: list[dict]) -> str:
    """ "2xCD", "1xDigital Media" — what the pressing physically is."""
    counts: dict[str, int] = {}
    for medium in media:
        name = medium.get("format") or "Medium"
        counts[name] = counts.get(name, 0) + 1
    return " + ".join(f"{count}x{name}" for name, count in counts.items())


def _get(url: str, params: dict) -> dict | None:
    """One throttled, deadline-bounded GET against musicbrainz.org."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    try:
        mb_throttle()
        resp = requests.get(url, params=params, headers=headers, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            log.info("MusicBrainz: HTTP %s for %s %s", resp.status_code, url, params.get("query", ""))
            return None
        return resp.json()
    except (requests.RequestException, ValueError) as e:
        log.info("MusicBrainz: request failed for %s: %s", url, e)
        return None


def search_releases(album_title: str, artist_name: str, limit: int = MAX_CANDIDATES) -> list[ReleaseCandidate]:
    """
    Find releases that could be this album, best first.

    Unlike the cover path this does **not** apply a confidence gate. The gate
    exists there because nothing downstream asks: a cover is fetched and saved
    unattended, so a wrong one is worse than none. Here a human picks from the
    list and sees the track titles before anything is written, so a weak
    candidate costs a glance rather than a silently wrong library — and hiding
    it would only leave the unusual pressings unreachable.
    """
    title = (album_title or "").strip()
    if not title:
        return []

    query_parts = [f'release:"{lucene_escape(title)}"']
    artist = (artist_name or "").strip()
    if artist:
        query_parts.append(f'artist:"{lucene_escape(artist)}"')

    data = _get(
        MB_RELEASE_SEARCH_URL,
        {"query": " AND ".join(query_parts), "fmt": "json", "limit": limit},
    )
    if not data:
        return []

    candidates: list[ReleaseCandidate] = []
    for release in data.get("releases") or []:
        mbid = release.get("id")
        if not mbid:
            continue

        media = release.get("media") or []
        # The search endpoint reports the per-medium track count; summing the
        # media is the only way to get the count of the whole release.
        track_count = sum(medium.get("track-count") or 0 for medium in media)

        candidates.append(
            ReleaseCandidate(
                mbid=mbid,
                title=release.get("title") or "",
                artist=_artist_credit(release),
                date=release.get("date") or "",
                country=release.get("country") or "",
                format=_format_summary(media),
                track_count=track_count,
                score=int(release.get("score") or 0),
            )
        )

    return candidates


def fetch_release_tracks(mbid: str) -> list[RemoteTrack]:
    """
    Read the full track list of one release, in release order.

    `inc=recordings` is what turns a release into a track list; without it the
    lookup answers with the media and no tracks at all.
    """
    if not mbid:
        return []

    data = _get(MB_RELEASE_LOOKUP_URL.format(mbid=mbid), {"fmt": "json", "inc": "recordings+artist-credits"})
    if not data:
        return []

    tracks: list[RemoteTrack] = []
    for disc_index, medium in enumerate(data.get("media") or [], start=1):
        # A medium carries its own position; fall back to the enumeration so a
        # release without one still numbers its discs in order.
        disc = int(medium.get("position") or disc_index)

        for track_index, track in enumerate(medium.get("tracks") or [], start=1):
            recording = track.get("recording") or {}
            # The TRACK's title wins over the recording's: a release may retitle
            # a recording it reuses, and the track list is what the sleeve says.
            title = track.get("title") or recording.get("title") or ""
            if not title:
                continue

            length = track.get("length") or recording.get("length") or 0

            tracks.append(
                RemoteTrack(
                    position=int(track.get("position") or track_index),
                    disc=disc,
                    title=title,
                    length=int(length or 0),
                    artists=_artist_credit_names(track) or _artist_credit_names(recording),
                )
            )

    return tracks
