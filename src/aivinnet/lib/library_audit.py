"""
Albums whose tags look broken — the list a scan cannot fix on its own.

A scan reads tags and, where they are missing, guesses from folder and file
names. Some guesses produce damage that is obvious to a person and invisible to
the indexer: every track of an album filed as an album of its own, `Track 03` as
a title, a track number as the artist. This module finds those shapes so the
library can name them after each scan instead of waiting for someone to stumble
over them.

It only reads. Writing new tags is a decision about identity (which release is
this?) that a person confirms, in the metadata dialog or the tag editor.

Every rule here comes from a real case in the reference library, and so does
every exception: `Unknown` is the CORRECT artist for a home recording, so it
only counts when the folder looks like a ripped album (numbered files).
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Protocol

# Reasons, in the order they are shown. Strings, because they go to the client.
SPLIT = "split"  # one album in one folder, filed as several
NUMBER_ARTIST = "number_artist"  # "01", "05 Dark": a track number read as the artist
PLACEHOLDER_TITLE = "placeholder_title"  # "Track 03", "Neuer Titel (100)"
PLACEHOLDER_ARTIST = "placeholder_artist"  # "Neuer Künstler (4)", "Unknown Artist"
UNKNOWN_ARTIST = "unknown_artist"  # no artist at all, on what looks like a ripped album

VARIOUS = "Various Artists"

_PLACEHOLDER_TITLE = re.compile(r"^(track|spur|titel|audiotrack|neuer titel)\s*\(?\d+\)?$", re.IGNORECASE)
_PLACEHOLDER_ARTIST = re.compile(
    r"^(neuer künstler(\s*\(\d+\))?|unknown artist|unbekannter (interpret|künstler))$", re.IGNORECASE
)
_NUMBER_ARTIST = re.compile(r"^(\d+|0\d+\s.*)$")
_NUMBERED_FILE = re.compile(r"^\d+[\s._)-]")

# An `Unknown` artist only counts on something that looks like an album: enough
# tracks, and almost all of them numbered. Measured on the reference library,
# this keeps 85 folders of home recordings and loops off the list.
_UNKNOWN_MIN_TRACKS = 5
_UNKNOWN_MIN_NUMBERED = 0.8


class _Track(Protocol):
    filepath: str
    folder: str
    title: str
    album: str
    albumhash: str
    artists: list[dict[str, str]]
    albumartists: list[dict[str, str]]


@dataclass
class Finding:
    """One album (or one folder of album fragments) that needs a look."""

    albumhash: str
    title: str
    albumartists: list[str]
    folder: str
    trackcount: int
    reasons: list[str] = field(default_factory=list)
    # Only set for SPLIT: how many albums the folder's tracks fell into.
    fragments: int = 1
    # The album artists a merge could use: the ones the tracks already carry,
    # most frequent first, then "Various Artists".
    merge_candidates: list[str] = field(default_factory=list)

    @property
    def key(self) -> str:
        # What "ignore" remembers. The folder and the album title, not the
        # albumhash: a split album has several hashes, and the hash changes with
        # any tag edit — which is exactly when the finding should come back.
        return f"{self.folder}\x00{self.title}"

    def todict(self) -> dict:
        return {
            "key": self.key,
            "albumhash": self.albumhash,
            "title": self.title,
            "albumartists": self.albumartists,
            "folder": self.folder,
            "trackcount": self.trackcount,
            "reasons": self.reasons,
            "fragments": self.fragments,
            "merge_candidates": self.merge_candidates,
        }


def _names(people: list[dict[str, str]]) -> list[str]:
    return [p.get("name", "") for p in people]


def _filename(track: _Track) -> str:
    return track.filepath.rsplit("/", 1)[-1]


def _merge_candidates(tracks: list[_Track]) -> list[str]:
    counts = Counter(name for t in tracks for name in _names(t.albumartists))
    names = [name for name, _ in counts.most_common() if not _NUMBER_ARTIST.match(name) and name != "Unknown"]
    return names if VARIOUS in names else [*names, VARIOUS]


def _basename(folder: str) -> str:
    return folder.rstrip("/").rsplit("/", 1)[-1]


def _album_reasons(tracks: list[_Track]) -> list[str]:
    reasons = []
    artists = [name for t in tracks for name in _names(t.artists) + _names(t.albumartists)]

    if any(_NUMBER_ARTIST.match(name) for name in artists):
        reasons.append(NUMBER_ARTIST)
    if any(_PLACEHOLDER_TITLE.match(t.title.strip()) for t in tracks):
        reasons.append(PLACEHOLDER_TITLE)
    if any(_PLACEHOLDER_ARTIST.match(name) for name in artists):
        reasons.append(PLACEHOLDER_ARTIST)

    unknown = [t for t in tracks if "Unknown" in _names(t.artists)]
    numbered = sum(1 for t in tracks if _NUMBERED_FILE.match(_filename(t)))
    if unknown and len(tracks) >= _UNKNOWN_MIN_TRACKS and numbered >= _UNKNOWN_MIN_NUMBERED * len(tracks):
        reasons.append(UNKNOWN_ARTIST)

    return reasons


def find_suspicious_albums(tracks: Iterable[_Track], ignored: Iterable[str] = ()) -> list[Finding]:
    """
    The albums that look broken, most tracks first.

    Grouped by folder and album TITLE before by albumhash: that is how the worst
    case becomes visible at all. "Saving Private Ryan" had one title and one
    folder, but no album artist — so each track's artist (parsed from its file
    name as `01`, `02`, …) went into the albumhash, and the library showed ten
    albums of one track each. Per albumhash, each of them looked fine.
    """
    groups: dict[tuple[str, str], list[_Track]] = defaultdict(list)
    for track in tracks:
        groups[(track.folder, track.album)].append(track)

    skip = set(ignored)
    findings = []

    for (folder, title), members in groups.items():
        by_hash: dict[str, list[_Track]] = defaultdict(list)
        for track in members:
            by_hash[track.albumhash].append(track)

        largest = max(by_hash.values(), key=len)
        reasons = _album_reasons(members)
        if len(by_hash) > 1 and (title != _basename(folder) or NUMBER_ARTIST in reasons):
            # A title that is just the folder's name came from the scan's
            # fallback, not from a tag — a folder of loose singles ("sort",
            # "100-Musicians") shares it without being one album. It only
            # counts with a number for an artist: Saving Private Ryan's ten
            # tracks had exactly that, and the folder name as their album.
            reasons.insert(0, SPLIT)
        if not reasons:
            continue

        finding = Finding(
            albumhash=largest[0].albumhash,
            title=title,
            albumartists=sorted({n for t in largest for n in _names(t.albumartists)}),
            folder=folder,
            trackcount=len(members),
            reasons=reasons,
            fragments=len(by_hash),
            merge_candidates=_merge_candidates(members) if SPLIT in reasons else [],
        )
        if finding.key not in skip:
            findings.append(finding)

    findings.sort(key=lambda f: (-f.trackcount, f.folder))
    return findings
