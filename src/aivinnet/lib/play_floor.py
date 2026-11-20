"""
How long a track has to play to count as played (#882).

The floor is there to drop skips: a play under 5 s is not a listen. Applied as
it stood, it also dropped every play of a track that is itself under 5 s long,
however often it ran to the end. Such a track could never count as heard, and
an album holding one never left "Almost complete" (live: five 0-3 s stingers on
a game soundtrack, "6 songs to go" forever).

So the floor follows the track: a short track counts when it played to the
end, give or take the client's way of measuring. The client adds play time on
`timeupdate`, throttled to once a second (`client/src/stores/tracker.ts`); the
last second before the end and up to one at the start are lost, so a track
that ran through reports up to two seconds less than its length. The client
applies the same rule before it sends (`minLoggedSeconds`).

Pure and strict under mypy.
"""

# A play shorter than this is a skip, for any track of at least this length + 2 s.
MIN_PLAY_SECONDS = 5
# What a track that ran through may report less than its length.
TICK_TOLERANCE_SECONDS = 2
# The client sends nothing under one second of play, so a track must be at
# least this long to ever be logged once it played through.
MIN_LOGGABLE_TRACK_SECONDS = 3


def min_logged_seconds(track_seconds: float) -> int:
    """The shortest play of a track this long that counts: 5 s, less for a shorter track, never under 1 s."""
    return int(min(MIN_PLAY_SECONDS, max(1, track_seconds - TICK_TOLERANCE_SECONDS)))


def can_be_logged(track_seconds: float) -> bool:
    """Whether a play of the whole track reliably reaches the client's floor."""
    return track_seconds >= MIN_LOGGABLE_TRACK_SECONDS
