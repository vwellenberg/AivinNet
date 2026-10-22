"""
"Your mixes" (`lib/home/mixes.py`, #526): artist groups from the user's own
listening sessions, and the tracks of each mix.

The module imports no database or store code, so these run in the fast lane.
"""

from collections import Counter
from dataclasses import dataclass

from aivinnet.lib.home.discover import TrackFacts
from aivinnet.lib.home.mixes import (
    MIX_LENGTH,
    MIX_PLAYLIST_IDS,
    Mix,
    build_mixes,
    group_artists,
    known_tracks,
    mix_tracks,
    place_mixes,
)

DAY = 86400
NOW = 1_790_000_000


@dataclass
class Play:
    trackhash: str
    timestamp: int


ARTISTS = {
    # artist: albums
    "rhcp": ("rhcp1", "rhcp2"),
    "fnm": ("fnm1",),
    "primus": ("primus1",),
    "miles": ("miles1", "miles2"),
    "coltrane": ("coltrane1",),
    "monk": ("monk1",),
    "va": ("comp1",),
    "air": ("air1",),
    "daft": ("daft1",),
    "justice": ("justice1",),
}


def facts(trackhash: str) -> TrackFacts | None:
    """Tracks "<album>/<n>"; a compilation track "comp1/<n>/<artist>"."""
    parts = trackhash.split("/")
    album = parts[0]
    artist = next((a for a, albums in ARTISTS.items() if album in albums), None)
    if artist is None:
        return None
    track_artist = parts[2] if len(parts) > 2 else artist
    return TrackFacts(albumhash=album, artists=(artist,), track_artists=(track_artist,))


def tracks_of(artist: str) -> list[str]:
    """Ten tracks per album in the library."""
    return [f"{album}/{n}" for album in ARTISTS.get(artist, ()) for n in range(1, 11)]


def session(start: int, *trackhashes: str) -> list[Play]:
    return [Play(t, start + i * 240) for i, t in enumerate(trackhashes)]


def two_tastes(weeks: int = 12) -> list[Play]:
    """Funk evenings (RHCP with Faith No More and Primus) and jazz mornings
    (Miles Davis with Coltrane and Monk), never in the same session."""
    plays: list[Play] = []
    for week in range(weeks):
        evening = NOW - week * 7 * DAY - 10 * 3600
        plays += session(evening, "rhcp1/1", "fnm1/1", "rhcp1/2", "primus1/1", "rhcp2/3")
        morning = NOW - week * 7 * DAY - 3 * DAY
        plays += session(morning, "miles1/1", "coltrane1/1", "miles1/2", "monk1/1")
    return plays


class TestGroups:
    def test_two_tastes_are_two_groups_strongest_first(self):
        groups = group_artists(two_tastes(), facts, NOW)

        assert groups == [["rhcp", "fnm", "primus"], ["miles", "coltrane", "monk"]]

    def test_too_short_a_history_is_none_not_empty(self):
        assert group_artists(two_tastes(weeks=2), facts, NOW) is None

    def test_old_sessions_do_not_count(self):
        old = [Play(p.trackhash, p.timestamp - 400 * DAY) for p in two_tastes()]

        assert group_artists(old, facts, NOW) is None

    def test_artists_played_together_share_one_mix(self):
        # The same artists, but jazz and funk alternate in every session: one taste.
        plays = []
        for week in range(12):
            plays += session(
                NOW - week * 7 * DAY,
                "rhcp1/1",
                "miles1/1",
                "fnm1/1",
                "coltrane1/1",
                "primus1/1",
                "monk1/1",
                "rhcp1/2",
                "miles1/2",
            )

        groups = group_artists(plays, facts, NOW)

        assert len(groups) == 1
        assert set(groups[0]) == {"rhcp", "fnm", "primus", "miles", "coltrane", "monk"}

    def test_a_group_of_two_is_no_mix(self):
        plays = []
        for week in range(15):
            plays += session(NOW - week * 7 * DAY, "rhcp1/1", "fnm1/1", "rhcp1/2", "fnm1/2")

        assert group_artists(plays, facts, NOW) == []

    def test_placeholders_never_lead_a_mix_but_compilation_artists_count(self):
        plays = two_tastes()
        # A compilation in the funk evenings: "Various Artists" is skipped, its
        # track artist Fishbone joins the funk group.
        ARTISTS["fishbone"] = ()
        try:
            for week in range(12):
                plays += session(NOW - week * 7 * DAY - 10 * 3600 + 2000, "comp1/1/fishbone", "rhcp1/3")

            groups = group_artists(plays, facts, NOW, skip=lambda a: a == "va")
        finally:
            del ARTISTS["fishbone"]

        assert groups is not None
        assert all("va" not in group for group in groups)
        assert "fishbone" in groups[0]

    def test_a_core_too_small_gives_its_place_up(self):
        # Miles Davis is played most, but only ever with Coltrane: a group of two.
        # With two places, it used to hold one and the third taste was never seen.
        plays = []
        for week in range(15):
            plays += session(NOW - week * 7 * DAY - 5 * DAY, "miles1/1", "coltrane1/1", "miles1/2", "miles2/1")
        for week in range(12):
            plays += session(NOW - week * 7 * DAY - 10 * 3600, "rhcp1/1", "fnm1/1", "rhcp1/2", "primus1/1", "rhcp2/3")
            plays += session(NOW - week * 7 * DAY - 2 * DAY, "daft1/1", "justice1/1", "air1/1")

        groups = group_artists(plays, facts, NOW, count=2)

        assert groups[0] == ["rhcp", "fnm", "primus"]
        assert set(groups[1]) == {"daft", "justice", "air"}

    def test_a_weak_tie_does_not_join_a_mix(self):
        # Air once in a funk evening, five times on its own: no member of funk.
        plays = two_tastes()
        plays += session(NOW - 10 * 3600 + 2000, "air1/1")
        for day in range(1, 6):
            plays += session(NOW - day * 2 * DAY - 6 * 3600, "air1/2")

        groups = group_artists(plays, facts, NOW)

        assert all("air" not in group for group in groups)


class TestTracks:
    def test_a_mix_opens_with_this_half_years_favourites(self):
        # Played 50 times two years ago: still "played" (no fresh pick), but no
        # favourite of today's mix.
        old = [Play("rhcp1/9", NOW - 700 * DAY + i * 300) for i in range(50)]
        known, played = known_tracks(_resolved(old + two_tastes()), since=NOW - 180 * DAY)

        assert known["rhcp"]["rhcp1/9"] == 0
        assert "rhcp1/9" in played

    def test_known_and_fresh_tracks_alternate_artist_by_artist(self):
        plays = two_tastes()
        known, played = known_tracks(_resolved(plays))

        tracks = mix_tracks(["rhcp", "fnm", "primus"], known, played, facts, tracks_of, seed=1)

        # Each artist in turn; its most played track first.
        assert tracks[:3] == ["rhcp1/1", "fnm1/1", "primus1/1"]
        # Then the never played ones mix in.
        assert tracks[3] not in played
        # Three per album: RHCP's two albums, Faith No More's and Primus' one.
        assert len(tracks) == 12
        assert len(set(tracks)) == len(tracks)

    def test_a_mix_stops_at_its_length(self):
        known, played = known_tracks(_resolved(two_tastes()))

        # Unknown to `facts`, each track counts as an album of its own: no cap.
        def big(artist: str) -> list[str]:
            return [f"{artist}{a}/{n}" for a in range(20) for n in range(1, 11)]

        assert len(mix_tracks(["rhcp", "fnm", "primus"], known, played, facts, big, seed=1)) == MIX_LENGTH

    def test_at_most_three_per_album(self):
        known, played = known_tracks(_resolved(two_tastes()))

        tracks = mix_tracks(["fnm"], known, played, facts, tracks_of, seed=1)

        assert Counter(t.split("/")[0] for t in tracks) == {"fnm1": 3}

    def test_the_fresh_tracks_change_with_the_seed_the_known_do_not(self):
        known, played = known_tracks(_resolved(two_tastes()))

        monday = mix_tracks(["rhcp", "fnm", "primus"], known, played, facts, tracks_of, seed=1)
        tuesday = mix_tracks(["rhcp", "fnm", "primus"], known, played, facts, tracks_of, seed=2)

        assert monday[:3] == tuesday[:3]
        assert monday != tuesday


class TestBuild:
    def test_one_mix_per_group(self):
        mixes = build_mixes(two_tastes(), facts, tracks_of, NOW, day=1)

        assert [m.artists[0] for m in mixes] == ["rhcp", "miles"]
        assert [len(m.tracks) for m in mixes] == [12, 12]

    def test_none_below_the_history_threshold(self):
        assert build_mixes(two_tastes(weeks=2), facts, tracks_of, NOW, day=1) is None

    def test_a_group_without_enough_tracks_makes_no_mix(self):
        # Funk with an almost empty library: only the played tracks exist.
        def tiny(artist: str) -> list[str]:
            return [] if artist in ("rhcp", "fnm", "primus") else tracks_of(artist)

        mixes = build_mixes(two_tastes(), facts, tiny, NOW, day=1)

        # Funk has only its five played tracks left: under MIX_MIN_TRACKS.
        assert [m.artists[0] for m in mixes] == ["miles"]

    def test_there_are_as_many_playlist_ids_as_mixes_can_be(self):
        assert MIX_PLAYLIST_IDS == ("mix1", "mix2", "mix3", "mix4")


class TestPlaces:
    """A mix is served by its slot ("mix2"): it keeps the slot while its core does."""

    def test_a_mix_keeps_the_slot_its_core_had(self):
        jazz, funk = Mix(["miles"]), Mix(["rhcp"])

        assert place_mixes([funk, jazz], ["miles", "rhcp"]) == [jazz, funk, None, None]

    def test_a_group_that_dropped_out_leaves_its_slot_empty(self):
        # Yesterday: funk, jazz, metal. Today jazz is gone; metal stays "Mix 3".
        funk, metal = Mix(["rhcp"]), Mix(["tool"])

        assert place_mixes([funk, metal], ["rhcp", "miles", "tool"]) == [funk, None, metal, None]

    def test_new_mixes_fill_the_free_slots_in_order(self):
        funk, electro, jazz = Mix(["rhcp"]), Mix(["daft"]), Mix(["miles"])

        assert place_mixes([funk, electro, jazz], [None, "rhcp"]) == [electro, funk, jazz, None]

    def test_a_first_run_is_strongest_first(self):
        funk, jazz = Mix(["rhcp"]), Mix(["miles"])

        assert place_mixes([funk, jazz], []) == [funk, jazz, None, None]


def _resolved(plays):
    from aivinnet.lib.home.discover import _resolve

    return _resolve(plays, facts)
