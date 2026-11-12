"""
"Your top rated" (#788, part 1): the tracks the user rated 4 or 5 that they
have not heard lately, longest unplayed first.

Pure rules like the rest of `lib/home/` (no database, no stores): the routine
in `lib/recipes/homerows.py` hands in the user's ratings, their plays and the
facts of a track. Testable in the fast lane, strict under mypy.
"""

from collections.abc import Callable, Iterable, Mapping
from typing import Any

from aivinnet.lib.home.discover import Play, TrackFacts, _month

# A rating from this up puts a track in the row (the user's 4 and 5).
TOP_RATED_MIN = 4
# What the row shows at most; the playlist ("Play all") keeps more.
TOP_RATED_ROW_LIMIT = 15
TOP_RATED_PLAYLIST_LIMIT = 100
TOP_RATED_MAX_PER_ALBUM = 2


def rank_top_rated(
    ratings: Mapping[str, int],
    plays: Iterable[Play],
    facts_of: Callable[[str], TrackFacts | None],
    limit: int = TOP_RATED_ROW_LIMIT,
    max_per_album: int = TOP_RATED_MAX_PER_ALBUM,
) -> list[tuple[str, int, int | None]]:
    """
    The user's tracks rated `TOP_RATED_MIN` or more, as `(trackhash, rating,
    last played or None)`. A track never played counts as the oldest, so it
    comes first; then the longest unplayed; ties by the higher rating, then by
    trackhash. Tracks not in the library (`facts_of` is None) are left out, and
    at most `max_per_album` per album.
    """
    last: dict[str, int] = {}
    for play in plays:
        last[play.trackhash] = max(last.get(play.trackhash, play.timestamp), play.timestamp)

    candidates: list[tuple[str, int, int | None, str]] = []
    for trackhash, rating in ratings.items():
        if rating < TOP_RATED_MIN:
            continue
        facts = facts_of(trackhash)
        if facts is None:
            continue
        candidates.append((trackhash, rating, last.get(trackhash), facts.albumhash))

    # Never played first (False sorts before True), then the oldest last play.
    candidates.sort(key=lambda c: (c[2] is not None, c[2] or 0, -c[1], c[0]))

    picked: list[tuple[str, int, int | None]] = []
    per_album: dict[str, int] = {}
    for trackhash, rating, played, albumhash in candidates:
        if len(picked) >= limit:
            break
        if per_album.get(albumhash, 0) >= max_per_album:
            continue
        per_album[albumhash] = per_album.get(albumhash, 0) + 1
        picked.append((trackhash, rating, played))

    return picked


def top_rated_item(trackhash: str, rating: int, last_played: int | None) -> dict[str, Any]:
    """The card: the rating and when it was last heard, in `help_text` (the card's one line)."""
    if last_played is None:
        help_text = f"rated {rating} · not played yet"
    else:
        help_text = f"rated {rating} · last {_month(last_played)}"
    return {"type": "track", "hash": trackhash, "help_text": help_text}
