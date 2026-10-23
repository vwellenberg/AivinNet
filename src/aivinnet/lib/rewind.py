"""
AivinNet Rewind (#527): a year of listening, told in a handful of numbers —
the local "Wrapped", nothing leaves the server.

Pure rules like `lib/home/discover.py`: the endpoint (`api/scrobble`) reads the
year's plays and resolves each trackhash to its `TrackFacts`; these functions
turn them into hashes and numbers, and the endpoint puts names and covers on
them. Testable in the fast lane, strict under mypy.

Only plays of tracks still in the library count, like on every other page
(`.claude/rules/recommendations.md`): a play that cannot be shown cannot be a
top track either.
"""

from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from datetime import datetime, tzinfo
from typing import Any, Protocol

from aivinnet.lib.home.discover import TrackFacts, time_slot
from aivinnet.lib.listening_sources import source_kind, source_shares

# How many entries the top lists carry.
REWIND_TOP = 5
# "Song of your summer": the northern summer, June to August.
SUMMER_MONTHS = (6, 7, 8)
# How many of the year's new artists are named.
REWIND_NEW_NAMED = 3


class RewindPlay(Protocol):
    """The fields of `models.logger.TrackLog` Rewind reads."""

    trackhash: str
    timestamp: int
    duration: int
    source: str


def finished_years(years: Iterable[int], this_year: int) -> list[int]:
    """
    The years with plays a Rewind can be opened for, oldest first. A year
    opens on January 1 of the next one — a look back at a year still running
    would change every day, so this year never has one.
    """
    return sorted({year for year in years if year < this_year})


def _top(counter: Counter[str], n: int = REWIND_TOP) -> list[tuple[str, int]]:
    """The `n` highest, ties by hash so a run does not depend on dict order."""
    return sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]


def build_rewind(
    plays: Sequence[RewindPlay],
    facts_of: Callable[[str], TrackFacts | None],
    tz: tzinfo | None,
    heard_before: set[str],
    skip: Callable[[str], bool] = lambda artisthash: False,
    generated: Iterable[str] = (),
) -> dict[str, Any]:
    """
    The numbers of one year. `plays` are the year's plays, in any order;
    `heard_before` the artists the user played before the year (for "new
    artists"); `skip` leaves out placeholder artists; `generated` names the
    server's generated playlists (`source_kind`). Days and hours in `tz`;
    None is the C library's local time, the zone the listening calendar
    groups its days in (SQLite's `localtime`).
    """
    cache: dict[str, TrackFacts | None] = {}

    def facts(trackhash: str) -> TrackFacts | None:
        if trackhash not in cache:
            cache[trackhash] = facts_of(trackhash)
        return cache[trackhash]

    counted = [(p, f) for p in plays if (f := facts(p.trackhash)) is not None]
    counted.sort(key=lambda pf: pf[0].timestamp)

    seconds = 0
    artist_time: Counter[str] = Counter()
    album_time: Counter[str] = Counter()
    track_time: Counter[str] = Counter()
    track_plays: Counter[str] = Counter()
    summer: Counter[str] = Counter()
    days: Counter[str] = Counter()
    bands: Counter[str] = Counter()
    sources: Counter[str] = Counter()
    generated_ids = frozenset(generated)

    for play, f in counted:
        when = datetime.fromtimestamp(play.timestamp, tz)
        seconds += play.duration
        track_time[play.trackhash] += play.duration
        track_plays[play.trackhash] += 1
        album_time[f.albumhash] += play.duration
        for artist in {a for a in f.track_artists or f.artists if not skip(a)}:
            artist_time[artist] += play.duration
        if when.month in SUMMER_MONTHS:
            summer[play.trackhash] += 1
        days[when.date().isoformat()] += play.duration
        bands[time_slot(when)[1]] += 1
        sources[source_kind(play.source, generated_ids)] += 1

    new_artists = Counter({a: t for a, t in artist_time.items() if a not in heard_before})
    # The same rule as the stats tile "how you listened" (#538).
    listener = source_shares(sources)[:1]
    band = _top(bands, 1)
    busiest = _top(days, 1)
    summer_top = _top(summer, 1)

    return {
        "plays": len(counted),
        "seconds": seconds,
        "days": len(days),
        "top_artists": _top(artist_time),
        "top_albums": _top(album_time),
        # By time listened, like the charts; the plays ride along.
        "top_tracks": [(t, s, track_plays[t]) for t, s in _top(track_time)],
        "summer_track": (summer_top[0][0], summer_top[0][1]) if summer_top else None,
        "first_track": (counted[0][0].trackhash, counted[0][0].timestamp) if counted else None,
        "busiest_day": busiest[0] if busiest else None,
        "new_artists": len(new_artists),
        "new_artists_top": [a for a, _ in _top(new_artists, REWIND_NEW_NAMED)],
        "listener": (
            {
                "kind": listener[0][0],
                "share": listener[0][1],
            }
            if listener
            else None
        ),
        "time_of_day": (
            {"band": band[0][0], "share": round(band[0][1] / len(counted), 2)} if band and counted else None
        ),
    }
