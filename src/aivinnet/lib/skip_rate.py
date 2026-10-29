"""
The skip quote on the stats page (#537): how much of each track was listened to.

A play is a skip when the listened seconds stay under `SKIP_BELOW` of the
track's length, and played to the end when they reach `FINISHED_FROM`. Two
rankings come from that, both over tracks with at least `MIN_PLAYS` plays
(one skip of one play is "100 %" otherwise):

- most skipped: the tracks whose share of skipped plays is highest;
- always to the end: the tracks with at least `ALWAYS_SHARE` of finished plays.

The overall rate is skipped plays over all counted plays of the period.

It is a LOWER BOUND: `log_track` drops plays under 5 s (the client never sends
them), so the fastest skips are not in the data at all. The client says so.

A play counts only when its track is in the library with a positive length.
Plays of tracks no longer in the library, and of zero-length tracks, have no
share and are left out of every number. A listened length above the track's
length (a play counted past the end) is finished.

`ScrobbleTable.plays_by_trackhash_and_duration_in_period` groups in SQL, per
track and listened length, and the lengths come from `TrackStore`; this only
turns those rows into the numbers. Testable in the fast lane.
"""

from collections.abc import Iterable, Mapping
from typing import Any

# A play listened to under this share of the track is a skip.
SKIP_BELOW = 0.30
# A play listened to at least this share of the track counts as played to the end.
FINISHED_FROM = 0.90
# A track needs this many plays before its shares say anything.
MIN_PLAYS = 5
# "Always to the end": this share of a track's plays are finished.
ALWAYS_SHARE = 0.90
# Tracks per list.
TOP = 5


def build_skip_rate(
    rows: Iterable[tuple[str, int, int]],
    lengths: Mapping[str, int],
) -> dict[str, Any]:
    """
    The skip quote of a period.

    `rows` are `(trackhash, seconds listened, plays)`, one per track and listened
    length. `lengths` maps a trackhash to its length in seconds for every track
    in the library; a track missing there is left out.

    Returns the overall `plays`, `skipped` and `rate` (`None` without a counted
    play), the `most_skipped` and `to_the_end` lists of at most `TOP` tracks, and
    the `rules` the numbers were counted by, so the client states them as they are.
    """
    # trackhash -> [plays, skipped plays, finished plays]
    tallies: dict[str, list[int]] = {}
    for trackhash, listened, plays in rows:
        length = lengths.get(trackhash, 0)
        if length <= 0 or plays <= 0:
            continue

        share = listened / length
        tally = tallies.setdefault(trackhash, [0, 0, 0])
        tally[0] += plays
        if share < SKIP_BELOW:
            tally[1] += plays
        elif share >= FINISHED_FROM:
            tally[2] += plays

    counted = sum(tally[0] for tally in tallies.values())
    skipped = sum(tally[1] for tally in tallies.values())

    # (share, skipped, trackhash, plays): the highest share first, then the most skips.
    skip_ranks = [
        (tally[1] / tally[0], tally[1], trackhash, tally[0])
        for trackhash, tally in tallies.items()
        if tally[0] >= MIN_PLAYS and tally[1] > 0
    ]
    skip_ranks.sort(key=lambda row: (-row[0], -row[1], row[2]))

    # (share, plays, trackhash, finished): the highest share first, then the most plays.
    finish_ranks = [
        (tally[2] / tally[0], tally[0], trackhash, tally[2])
        for trackhash, tally in tallies.items()
        if tally[0] >= MIN_PLAYS and tally[2] / tally[0] >= ALWAYS_SHARE
    ]
    finish_ranks.sort(key=lambda row: (-row[0], -row[1], row[2]))

    return {
        "plays": counted,
        "skipped": skipped,
        "rate": skipped / counted if counted else None,
        "most_skipped": [
            {"trackhash": trackhash, "plays": plays, "skipped": skips, "share": share}
            for share, skips, trackhash, plays in skip_ranks[:TOP]
        ],
        "to_the_end": [
            {"trackhash": trackhash, "plays": plays, "finished": finished, "share": share}
            for share, plays, trackhash, finished in finish_ranks[:TOP]
        ],
        "rules": {
            "skip_below": SKIP_BELOW,
            "finished_from": FINISHED_FROM,
            "min_plays": MIN_PLAYS,
            "always": ALWAYS_SHARE,
        },
    }
