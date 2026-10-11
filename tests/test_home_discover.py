"""
The rules behind the homepage rows "Because you listened to …", "On repeat",
"Never played", "Your weekday evenings", "Artists you might like" and
"Forgotten favorites" (`lib/home/discover.py`, #138).

The module imports no database or store code on purpose, so these run in the
fast lane without any `sys.modules` mocks.
"""

from dataclasses import dataclass

import pendulum
import pytest

from aivinnet.lib.home.discover import (
    AlbumFacts,
    TrackFacts,
    because_item,
    day_playlist,
    day_summary,
    forgotten_favorite_item,
    is_burst,
    never_played_chips,
    never_played_item,
    on_repeat_item,
    on_this_day_item,
    pick_seed_artist,
    playlist_neighbour_item,
    rank_because,
    rank_for_this_time,
    rank_forgotten_favorites,
    rank_never_played,
    rank_on_repeat,
    rank_on_this_day,
    rank_playlist_neighbours,
    slot_title,
    strongest_phase,
    time_slot,
)

DAY = 86400
HOUR = 3600
NOW = 1_790_000_000


@dataclass
class Play:
    trackhash: str
    timestamp: int


class Library:
    """
    Tracks named "<album>/<n>"; each album has one album artist and one genre,
    given when the album is added. "<album>/<n>/<artist>" gives the track its
    own artist (a compilation); otherwise it is the album artist.
    """

    def __init__(self):
        self.albums: dict[str, tuple[str, str]] = {}

    def add(self, album: str, artist: str, genre: str = "rock"):
        self.albums[album] = (artist, genre)
        return self

    def facts(self, trackhash: str) -> TrackFacts | None:
        parts = trackhash.split("/")
        album = parts[0]
        if album not in self.albums:
            return None

        artist, genre = self.albums[album]
        track_artist = parts[2] if len(parts) > 2 else artist
        return TrackFacts(albumhash=album, artists=(artist,), genres=(genre,), track_artists=(track_artist,))

    def album_facts(self) -> list[AlbumFacts]:
        return [AlbumFacts(a, (artist,), (genre,)) for a, (artist, genre) in self.albums.items()]


def session(start: int, *trackhashes: str, spacing: int = 4 * 60) -> list[Play]:
    """Plays back to back, starting at `start`."""
    return [Play(t, start + i * spacing) for i, t in enumerate(trackhashes)]


class TestSeed:
    def setup_method(self):
        self.lib = Library().add("rhcp1", "rhcp").add("fnm1", "fnm").add("va1", "various")

    def test_most_played_artist_this_week(self):
        plays = session(NOW - 2 * DAY, "rhcp1/1", "rhcp1/2", "fnm1/1") + session(NOW - DAY, "rhcp1/3")

        assert pick_seed_artist(plays, self.lib.facts, NOW) == "rhcp"

    def test_falls_back_to_the_month_when_the_week_is_empty(self):
        plays = session(NOW - 20 * DAY, "fnm1/1", "fnm1/2")

        assert pick_seed_artist(plays, self.lib.facts, NOW) == "fnm"

    def test_nothing_in_the_last_month(self):
        assert pick_seed_artist(session(NOW - 40 * DAY, "fnm1/1"), self.lib.facts, NOW) is None

    def test_placeholder_artists_are_never_the_seed(self):
        plays = session(NOW - DAY, "va1/1", "va1/2", "va1/3", "fnm1/1")

        assert pick_seed_artist(plays, self.lib.facts, NOW, skip=lambda a: a == "various") == "fnm"

    def test_tracks_gone_from_the_library_do_not_count(self):
        plays = session(NOW - DAY, "gone/1", "gone/2", "fnm1/1")

        assert pick_seed_artist(plays, self.lib.facts, NOW) == "fnm"


class TestBecause:
    def setup_method(self):
        self.lib = (
            Library()
            .add("rhcp1", "rhcp")
            .add("rhcp2", "rhcp")
            .add("fnm1", "fnm")
            .add("fnm2", "fnm")
            .add("primus1", "primus")
            .add("jazz1", "miles")
        )

    def rank(self, plays, **kw):
        return rank_because(plays, self.lib.facts, "rhcp", NOW, **kw)

    def test_albums_played_in_the_same_sessions(self):
        plays = (
            session(NOW - 30 * DAY, "rhcp1/1", "fnm1/1", "primus1/1")
            + session(NOW - 20 * DAY, "rhcp2/1", "fnm1/2")
            + session(NOW - 10 * DAY, "primus1/2", "rhcp1/2")
            + session(NOW - 9 * DAY, "jazz1/1")  # never with the seed
        )

        ranked = self.rank(plays)

        # Equal scores (1/sqrt(2) + 1 each): the album played last goes first.
        assert [r[0] for r in ranked] == ["primus1", "fnm1"]
        assert ranked[1][1] == 2
        assert ranked[1][2] == NOW - 20 * DAY + 4 * 60

    def test_one_shared_session_is_not_enough(self):
        plays = session(NOW - 30 * DAY, "rhcp1/1", "fnm1/1")

        assert self.rank(plays) == []

    def test_a_pause_longer_than_half_an_hour_ends_the_session(self):
        plays = []
        for days in (30, 20):
            plays += [Play("rhcp1/1", NOW - days * DAY), Play("fnm1/1", NOW - days * DAY + 31 * 60)]

        assert self.rank(plays) == []

    def test_a_small_session_counts_more_than_a_big_shuffle(self):
        big_shuffle = [f"filler{i}/1" for i in range(40)]
        for i in range(40):
            self.lib.add(f"filler{i}", f"filler-artist{i}")

        plays = (
            session(NOW - 40 * DAY, "rhcp1/1", "primus1/1", *big_shuffle)
            + session(NOW - 39 * DAY, "rhcp1/1", "primus1/1", *big_shuffle)
            + session(NOW - 30 * DAY, "rhcp1/1", "fnm1/1")
            + session(NOW - 20 * DAY, "rhcp1/2", "fnm1/2")
        )

        assert self.rank(plays)[0][0] == "fnm1"

    def test_albums_played_this_week_are_left_out(self):
        plays = (
            session(NOW - 30 * DAY, "rhcp1/1", "fnm1/1", "primus1/1")
            + session(NOW - 20 * DAY, "rhcp1/1", "primus1/1")
            + session(NOW - 2 * DAY, "rhcp1/2", "fnm1/2")
        )

        assert [r[0] for r in self.rank(plays)] == ["primus1"]

    def test_one_album_per_artist(self):
        plays = (
            session(NOW - 30 * DAY, "rhcp1/1", "fnm1/1", "fnm2/1")
            + session(NOW - 20 * DAY, "rhcp1/1", "fnm1/1", "fnm2/1")
            + session(NOW - 15 * DAY, "rhcp1/1", "fnm1/1")
        )

        assert [r[0] for r in self.rank(plays)] == ["fnm1"]

    def test_untagged_albums_are_not_recommended(self):
        self.lib.add("untagged", "unknown")
        plays = session(NOW - 30 * DAY, "rhcp1/1", "untagged/1", "fnm1/1") + session(
            NOW - 20 * DAY, "rhcp1/1", "untagged/2", "fnm1/2"
        )

        ranked = rank_because(plays, self.lib.facts, "rhcp", NOW, exclude=lambda a: a == "unknown")

        assert [r[0] for r in ranked] == ["fnm1"]

    def test_the_seeds_own_albums_are_not_recommended(self):
        plays = session(NOW - 30 * DAY, "rhcp1/1", "rhcp2/1") + session(NOW - 20 * DAY, "rhcp1/1", "rhcp2/1")

        assert self.rank(plays) == []

    def test_item(self):
        item = because_item("fnm1", 9, NOW - 30 * DAY)

        assert item["type"] == "album"
        assert item["hash"] == "fnm1"
        assert item["help_text"] == "9 sessions together"
        assert item["secondary_text"].startswith("last ")


class TestOnRepeat:
    def setup_method(self):
        self.lib = Library().add("a", "x").add("b", "y")

    def rank(self, plays, **kw):
        return rank_on_repeat(plays, self.lib.facts, NOW, **kw)

    def test_much_more_this_week_than_before(self):
        plays = [Play("a/1", NOW - d * HOUR) for d in range(1, 8)]  # 7 this week
        plays += [Play("a/1", NOW - w * 7 * DAY - DAY) for w in range(1, 9)]  # 1 a week before

        # One play in each of the 8 weeks before, oldest first, then this week.
        assert self.rank(plays) == [("a/1", 7, 1.0, [1, 1, 1, 1, 1, 1, 1, 1, 7])]

    def test_as_often_as_usual_is_not_on_repeat(self):
        plays = [Play("a/1", NOW - d * HOUR) for d in range(1, 5)]  # 4 this week
        plays += [Play("a/1", NOW - w * 7 * DAY - h * HOUR) for w in range(1, 9) for h in range(1, 4)]  # 3 a week

        assert self.rank(plays) == []

    def test_a_new_track_needs_three_plays(self):
        assert self.rank([Play("a/1", NOW - HOUR), Play("a/1", NOW - 2 * HOUR)]) == []
        assert self.rank([Play("a/1", NOW - h * HOUR) for h in (1, 2, 3)]) == [("a/1", 3, 0.0, [0] * 8 + [3])]

    def test_the_weeks_put_each_play_in_its_week(self):
        plays = [Play("a/1", NOW - h * HOUR) for h in range(1, 6)]
        plays += [Play("a/1", NOW - 8 * DAY), Play("a/1", NOW - 9 * DAY)]  # the week before this one
        plays += [Play("a/1", NOW - 62 * DAY)]  # the oldest week

        assert self.rank(plays)[0][3] == [1, 0, 0, 0, 0, 0, 0, 2, 5]

    def test_ranked_by_plays_above_the_average(self):
        plays = [Play("a/1", NOW - h * HOUR) for h in range(1, 11)]  # 10, usually 6
        plays += [Play("a/1", NOW - w * 7 * DAY - h * HOUR) for w in range(1, 9) for h in range(1, 7)]
        plays += [Play("b/1", NOW - h * HOUR) for h in range(1, 6)]  # 5, new

        assert [r[0] for r in self.rank(plays, min_factor=1.5)] == ["b/1", "a/1"]

    def test_at_most_two_tracks_per_album(self):
        plays = [Play(f"a/{n}", NOW - h * HOUR - n) for n in range(1, 6) for h in range(1, 4)]

        assert len(self.rank(plays)) == 2

    def test_items(self):
        weeks = [0] * 8 + [7]
        assert on_repeat_item("a/1", 7, 0.0, weeks) == {
            "type": "track",
            "hash": "a/1",
            "help_text": "7 plays this week",
            # Not "new": only the baseline weeks were read.
            "secondary_text": "not in the 8 weeks before",
            # No average to compare with, so no factor.
            "home": {"weeks": weeks, "factor": None},
        }
        assert on_repeat_item("a/1", 7, 0.5, weeks)["secondary_text"] == "rarely before"
        assert on_repeat_item("a/1", 7, 2.4, weeks)["secondary_text"] == "usually 2 a week"
        assert on_repeat_item("a/1", 7, 1.0, weeks)["home"]["factor"] == 7
        # Fewer than one play a week before: "28x usual" would be arithmetic,
        # not news — and the text already says "rarely before".
        assert on_repeat_item("a/1", 7, 0.25, weeks)["home"]["factor"] is None
        assert on_repeat_item("a/1", 7, 0.5, weeks)["home"]["factor"] is None


class TestNeverPlayed:
    def setup_method(self):
        self.lib = (
            Library()
            .add("played", "primus", "funk")
            .add("primus2", "primus", "funk")
            .add("primus3", "primus", "funk")
            .add("primus4", "primus", "funk")
            .add("funky", "other", "funk")
            .add("jazz", "miles", "jazz")
        )
        self.history = [Play("played/1", NOW - i * HOUR) for i in range(60)]

    def rank(self, plays=None, **kw):
        plays = self.history if plays is None else plays
        return rank_never_played(plays, self.lib.facts, self.lib.album_facts(), day=1, **kw)

    def test_unplayed_albums_nearest_to_the_taste_first(self):
        ranked = self.rank(max_per_artist=5)

        assert [r[0] for r in ranked][:3] == sorted(["primus2", "primus3", "primus4"], reverse=True)
        assert ranked[3] == ("funky", None, "funk")
        assert ranked[4] == ("jazz", None, None)
        assert "played" not in [r[0] for r in ranked]

    def test_the_artist_is_the_reason_when_the_user_plays_them(self):
        assert self.rank()[0][1:] == ("primus", "funk")

    def test_at_most_two_per_artist(self):
        ranked = self.rank()

        assert sum(1 for r in ranked if r[0].startswith("primus")) == 2

    def test_a_play_counts_for_every_edition_sharing_the_track(self):
        facts = self.lib.facts

        def with_edition(trackhash):
            f = facts(trackhash)
            if f and f.albumhash == "played":
                return TrackFacts(f.albumhash, f.artists, f.genres, other_albums=("primus2",))
            return f

        ranked = rank_never_played(self.history, with_edition, self.lib.album_facts(), day=1, max_per_artist=5)

        assert "primus2" not in [r[0] for r in ranked]

    def test_chips_are_the_most_played_genres_with_their_albums(self):
        self.lib.add("jazz2", "miles", "jazz").add("jazz3", "coltrane", "jazz")
        plays = self.history + [Play("jazz1/1", NOW - i) for i in range(5)]
        self.lib.add("jazz1", "miles", "jazz")

        chips = never_played_chips(plays, self.lib.facts, self.lib.album_facts(), max_per_artist=5)

        # funk is played most; jazz next — and only genres with two albums.
        assert [genre for genre, _ in chips] == ["funk", "jazz"]
        # jazz1 was played, so not in it.
        assert {a for a, _, _ in chips[1][1]} == {"jazz", "jazz2", "jazz3"}
        assert all(g == "jazz" for _, _, g in chips[1][1])

    def test_a_genre_with_one_unplayed_album_gets_no_chip(self):
        chips = never_played_chips(self.history, self.lib.facts, self.lib.album_facts())

        # funk: primus2-4 (two allowed per artist) and funky; jazz: one album only.
        assert [genre for genre, _ in chips] == ["funk"]

    def test_no_chips_below_the_history_threshold(self):
        assert never_played_chips(self.history[:10], self.lib.facts, self.lib.album_facts()) == []

    def test_too_short_a_history_is_none_not_empty(self):
        assert self.rank(self.history[:10]) is None

    def test_everything_played_is_empty(self):
        plays = self.history + [Play(f"{a}/1", NOW) for a in self.lib.albums]

        assert self.rank(plays) == []

    def test_drawn_from_a_pool_the_same_way_all_day(self):
        for i in range(30):
            self.lib.add(f"x{i}", f"artist{i}", "noise")

        def draw(day):
            return rank_never_played(self.history, self.lib.facts, self.lib.album_facts(), day=day, limit=5)

        assert draw(7) == draw(7)
        assert len(draw(7)) == 5
        assert any(draw(d) != draw(7) for d in range(8, 20))

    def test_items(self):
        assert never_played_item("x", "you play Primus") == {
            "type": "album",
            "hash": "x",
            "help_text": "you play Primus",
            "secondary_text": "never played",
        }
        assert never_played_item("x", None) == {"type": "album", "hash": "x", "help_text": "never played"}


def at(dt: pendulum.DateTime, *trackhashes: str) -> list[Play]:
    return [Play(t, int(dt.timestamp()) + i * 240) for i, t in enumerate(trackhashes)]


class TestTimeSlot:
    @pytest.mark.parametrize(
        "when, slot",
        [
            (pendulum.datetime(2026, 10, 7, 4, 59), (False, "nights")),  # Wednesday
            (pendulum.datetime(2026, 10, 7, 5, 0), (False, "mornings")),
            (pendulum.datetime(2026, 10, 7, 16, 59), (False, "afternoons")),
            (pendulum.datetime(2026, 10, 7, 20, 0), (False, "evenings")),
            (pendulum.datetime(2026, 10, 7, 23, 0), (False, "nights")),
            # After midnight it is still the night before: Saturday 01:00 is
            # Friday night, Monday 01:00 is Sunday night.
            (pendulum.datetime(2026, 10, 10, 1, 0), (False, "nights")),
            (pendulum.datetime(2026, 10, 10, 23, 0), (True, "nights")),
            (pendulum.datetime(2026, 10, 12, 1, 0), (True, "nights")),
            (pendulum.datetime(2026, 10, 11, 10, 0), (True, "mornings")),  # Sunday
        ],
    )
    def test_slots(self, when, slot):
        assert time_slot(when) == slot

    def test_title(self):
        assert slot_title((False, "evenings")) == "Your weekday evenings"
        assert slot_title((True, "mornings")) == "Your weekend mornings"


class TestForThisTime:
    def setup_method(self):
        self.lib = Library().add("eve", "a").add("all", "b").add("morning", "c")
        self.now = pendulum.datetime(2026, 10, 7, 20, 30)  # a Wednesday evening

    def rank(self, plays, now=None, **kw):
        return rank_for_this_time(plays, self.lib.facts, now or self.now, **kw)

    def weeks_back(self, hour, *trackhashes, weeks=range(1, 5), now=None):
        now = now or self.now
        plays = []
        for w in weeks:
            plays += at(now.subtract(weeks=w).replace(hour=hour, minute=0), *trackhashes)
        return plays

    def test_an_album_played_at_this_time_more_than_at_others(self):
        plays = self.weeks_back(20, "eve/1") + self.weeks_back(20, "all/1") + self.weeks_back(8, "all/1", "morning/1")

        assert self.rank(plays) == [("eve", 4)]

    def test_the_weekend_is_another_slot(self):
        saturday = self.now.next(pendulum.SATURDAY).replace(hour=20)
        plays = self.weeks_back(20, "eve/1", now=saturday) + self.weeks_back(8, "all/1")

        assert self.rank(plays) == []

    def test_not_what_was_played_in_the_last_day(self):
        plays = self.weeks_back(20, "eve/1") + self.weeks_back(8, "all/1") + at(self.now.subtract(hours=2), "eve/2")

        assert self.rank(plays) == []

    def test_the_slot_is_read_in_the_servers_timezone(self):
        berlin = pendulum.datetime(2026, 10, 7, 20, 30, tz="Europe/Berlin")
        # 18:00 UTC is 20:00 in Berlin (summer time): the evening there.
        plays = self.weeks_back(18, "eve/1") + self.weeks_back(6, "all/1")

        assert self.rank(plays, now=berlin) == [("eve", 4)]

    def test_too_few_plays(self):
        plays = self.weeks_back(20, "eve/1", weeks=range(1, 3)) + self.weeks_back(8, "all/1")

        assert self.rank(plays) == []

    def test_untagged_albums_are_left_out(self):
        self.lib.add("untagged", "unknown")
        plays = self.weeks_back(20, "untagged/1") + self.weeks_back(8, "all/1")

        assert self.rank(plays, exclude=lambda a: a == "unknown") == []

    def test_compilations_do_not_share_one_artist_cap(self):
        for i in range(3):
            self.lib.add(f"va{i}", "various")
        plays = self.weeks_back(20, "va0/1", "va1/1", "va2/1") + self.weeks_back(8, "all/1", "all/2", "all/3")

        assert len(self.rank(plays)) == 2
        assert len(self.rank(plays, uncapped=lambda a: a == "various")) == 3


class TestPlaylistNeighbours:
    def setup_method(self):
        self.lib = (
            Library()
            .add("rhcp1", "rhcp")
            .add("primus1", "primus")
            .add("fnm1", "fnm")
            .add("jazz1", "miles")
            .add("va1", "various")
        )
        # RHCP is the user's top artist; Faith No More is well known to them.
        self.plays = [Play("rhcp1/1", NOW - i * HOUR) for i in range(1, 20)]
        self.plays += [Play("fnm1/1", NOW - 200 * DAY - i) for i in range(10)]

    def rank(self, playlists, plays=None, **kw):
        plays = self.plays if plays is None else plays
        return rank_playlist_neighbours(plays, self.lib.facts, playlists, NOW, skip=lambda a: a == "various", **kw)

    def test_a_rarely_played_artist_next_to_a_favourite(self):
        ranked = self.rank([["rhcp1/1", "primus1/1", "fnm1/1"]])

        assert ranked == [("primus", 1, 0)]

    def test_a_playlist_without_a_favourite_says_nothing(self):
        assert self.rank([["primus1/1", "jazz1/1"]]) == []

    def test_a_small_playlist_counts_more_than_an_everything_list(self):
        everything = ["rhcp1/1", "jazz1/1"] + [f"x{i}/1" for i in range(50)]
        for i in range(50):
            self.lib.add(f"x{i}", f"artist{i}")

        ranked = self.rank([everything, ["rhcp1/1", "primus1/1"]])

        assert ranked[0][0] == "primus"

    def test_a_compilation_brings_its_track_artists(self):
        ranked = self.rank([["rhcp1/1", "va1/1/sigur"]])

        assert ranked == [("sigur", 1, 0)]

    def test_a_skipped_artist_leaves_its_place_to_the_next(self):
        ranked = rank_playlist_neighbours(
            self.plays,
            self.lib.facts,
            [["rhcp1/1", "primus1/1", "jazz1/1"]],
            NOW,
            skip=lambda a: a in ("various", "primus"),
            limit=1,
        )

        assert ranked == [("miles", 1, 0)]

    def test_no_recent_plays_no_favourites(self):
        old = [Play("rhcp1/1", NOW - 200 * DAY)]

        assert self.rank([["rhcp1/1", "primus1/1"]], plays=old) == []

    def test_item(self):
        assert playlist_neighbour_item("primus", 1, 0) == {
            "type": "artist",
            "hash": "primus",
            "help_text": "in one of your playlists",
            "secondary_text": "never played",
        }
        assert playlist_neighbour_item("primus", 3, 1)["help_text"] == "in 3 of your playlists"
        assert playlist_neighbour_item("primus", 3, 1)["secondary_text"] == "1 play"


class TestForgottenFavorites:
    def setup_method(self):
        self.lib = Library().add("a", "x").add("b", "y")

    def rank(self, favorites, plays, **kw):
        return rank_forgotten_favorites(favorites, plays, self.lib.facts, NOW, **kw)

    def test_favourites_quiet_for_two_months(self):
        plays = [Play("a/1", NOW - (100 + i) * DAY) for i in range(10)]
        plays += [Play("a/2", NOW - DAY)]

        ranked = self.rank(["a/1", "a/2", "b/1"], plays)

        assert [r[:3] for r in ranked] == [("a/1", 10, NOW - 100 * DAY), ("b/1", 0, None)]

    def test_a_burst_goes_first_though_it_has_fewer_plays_in_total(self):
        # 12 plays in two days, 80 days ago, and then nothing: a real phase.
        burst = [Play("a/1", NOW - 80 * DAY + i * 3600) for i in range(12)]
        # 30 plays, one a day for a month, 100 days ago: more in total, no phase.
        steady = [Play("b/1", NOW - (100 + i) * DAY) for i in range(30)]

        ranked = self.rank(["b/1", "a/1"], burst + steady)

        assert [r[0] for r in ranked] == ["a/1", "b/1"]
        assert ranked[0][3][0] == 12

    def test_strongest_phase_is_the_densest_window(self):
        assert strongest_phase([0, DAY, 2 * DAY, 10 * DAY]) == (3, 0)
        assert strongest_phase([]) == (0, None)

    def test_a_burst_needs_ten_plays_and_a_real_share(self):
        assert is_burst(12, 12)
        assert not is_burst(9, 9)  # too few plays
        assert not is_burst(12, 48)  # a spike of a quarter of the history

    def test_a_burst_shows_its_phase_in_the_caption(self):
        # The card draws help_text only, so the phase has to be there.
        item = forgotten_favorite_item("a/1", 48, NOW - 100 * DAY, (32, NOW - 400 * DAY))

        assert item["help_text"].startswith("32 plays in 3 days · ")
        assert item["secondary_text"] == "48 plays"

    def test_no_burst_keeps_the_last_played_caption(self):
        item = forgotten_favorite_item("a/1", 100, NOW - 100 * DAY, (12, NOW - 400 * DAY))

        assert item["help_text"].startswith("last ")
        assert item["secondary_text"] == "100 plays"

    def test_the_one_silent_longest_first_among_equals(self):
        plays = [Play("a/1", NOW - 100 * DAY), Play("b/1", NOW - 300 * DAY)]

        assert [r[0] for r in self.rank(["a/1", "b/1"], plays)] == ["b/1", "a/1"]

    def test_at_most_two_per_album(self):
        assert len(self.rank(["a/1", "a/2", "a/3"], [])) == 2

    def test_a_favourite_gone_from_the_library_is_skipped(self):
        assert self.rank(["gone/1"], []) == []

    def test_items(self):
        assert forgotten_favorite_item("a/1", 0, None) == {
            "type": "track",
            "hash": "a/1",
            "help_text": "not played yet",
        }
        item = forgotten_favorite_item("a/1", 10, NOW - 100 * DAY)
        assert item["help_text"].startswith("last ")
        assert item["secondary_text"] == "10 plays"


@dataclass
class TimedPlay:
    trackhash: str
    timestamp: int
    duration: int = 180


class TestOnThisDay:
    def setup_method(self):
        self.lib = Library().add("dream", "dreamcorp").add("syx", "jasinka").add("cnc", "klepacki")

    def test_the_albums_of_the_day_not_where_they_were_started(self):
        # One playlist session: three albums, not one playlist card.
        day = [Play("dream/1", 1), Play("syx/1", 2), Play("dream/2", 3), Play("cnc/1", 4), Play("dream/3", 5)]

        assert rank_on_this_day([(2025, day)], self.lib.facts) == [
            ("dream", 2025, 3),
            ("cnc", 2025, 1),
            ("syx", 2025, 1),
        ]

    def test_earlier_years_follow_and_an_album_shows_once(self):
        last_year = [Play("dream/1", 1)]
        two_years = [Play("dream/2", 1), Play("dream/3", 2), Play("syx/1", 3)]

        ranked = rank_on_this_day([(2025, last_year), (2024, two_years)], self.lib.facts)

        assert ranked == [("dream", 2025, 1), ("syx", 2024, 1)]

    def test_tracks_gone_from_the_library_are_left_out(self):
        assert rank_on_this_day([(2025, [Play("gone/1", 1)])], self.lib.facts) == []

    def test_capped(self):
        day = [Play(a + "/1", i) for i, a in enumerate(("dream", "syx", "cnc"))]

        assert len(rank_on_this_day([(2025, day)], self.lib.facts, limit=2)) == 2

    def test_item(self):
        assert on_this_day_item("dream", 2024, 1) == {"type": "album", "hash": "dream", "help_text": "2024 · 1 play"}

    def test_summary(self):
        evening = int(pendulum.datetime(2025, 10, 8, 20, 0).timestamp())
        day = [TimedPlay("dream/1", evening + i * 240, 240) for i in range(40)]
        day.append(TimedPlay("syx/1", evening - 12 * 3600, 240))  # one morning play

        summary = day_summary(day, self.lib.facts, {"dreamcorp": "Dream.Corp"}.get, pendulum.timezone("UTC"))

        assert summary == "2 h 44 min · mostly Dream.Corp · in the evening"

    def test_summary_skips_an_artist_without_a_name_and_short_days(self):
        noon = int(pendulum.datetime(2025, 10, 8, 12, 0).timestamp())
        day = [TimedPlay("dream/1", noon, 30)]

        assert day_summary(day, self.lib.facts, lambda a: None, pendulum.timezone("UTC")) == "1 min · in the afternoon"

    def test_no_summary_without_plays(self):
        assert day_summary([], self.lib.facts, lambda a: None, pendulum.timezone("UTC")) is None

    def test_the_day_as_a_playlist_in_the_order_heard(self):
        day = [Play("syx/1", 3), Play("dream/1", 1), Play("syx/1", 2), Play("gone/1", 4)]

        assert day_playlist(day, self.lib.facts) == ["dream/1", "syx/1"]
