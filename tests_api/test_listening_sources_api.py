"""
"How you listened" on the stats page (#538): the share of the period's plays
by what they were started from. Real request cycle, real scrobbles with the
sources the client stores (`stores/tracker.ts`), on the library of
`test_home_discover_api`.
"""

import pendulum
import pytest
from test_home_discover_api import MILES, PRIMUS, home, th  # noqa: F401

DAY = 86400


@pytest.fixture()
def stats(home, api_client, monkeypatch):  # noqa: F811 - the imported fixture
    import aivinnet.api.scrobble as scrobble_api

    api = api_client("aivinnet.api.scrobble")
    monkeypatch.setattr(scrobble_api, "get_current_userid", lambda: api.userid)
    return api


def this_week() -> int:
    """A moment inside this week, also in the first minutes of a Monday."""
    now = int(pendulum.now().timestamp())
    since = now - int(pendulum.now().start_of("week").timestamp())
    return now - min(3600, since // 2)


def play(source: str, n: int = 1, ago: int | None = None, userid: int = 1, trackhash: str | None = None):
    from aivinnet.db.userdata import ScrobbleTable

    at = this_week() if ago is None else int(pendulum.now().timestamp()) - ago
    for i in range(n):
        ScrobbleTable.add(
            {
                "trackhash": trackhash or th(PRIMUS, 1 + i % 5),
                "timestamp": at - i,
                "duration": 200,
                "source": source,
                "userid": userid,
            }
        )


def tile(api, period="week"):
    res = api.get(f"/logger/stats?period={period}")
    assert res.status_code == 200, res.text
    return next(t for t in res.get_json()["stats"] if t["cssclass"] == "sources")


def test_the_largest_kind_on_the_tile_the_two_largest_in_its_tooltip(stats):
    play(f"al:{PRIMUS}", 5)
    play(f"al:{MILES}", 1)
    play("pl:7", 2)
    play("q:primus", 1)
    play("", 1)  # a single track: no kind, but a play

    shown = tile(stats)

    # The tile has two lines for its value, and "60% albums" fills them: the
    # second share was cut off as "60% albums · …".
    assert shown["value"] == "60% albums"
    assert shown["detail"] == "60% albums · 20% playlists"
    assert shown["text"] == "this week"


def test_a_generated_playlist_is_home(stats):
    play("pl:onrepeat", 3)
    play("pl:mix1", 2)
    play("pl:7", 1)

    assert tile(stats)["value"] == "83% Home"
    assert tile(stats)["detail"] == "83% Home · 17% playlists"


def test_only_the_period_counts(stats):
    play("pl:7", 4, ago=40 * DAY)
    play(f"al:{PRIMUS}", 1)

    assert tile(stats)["value"] == "100% albums"
    # Nothing beyond the value: no tooltip that repeats it.
    assert tile(stats)["detail"] is None
    assert tile(stats, "alltime")["value"] == "80% playlists"
    assert tile(stats, "alltime")["detail"] == "80% playlists · 20% albums"
    assert tile(stats, "alltime")["text"] == "all time"


def test_each_user_on_their_own(stats):
    play("pl:7", 3, userid=2)

    assert tile(stats)["value"] == "—"
    assert tile(stats)["detail"] is None
    stats.userid = 2
    assert tile(stats)["value"] == "100% playlists"


def test_a_play_of_a_track_gone_from_the_library_still_says_how_it_was_started(stats):
    # Like the plays tile: every play counts.
    play(f"al:{PRIMUS}", 1, trackhash="0" * 16)

    assert tile(stats)["value"] == "100% albums"
