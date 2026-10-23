"""
What a user heard for the first time (#539): the albums and artists whose
first play ever falls in a period.

"New" means new to the user, not new since the period before: an album last
played two years ago and played again this week is not a discovery. The chart
captions said one thing for albums ("new" = not in the period before) and
another for artists (not in the whole history before); both read this now.

Pure, like `lib/home/`: the endpoint hands in each track's first play and how
a track resolves to its album and artists, these functions do the rest.
Testable in the fast lane, strict under mypy.
"""

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class FirstPlays:
    """The first play (a timestamp) of every album and artist the user played."""

    albums: dict[str, int]
    artists: dict[str, int]


def first_plays(
    first_by_track: Mapping[str, int],
    resolve: Callable[[str], tuple[str, Iterable[str]] | None],
    skip_artist: Callable[[str], bool] = lambda artisthash: False,
) -> FirstPlays:
    """
    Fold each track's first play into its album's and artists' first plays.

    `resolve` gives a track's album hash and the hashes of the artists on it,
    or None for a track no longer in the library: its plays name nothing that
    could be shown, so they count for nothing. `skip_artist` leaves out names
    that are no one ("Unknown", "Various Artists").
    """
    albums: dict[str, int] = {}
    artists: dict[str, int] = {}

    for trackhash, first in first_by_track.items():
        found = resolve(trackhash)
        if found is None:
            continue

        albumhash, artisthashes = found
        albums[albumhash] = min(first, albums.get(albumhash, first))
        for artisthash in artisthashes:
            if not skip_artist(artisthash):
                artists[artisthash] = min(first, artists.get(artisthash, first))

    return FirstPlays(albums, artists)


def first_heard_in(first: Mapping[str, int], start: float, end: float) -> list[str]:
    """The hashes first played between `start` and `end` (inclusive), the latest discovery first."""
    found = [(when, hash) for hash, when in first.items() if start <= when <= end]
    return [hash for _, hash in sorted(found, reverse=True)]
