"""Tests for swingmusic.utils.mixes.latest_mix_per_artist.

The artist-mix table keeps one row per generation, not one per artist: a mix's
sourcehash comes from the artist's current top tracks, so a shifting listening
history produces a fresh row for the same artist on every cron run. Nine rows
for three artists is the normal steady state, which is why anything that shows
mixes has to collapse them first.
"""

from dataclasses import dataclass, field
from typing import Any

from swingmusic.utils.mixes import latest_mix_per_artist


@dataclass
class FakeMix:
    """Only the two fields the collapse actually reads."""

    id: str
    artisthash: str | None = None
    saved: bool = False
    extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if self.artisthash is not None:
            self.extra = {**self.extra, "artisthash": self.artisthash}


def ids(mixes):
    return [m.id for m in mixes]


class TestLatestMixPerArtist:
    def test_keeps_only_the_newest_mix_per_artist(self):
        # Input order is newest first, which is what MixTable.get_all() yields.
        mixes = [
            FakeMix("klepacki-5", "klepacki"),
            FakeMix("klepacki-4", "klepacki"),
            FakeMix("rhcp-2", "rhcp"),
            FakeMix("klepacki-3", "klepacki"),
            FakeMix("blues-1", "blues"),
        ]

        assert ids(latest_mix_per_artist(mixes)) == ["klepacki-5", "rhcp-2", "blues-1"]

    def test_preserves_the_incoming_order(self):
        mixes = [FakeMix("c", "c"), FakeMix("a", "a"), FakeMix("b", "b")]

        assert ids(latest_mix_per_artist(mixes)) == ["c", "a", "b"]

    def test_a_saved_mix_survives_a_newer_one_by_the_same_artist(self):
        # Saving is an explicit "keep this one". Collapsing it into a newer
        # generation would throw away exactly what was asked for.
        mixes = [
            FakeMix("klepacki-new", "klepacki"),
            FakeMix("klepacki-saved", "klepacki", saved=True),
            FakeMix("klepacki-old", "klepacki"),
        ]

        assert ids(latest_mix_per_artist(mixes)) == ["klepacki-new", "klepacki-saved"]

    def test_several_saved_mixes_of_one_artist_all_survive(self):
        mixes = [
            FakeMix("saved-a", "klepacki", saved=True),
            FakeMix("saved-b", "klepacki", saved=True),
            FakeMix("plain", "klepacki"),
        ]

        assert ids(latest_mix_per_artist(mixes)) == ["saved-a", "saved-b", "plain"]

    def test_a_saved_mix_does_not_claim_the_artist_slot(self):
        # The saved one is passed through without marking the artist as seen, so
        # the newest unsaved mix of that artist still comes along.
        mixes = [
            FakeMix("saved", "klepacki", saved=True),
            FakeMix("newest", "klepacki"),
            FakeMix("older", "klepacki"),
        ]

        assert ids(latest_mix_per_artist(mixes)) == ["saved", "newest"]

    def test_mixes_without_an_artisthash_pass_through(self):
        # Track mixes carry type "track" and no artisthash; they have nothing to
        # collapse against and must not be swallowed.
        mixes = [
            FakeMix("track-1"),
            FakeMix("track-2"),
            FakeMix("klepacki", "klepacki"),
        ]

        assert ids(latest_mix_per_artist(mixes)) == ["track-1", "track-2", "klepacki"]

    def test_tolerates_a_missing_extra_dict(self):
        mix = FakeMix("x")
        mix.extra = None  # type: ignore[assignment]

        assert ids(latest_mix_per_artist([mix])) == ["x"]

    def test_empty_input(self):
        assert latest_mix_per_artist([]) == []

    def test_a_single_mix_per_artist_is_unchanged(self):
        mixes = [FakeMix("a", "artist-a"), FakeMix("b", "artist-b")]

        assert ids(latest_mix_per_artist(mixes)) == ["a", "b"]
