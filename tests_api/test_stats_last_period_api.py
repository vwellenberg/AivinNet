"""The previous-period stats: `period=lastweek` and `period=lastmonth`.

The recap card on Home opens these on Mondays and the 1st (the card tells
about the period before). A play inside the previous period must count there,
and a play in the current period must not. Real request cycle and real
`ScrobbleTable` rows; the library is stubbed like test_stats_period.py.

Times are built relative to the real clock, so the test holds on any day:
the previous week is "Thursday before this Monday", the previous month is
"ten days before this month's first day".
"""

import time
from types import SimpleNamespace

import pendulum
import pytest

HASH = "0853280a12c4f9e1"
ALBUM = "a1b2c3d4e5f60718"


def make_track():
    return SimpleNamespace(
        trackhash=HASH,
        title="Blue",
        artists=[{"name": "The Artist"}],
        image=f"{ALBUM}.webp?pathhash=0a1b2c3d4e5f6071&fb=track",
        playduration=0,
        playcount=0,
    )


@pytest.fixture()
def api(api_client, monkeypatch):
    import aivinnet.api.scrobble as scrobble_api
    import aivinnet.utils.stats as stats

    track = make_track()
    monkeypatch.setattr(
        stats.TrackStore,
        "get_tracks_by_trackhashes",
        staticmethod(lambda hashes: [track] if HASH in hashes else []),
        raising=False,
    )
    monkeypatch.setattr(scrobble_api.TrackStore, "get_flat_list", staticmethod(lambda: [track]), raising=False)
    client = api_client("aivinnet.api.scrobble")
    monkeypatch.setattr(scrobble_api, "get_current_userid", lambda: client.userid)
    # Ids restart after the between-tests wipe: a cache from another test could
    # match this one's marker.
    monkeypatch.setattr(scrobble_api, "_clocks", {})
    return client


def scrobble(timestamp: int, duration: int, userid: int = 1):
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.add(
        {
            "trackhash": HASH,
            "timestamp": timestamp,
            "duration": duration,
            "source": f"al:{ALBUM}",
            "userid": userid,
        }
    )


def now_play() -> int:
    return int(time.time())


def last_month_play() -> int:
    # Ten days before this month's first day: always in the month before.
    return int(pendulum.now().start_of("month").subtract(days=10).timestamp())


def last_week_play() -> int:
    # Thursday of the week before this Monday.
    return int(pendulum.now().start_of("week").subtract(days=4).timestamp())


def tiles(api, period: str):
    res = api.get(f"/logger/stats?period={period}")
    assert res.status_code == 200, res.json
    return {item["cssclass"]: item for item in res.json["stats"]}


def clock(api, period: str):
    res = api.get(f"/logger/clock?period={period}")
    assert res.status_code == 200, res.json
    return res.json


def test_last_month_counts_last_months_play_and_not_this_months(api):
    scrobble(last_month_play(), 200)
    scrobble(now_play(), 100)

    shown = tiles(api, "lastmonth")

    assert shown["streams"]["value"] == "1 track play"
    assert shown["streams"]["text"] == "last month"
    assert shown["playtime"]["text"] == "listened last month"
    assert shown["toptrack"]["text"] == "Top track last month"


def test_last_week_counts_last_weeks_play_and_not_this_weeks(api):
    scrobble(last_week_play(), 200)
    scrobble(now_play(), 100)

    shown = tiles(api, "lastweek")

    assert shown["streams"]["value"] == "1 track play"
    assert shown["streams"]["text"] == "last week"


def test_the_clock_follows_last_month(api):
    scrobble(last_month_play(), 200)
    scrobble(now_play(), 100)

    body = clock(api, "lastmonth")

    assert body["total"] == 200


def test_the_clock_follows_last_week(api):
    scrobble(last_week_play(), 200)
    scrobble(now_play(), 100)

    assert clock(api, "lastweek")["total"] == 200


def test_an_unknown_period_is_still_rejected(api):
    assert api.get("/logger/stats?period=lastday").status_code == 422
