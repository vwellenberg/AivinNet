"""
Line a local album up against a release's track list.

Pure logic: no Flask, no store, no network — it takes two ordered lists and says
which entry belongs to which, so the whole thing is testable in the fast lane.

⚠️ **Why this is not `zip(local, remote)`.** Pairing by position is right only
when both sides hold exactly the same tracks. They usually do not: a rip may be
missing a track, carry a bonus track, or split an index track in two. Position
pairing then shifts **every** title after the gap by one — and because the
result gets written into the files, that is a library-wide corruption that looks
tidy afterwards. Nobody goes back to check a track list that reads correctly.

So the alignment is a proper ordered alignment with gaps, scored on **duration**.
Duration is the one field that survives bad tagging: the case this was built for
has placeholder titles and every track numbered 1, and the lengths are still
exactly what they always were.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# INFO: Cost of leaving an entry unmatched, in seconds of duration difference.
# Two gaps therefore cost 40, so a pairing is preferred while the durations are
# within 40 s of each other and rejected beyond it. Chosen against the shape of
# the error it guards: a genuine counterpart is usually within a second or two
# (the same master), while the neighbour it would slide onto is a different
# song and lands far outside.
GAP_COST = 20.0

# What an unknown duration is worth. MusicBrainz has no length for some
# recordings, and a local file can report 0 as well. Slightly cheaper than a
# gap, so order still carries the pairing — but not free, so a run of unknowns
# cannot outvote real evidence.
UNKNOWN_COST = GAP_COST * 0.9

# Above this the pair is shown as questionable rather than as a match.
CLOSE_ENOUGH = 5.0


@dataclass
class LocalTrack:
    """The part of a library track this module needs."""

    trackhash: str
    filepath: str
    title: str
    track: int = 0
    disc: int = 1
    duration: int = 0


@dataclass
class Pairing:
    """One row of the preview: what we have, what the release says."""

    local: LocalTrack | None
    remote: object | None
    # Absolute duration difference in seconds, None when either side has no
    # length to compare.
    delta: float | None = None

    @property
    def matched(self) -> bool:
        return self.local is not None and self.remote is not None

    @property
    def confident(self) -> bool:
        return self.matched and self.delta is not None and self.delta <= CLOSE_ENOUGH


@dataclass
class MatchResult:
    pairings: list[Pairing] = field(default_factory=list)

    @property
    def matched_count(self) -> int:
        return sum(1 for p in self.pairings if p.matched)

    @property
    def confident_count(self) -> int:
        return sum(1 for p in self.pairings if p.confident)

    @property
    def unmatched_local(self) -> int:
        return sum(1 for p in self.pairings if p.local is not None and p.remote is None)

    @property
    def unmatched_remote(self) -> int:
        return sum(1 for p in self.pairings if p.remote is not None and p.local is None)


def track_numbers_are_useless(tracks: list[LocalTrack]) -> bool:
    """
    True when the track numbers carry no ordering information.

    This is the situation the feature exists for — an album where every file
    says "track 1" — and it decides whether the tags or the file paths order the
    local side. Getting it wrong is not cosmetic: a sort on a constant key is
    stable, so it would silently leave the tracks in whatever order the store
    happened to hand them over.
    """
    if not tracks:
        return True

    keys = {(t.disc, t.track) for t in tracks}
    # One distinct key for several tracks means the numbering does not separate
    # them; a single track can never be out of order.
    return len(keys) < len(tracks)


def order_local(tracks: list[LocalTrack]) -> list[LocalTrack]:
    """
    Put the local side in the order the album is meant to play in.

    File paths are the fallback rather than the first choice: they usually carry
    the original numbering as a prefix, but they also sort "10" before "2", so
    they are worse than good tags and better than broken ones.
    """
    if track_numbers_are_useless(tracks):
        return sorted(tracks, key=lambda t: t.filepath)

    return sorted(tracks, key=lambda t: (t.disc or 1, t.track or 0, t.filepath))


def _pair_cost(local: LocalTrack, remote_length_ms: int) -> float:
    """What it costs to claim these two are the same track."""
    if not local.duration or not remote_length_ms:
        return UNKNOWN_COST
    return abs(local.duration - remote_length_ms / 1000)


def align(local: list[LocalTrack], remote: list) -> MatchResult:
    """
    Align two ordered track lists, allowing gaps on either side.

    Straight Needleman-Wunsch over the two sequences with duration as the
    similarity measure. The order constraint is the point: a track list is a
    sequence, so a matcher that may reorder would happily pair track 3 with
    track 9 because their lengths agree.
    """
    n, m = len(local), len(remote)

    # cost[i][j] = cheapest alignment of the first i local and first j remote.
    cost = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        cost[i][0] = cost[i - 1][0] + GAP_COST
    for j in range(1, m + 1):
        cost[0][j] = cost[0][j - 1] + GAP_COST

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            pair = cost[i - 1][j - 1] + _pair_cost(local[i - 1], getattr(remote[j - 1], "length", 0) or 0)
            skip_local = cost[i - 1][j] + GAP_COST
            skip_remote = cost[i][j - 1] + GAP_COST
            cost[i][j] = min(pair, skip_local, skip_remote)

    # Walk back. Ties resolve towards a pairing: with unknown durations every
    # option costs the same, and "these are the same track, in order" is the
    # more useful reading of that than two gaps.
    pairings: list[Pairing] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0:
            length = getattr(remote[j - 1], "length", 0) or 0
            step = _pair_cost(local[i - 1], length)
            if abs(cost[i][j] - (cost[i - 1][j - 1] + step)) < 1e-9:
                delta = (
                    None if (not local[i - 1].duration or not length) else abs(local[i - 1].duration - length / 1000)
                )
                pairings.append(Pairing(local=local[i - 1], remote=remote[j - 1], delta=delta))
                i -= 1
                j -= 1
                continue

        if i > 0 and abs(cost[i][j] - (cost[i - 1][j] + GAP_COST)) < 1e-9:
            pairings.append(Pairing(local=local[i - 1], remote=None))
            i -= 1
            continue

        pairings.append(Pairing(local=None, remote=remote[j - 1]))
        j -= 1

    pairings.reverse()
    return MatchResult(pairings=pairings)
