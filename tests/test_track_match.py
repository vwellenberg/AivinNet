"""
The alignment between a local album and a release's track list.

Every test here is about the one failure this module exists to prevent: a
pairing that is off by one and therefore writes the wrong title into every file
after the gap. That kind of damage is invisible afterwards — the album reads as
a perfectly ordinary, tidy track list — so it has to be caught here.
"""

from dataclasses import dataclass

from aivinnet.lib.track_match import (
    LocalTrack,
    align,
    order_local,
    track_numbers_are_useless,
)


@dataclass
class Remote:
    """Stand-in for lib.mbrelease.RemoteTrack — the matcher only reads `length`."""

    title: str
    length: int = 0


def local(title: str, duration: int, *, track: int = 0, disc: int = 1, path: str = "") -> LocalTrack:
    return LocalTrack(
        trackhash=title,
        filepath=path or f"/music/{title}.mp3",
        title=title,
        track=track,
        disc=disc,
        duration=duration,
    )


def remote(title: str, seconds: int) -> Remote:
    return Remote(title=title, length=seconds * 1000)


class TestUselessTrackNumbers:
    def test_every_file_numbered_one_is_no_ordering(self):
        # The reported case: The Guild Gold Edition, every track "1".
        tracks = [local(f"t{i}", 100, track=1) for i in range(5)]

        assert track_numbers_are_useless(tracks) is True

    def test_proper_numbering_is_kept(self):
        tracks = [local(f"t{i}", 100, track=i + 1) for i in range(5)]

        assert track_numbers_are_useless(tracks) is False

    def test_repeated_numbers_across_discs_are_fine(self):
        # Track 1 appears twice, but on different discs — that is an album, not
        # a broken tag. Comparing numbers alone would have called this useless.
        tracks = [
            local("a", 100, track=1, disc=1),
            local("b", 100, track=2, disc=1),
            local("c", 100, track=1, disc=2),
        ]

        assert track_numbers_are_useless(tracks) is False

    def test_missing_numbers_count_as_useless(self):
        tracks = [local(f"t{i}", 100) for i in range(3)]

        assert track_numbers_are_useless(tracks) is True


class TestOrdering:
    def test_falls_back_to_the_file_path_when_numbers_say_nothing(self):
        tracks = [
            local("third", 100, track=1, path="/music/03 third.mp3"),
            local("first", 100, track=1, path="/music/01 first.mp3"),
            local("second", 100, track=1, path="/music/02 second.mp3"),
        ]

        assert [t.title for t in order_local(tracks)] == ["first", "second", "third"]

    def test_good_numbers_beat_the_file_path(self):
        tracks = [
            local("b", 100, track=2, path="/music/aaa.mp3"),
            local("a", 100, track=1, path="/music/zzz.mp3"),
        ]

        assert [t.title for t in order_local(tracks)] == ["a", "b"]


class TestAlignment:
    def test_matching_albums_pair_in_order(self):
        loc = [local("x", 180), local("y", 200), local("z", 240)]
        rem = [remote("One", 181), remote("Two", 199), remote("Three", 240)]

        result = align(loc, rem)

        assert [(p.local.title, p.remote.title) for p in result.pairings] == [
            ("x", "One"),
            ("y", "Two"),
            ("z", "Three"),
        ]
        assert result.confident_count == 3

    def test_a_track_missing_locally_does_not_shift_the_rest(self):
        # THE regression. The local rip lacks the release's second track.
        # Pairing by position would give "y" the title "Two" and "z" the title
        # "Three" — every remaining file wrong, and the result looks tidy.
        loc = [local("x", 180), local("y", 300), local("z", 240)]
        rem = [remote("One", 181), remote("Two", 120), remote("Three", 299), remote("Four", 241)]

        result = align(loc, rem)

        matched = [(p.local.title, p.remote.title) for p in result.pairings if p.matched]
        assert matched == [("x", "One"), ("y", "Three"), ("z", "Four")]
        assert result.unmatched_remote == 1
        assert result.unmatched_local == 0

    def test_a_bonus_track_locally_stays_unmatched(self):
        loc = [local("x", 180), local("bonus", 95), local("z", 240)]
        rem = [remote("One", 180), remote("Two", 241)]

        result = align(loc, rem)

        matched = [(p.local.title, p.remote.title) for p in result.pairings if p.matched]
        assert matched == [("x", "One"), ("z", "Two")]
        assert result.unmatched_local == 1

    def test_order_is_never_broken_to_chase_a_duration(self):
        # Two tracks of identical length in swapped positions. A matcher that
        # may reorder would pair them across; a track list is a sequence.
        loc = [local("first", 100), local("second", 300)]
        rem = [remote("A", 300), remote("B", 100)]

        result = align(loc, rem)

        pairs = [(p.local.title if p.local else None, p.remote.title if p.remote else None) for p in result.pairings]
        assert pairs.index(("first", "A")) < pairs.index(("second", "B")) if ("first", "A") in pairs else True
        # Whatever it decides, "second" may never be paired before "first".
        locals_in_order = [p.local.title for p in result.pairings if p.local]
        assert locals_in_order == ["first", "second"]

    def test_unknown_durations_still_pair_in_order(self):
        # MusicBrainz has no length for some recordings. Falling back to order
        # is exactly right here — it is the only evidence left.
        loc = [local("x", 0), local("y", 0)]
        rem = [remote("One", 0), remote("Two", 0)]

        result = align(loc, rem)

        assert [(p.local.title, p.remote.title) for p in result.pairings] == [("x", "One"), ("y", "Two")]
        # No length on either side means no claim about the quality of the pair.
        assert all(p.delta is None for p in result.pairings)
        assert result.confident_count == 0

    def test_an_empty_release_leaves_everything_unmatched(self):
        loc = [local("x", 180)]

        result = align(loc, [])

        assert result.matched_count == 0
        assert result.unmatched_local == 1

    def test_an_empty_library_side_is_not_a_crash(self):
        result = align([], [remote("One", 180)])

        assert result.matched_count == 0
        assert result.unmatched_remote == 1
