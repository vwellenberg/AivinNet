"""
The rules behind the homepage rows "Continue listening", "Rediscover" and
"On this day" (`lib/home/homerows.py`).

The module imports no database or store code on purpose, so these run in the
fast lane without any `sys.modules` mocks.
"""

from dataclasses import dataclass

import pendulum
import pytest

from aivinnet.lib.home.homerows import (
    find_continue_listening,
    on_this_day_window,
    parse_playlist_id,
    rank_rediscover,
    rediscover_item,
)

ALBUM = "a1b2c3d4e5f60718"
OTHER_ALBUM = "0f1e2d3c4b5a6978"
DAY = 86400
NOW = 1_790_000_000


@dataclass
class Scrobble:
    """The TrackLog fields the rules read; `source` is parsed like TrackLog does."""

    trackhash: str
    timestamp: int
    source: str = ""

    @property
    def type(self):
        prefixes = {"al:": "album", "pl:": "playlist", "ar:": "artist", "fo:": "folder"}
        return next((t for p, t in prefixes.items() if self.source.startswith(p)), "track")

    @property
    def type_src(self):
        return self.source.split(":", 1)[1] if ":" in self.source else None


def album_tracks(albumhash: str, n: int) -> list[str]:
    return [f"{albumhash[:12]}t{i:03d}" for i in range(n)]


class TestContinueListening:
    def setup_method(self):
        self.lists = {
            ("album", ALBUM): album_tracks(ALBUM, 10),
            ("album", OTHER_ALBUM): album_tracks(OTHER_ALBUM, 8),
            ("playlist", "7"): ["f00dfeedf00dfeed", "0853280a12c4f9e1", "deadbeefdeadbeef"],
        }

    def resolve(self, srctype, src):
        return self.lists.get((srctype, src))

    def test_newest_unfinished_album(self):
        scrobbles = [Scrobble(self.lists[("album", ALBUM)][3], NOW, f"al:{ALBUM}")]

        assert find_continue_listening(scrobbles, self.resolve) == [
            {
                "type": "album",
                "hash": ALBUM,
                "trackhash": self.lists[("album", ALBUM)][3],
                "track_index": 3,
                "track_total": 10,
                "timestamp": NOW,
            }
        ]

    def test_finished_album_is_skipped_for_the_next_older_source(self):
        scrobbles = [
            Scrobble(self.lists[("album", ALBUM)][-1], NOW, f"al:{ALBUM}"),  # last track: done
            Scrobble(self.lists[("album", ALBUM)][2], NOW - 300, f"al:{ALBUM}"),  # older play, same album
            Scrobble(self.lists[("album", OTHER_ALBUM)][5], NOW - 3600, f"al:{OTHER_ALBUM}"),
        ]

        (item,) = find_continue_listening(scrobbles, self.resolve)

        # Not ALBUM at track 2: its NEWEST play says it is finished.
        assert item["hash"] == OTHER_ALBUM
        assert (item["track_index"], item["track_total"]) == (5, 8)

    def test_playlist(self):
        scrobbles = [
            Scrobble("aaaaaaaaaaaaaaaa", NOW, ""),  # played from search: not a source
            Scrobble("0853280a12c4f9e1", NOW - 60, "pl:7"),
        ]

        assert find_continue_listening(scrobbles, self.resolve) == [
            {
                "type": "playlist",
                "hash": "7",
                "trackhash": "0853280a12c4f9e1",
                "track_index": 1,
                "track_total": 3,
                "timestamp": NOW - 60,
            }
        ]

    def test_several_sources_newest_first_each_once_capped(self):
        # Wide screens show up to three cards side by side (2026-10-05).
        album, other = self.lists[("album", ALBUM)], self.lists[("album", OTHER_ALBUM)]
        scrobbles = [
            Scrobble(album[3], NOW, f"al:{ALBUM}"),
            Scrobble(album[2], NOW - 10, f"al:{ALBUM}"),  # same album again: not a second card
            Scrobble("0853280a12c4f9e1", NOW - 60, "pl:7"),
            Scrobble(other[5], NOW - 3600, f"al:{OTHER_ALBUM}"),
        ]

        items = find_continue_listening(scrobbles, self.resolve)
        assert [(i["type"], i["hash"]) for i in items] == [("album", ALBUM), ("playlist", "7"), ("album", OTHER_ALBUM)]
        assert items[0]["track_index"] == 3  # the NEWEST play of the album decides

        assert len(find_continue_listening(scrobbles, self.resolve, limit=2)) == 2

    def test_nothing_found(self):
        scrobbles = [
            Scrobble("aaaaaaaaaaaaaaaa", NOW, "ar:1122334455667788"),
            Scrobble("bbbbbbbbbbbbbbbb", NOW - 1, "fo:/music/x"),
            Scrobble("cccccccccccccccc", NOW - 2, "pl:recentlyadded"),  # built on the fly
            Scrobble("dddddddddddddddd", NOW - 3, "al:ffffffffffffffff"),  # album gone
            Scrobble("eeeeeeeeeeeeeeee", NOW - 4, f"al:{ALBUM}"),  # track no longer in it
        ]

        assert find_continue_listening(scrobbles, self.resolve) == []
        assert find_continue_listening([], self.resolve) == []

    def test_single_track_album_counts_as_finished(self):
        self.lists[("album", ALBUM)] = ["0853280a12c4f9e1"]

        assert find_continue_listening([Scrobble("0853280a12c4f9e1", NOW, f"al:{ALBUM}")], self.resolve) == []


class TestRediscover:
    @staticmethod
    def album_of(trackhash):
        return {"t1": ALBUM, "t2": ALBUM, "t3": OTHER_ALBUM}.get(trackhash)

    def test_played_often_but_not_lately(self):
        old = NOW - 200 * DAY
        scrobbles = [Scrobble("t1", old + i) for i in range(4)] + [Scrobble("t2", old - DAY)]

        assert rank_rediscover(scrobbles, self.album_of, NOW) == [(ALBUM, 5, old + 3)]

    def test_too_few_plays(self):
        scrobbles = [Scrobble("t1", NOW - 200 * DAY + i) for i in range(4)]

        assert rank_rediscover(scrobbles, self.album_of, NOW) == []

    def test_one_recent_play_disqualifies(self):
        scrobbles = [Scrobble("t1", NOW - 200 * DAY + i) for i in range(9)]
        scrobbles.append(Scrobble("t2", NOW - 59 * DAY))

        assert rank_rediscover(scrobbles, self.album_of, NOW) == []

    def test_sorted_by_playcount_and_capped(self):
        old = NOW - 100 * DAY
        scrobbles = [Scrobble("t1", old)] * 6 + [Scrobble("t3", old)] * 9 + [Scrobble("gone", old)] * 20

        ranked = rank_rediscover(scrobbles, self.album_of, NOW)
        assert [r[:2] for r in ranked] == [(OTHER_ALBUM, 9), (ALBUM, 6)]
        assert rank_rediscover(scrobbles, self.album_of, NOW, limit=1) == [(OTHER_ALBUM, 9, old)]

    def test_item_shape(self):
        ts = int(pendulum.datetime(2025, 3, 15, 12, tz=pendulum.local_timezone()).timestamp())

        assert rediscover_item(ALBUM, 12, ts) == {
            "type": "album",
            "hash": ALBUM,
            "help_text": "12 plays",
            "secondary_text": "last March 2025",
        }


class TestOnThisDay:
    def test_window_is_the_whole_local_day_a_year_ago(self):
        tz = pendulum.local_timezone()
        now = pendulum.datetime(2026, 10, 4, 9, 30, tz=tz)

        start, end, label = on_this_day_window(now)

        assert label == "4 October 2025"
        assert start == int(pendulum.datetime(2025, 10, 4, 0, 0, 0, tz=tz).timestamp())
        assert end == int(pendulum.datetime(2025, 10, 4, 23, 59, 59, tz=tz).timestamp())

    @pytest.mark.parametrize("hour", [0, 23])
    def test_same_day_at_either_end_of_today(self, hour):
        tz = pendulum.local_timezone()
        _, _, label = on_this_day_window(pendulum.datetime(2026, 1, 1, hour, tz=tz))

        assert label == "1 January 2025"

    def test_leap_day_falls_back_to_the_28th(self):
        _, _, label = on_this_day_window(pendulum.datetime(2028, 2, 29, 12, tz=pendulum.local_timezone()))

        assert label == "28 February 2027"


@pytest.mark.parametrize(
    ("src", "expected"),
    [
        ("7", 7),
        ("0", None),
        ("-3", None),
        ("abc", None),
        ("99999999999999999999", None),  # past SQLite's 64-bit INTEGER
        (str(2**63 - 1), 2**63 - 1),
    ],
)
def test_a_playlist_id_from_a_scrobble_source(src, expected):
    """Shared by "Recently played" and "Continue listening" (#391)."""
    assert parse_playlist_id(src) == expected
