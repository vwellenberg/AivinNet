"""
"Almost complete" (#529): albums the user has heard most of, but not all —
"3 songs to go". Unlike "Continue listening", which knows only sessions broken
off among the last 200 plays, this counts the whole history: a track heard
once, years ago, is heard.

Pure like `discover.py`: the routine (`lib/recipes/homerows.py`) hands in the
library's albums with their tracks in album order and the tracks the user has
ever played. Strict under mypy.
"""

from collections.abc import Callable, Collection, Iterable, Sequence
from dataclasses import dataclass
from typing import Any

# A single or an EP is not "almost complete" with one song missing.
ALMOST_MIN_TRACKS = 4
# Heard at least this share of the album's tracks.
ALMOST_MIN_SHARE = 0.6
ALMOST_ROW_LIMIT = 15


@dataclass(frozen=True)
class AlbumTracks:
    """An album of the library: its tracks in album order, and its album artists."""

    albumhash: str
    trackhashes: Sequence[str]
    artists: tuple[str, ...] = ()


@dataclass(frozen=True)
class AlmostComplete:
    albumhash: str
    # The tracks never played, in album order: what "Play the rest" plays.
    missing: tuple[str, ...]
    total: int


def rank_almost_complete(
    albums: Iterable[AlbumTracks],
    heard: Collection[str],
    exclude: Callable[[str], bool] = lambda artisthash: False,
    limit: int = ALMOST_ROW_LIMIT,
) -> list[AlmostComplete]:
    """
    Albums with at least `ALMOST_MIN_TRACKS` tracks, at least
    `ALMOST_MIN_SHARE` of them in `heard` and at least one not. The fewest
    missing first (the nearest to complete), then the larger share, then by
    hash so a run does not depend on the library's order. None whose album
    artists are all `exclude`d (untagged files).
    """
    found: list[AlmostComplete] = []
    for album in albums:
        tracks = list(dict.fromkeys(album.trackhashes))  # a track in two files counts once
        if len(tracks) < ALMOST_MIN_TRACKS:
            continue
        # No album artist at all is untagged too, as for "Never played".
        if not album.artists or all(exclude(a) for a in album.artists):
            continue

        missing = tuple(t for t in tracks if t not in heard)
        played = len(tracks) - len(missing)
        if missing and played / len(tracks) >= ALMOST_MIN_SHARE:
            found.append(AlmostComplete(album.albumhash, missing, len(tracks)))

    found.sort(key=lambda a: (len(a.missing), len(a.missing) / a.total, a.albumhash))
    return found[:limit]


def almost_complete_item(album: AlmostComplete) -> dict[str, Any]:
    return _card(album.albumhash, len(album.missing))


def _card(albumhash: str, left: int) -> dict[str, Any]:
    return {
        "type": "album",
        "hash": albumhash,
        "help_text": f"{left} {'song' if left == 1 else 'songs'} to go",
        "home": {"missing": left},
    }


def after_play(
    items: Sequence[dict[str, Any]], rest: Sequence[str], trackhash: str, albumhash: str
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    The row and its "Play the rest" after one play, without waiting for the
    next run: doing what the row asks (playing the missing songs) would leave
    "2 songs to go" on an album heard through, and the button would play the
    same songs again. A song that was not missing changes nothing; the card of
    an album with nothing left goes.
    """
    if trackhash not in rest:
        return list(items), list(rest)

    cards: list[dict[str, Any]] = []
    for item in items:
        if item["hash"] == albumhash:
            left = int(item["home"]["missing"]) - 1
            if left <= 0:
                continue
            item = _card(albumhash, left)
        cards.append(item)
    return cards, [t for t in rest if t != trackhash]


def rest_of(albums: Iterable[AlmostComplete]) -> list[str]:
    """ "Play the rest": every missing track, album after album, each in album order."""
    return [trackhash for album in albums for trackhash in album.missing]
