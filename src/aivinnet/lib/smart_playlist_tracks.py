"""
The library side of smart playlists.

Builds the `TrackFacts` of every track from the RAM store and this user's play
totals, then hands them to the pure rules in `lib/smart_playlists.py`. The
play totals are one grouped SQL read per user, cached until that user's next
play (`ScrobbleTable.change_marker`, the same key as the other per-user
caches). Nothing is read per track.

It is O(library) per call, in RAM: a page of a smart playlist walks the store
again, which is cheap next to a request that reads the database per track.
"""

import time

from aivinnet.db.userdata import ScrobbleTable
from aivinnet.lib.smart_playlists import SECONDS_PER_DAY, Definition, TrackFacts, evaluate
from aivinnet.models.track import Track
from aivinnet.store.tracks import TrackStore

# userid -> (change marker, {trackhash: (plays, last timestamp)})
_plays_cache: dict[int, tuple[tuple[int, int], dict[str, tuple[int, int]]]] = {}


def plays_of(userid: int) -> dict[str, tuple[int, int]]:
    """This user's `trackhash -> (plays, last timestamp)`, cached until their next play."""
    # The marker is read first: a play landing in between leaves the cache one
    # step behind, and the next call sees the marker has moved and rebuilds.
    marker = ScrobbleTable.change_marker(userid)
    cached = _plays_cache.get(userid)
    if cached is not None and cached[0] == marker:
        return cached[1]

    plays = ScrobbleTable.plays_by_trackhash_of(userid)
    _plays_cache[userid] = (marker, plays)
    return plays


def tracks_of(userid: int, defn: Definition, seed: str = "", now: int | None = None) -> list[str]:
    """
    The trackhashes this smart playlist holds for `userid` right now.

    A random sort is seeded with `seed` and the day, so its order holds across
    the pages of one view and changes from one day to the next.
    """
    moment = int(time.time()) if now is None else now
    plays = plays_of(userid)

    # A snapshot of the groups: a scan on another thread may add or drop one.
    facts = [
        _facts_of(trackhash, group.get_best(), userid, plays)
        for trackhash, group in list(TrackStore.trackhashmap.items())
        if group.tracks
    ]
    return evaluate(defn, facts, moment, seed=f"{seed}:{moment // SECONDS_PER_DAY}")


def _facts_of(trackhash: str, track: Track, userid: int, plays: dict[str, tuple[int, int]]) -> TrackFacts:
    count, last = plays.get(trackhash, (0, 0))
    return TrackFacts(
        trackhash=trackhash,
        title=track.title,
        genres=tuple(g["name"] for g in track.genres) if isinstance(track.genres, list) else (),
        artists=tuple(a["name"] for a in track.artists),
        albumartists=tuple(a["name"] for a in track.albumartists),
        year=_year_of(track),
        added=track.added,
        playcount=count,
        last_played=last if count else None,
        favorite=userid in track.fav_userids,
    )


def _year_of(track: Track) -> int | None:
    # The same test as `recommendations`' release date: a file without a year
    # tag gets its mtime as `date`, and that is no release year.
    if not track.date or track.date == track.last_mod:
        return None
    try:
        return time.gmtime(track.date).tm_year
    except (OverflowError, OSError, ValueError):
        return None
