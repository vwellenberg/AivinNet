"""`GET /logger/clock` — the listening clock on the stats page (#535).

Real request cycle and real `ScrobbleTable` rows: weekday and hour come from
SQLite's `strftime(..., 'localtime')`, so that is the part a fast-lane test
cannot see. Times are built as naive `datetime`s, which are the C library's
zone, the one SQLite's `localtime` uses.
"""

from datetime import datetime

import pytest

MON, WED, THU, SUN = 0, 2, 3, 6


@pytest.fixture()
def clock_api(api_client, monkeypatch):
    import aivinnet.api.scrobble as scrobble_api

    api = api_client("aivinnet.api.scrobble")
    monkeypatch.setattr(scrobble_api, "get_current_userid", lambda: api.userid)
    # Ids restart after the between-tests wipe: a cache from another test
    # could match this one's marker.
    monkeypatch.setattr(scrobble_api, "_clocks", {})
    return api


def scrobble(when: datetime, duration: int, userid: int = 1):
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.add(
        {
            "trackhash": "0853280a12c4f9e1",
            "timestamp": int(when.timestamp()),
            "duration": duration,
            "source": "al:a1b2c3d4e5f60718",
            "userid": userid,
        }
    )


def clock(api, period: str = "alltime"):
    res = api.get(f"/logger/clock?period={period}")
    assert res.status_code == 200, res.json
    return res.json


def test_plays_land_on_their_weekday_and_hour(clock_api):
    scrobble(datetime(2025, 1, 1, 23, 30), 200)  # Wednesday night
    scrobble(datetime(2025, 1, 8, 23, 5), 100)  # a week later, same hour
    scrobble(datetime(2025, 1, 2, 0, 30), 120)  # after midnight: Thursday's
    scrobble(datetime(2025, 1, 5, 10, 0), 60)  # Sunday, the last row

    body = clock(clock_api)

    days = body["days"]
    assert len(days) == 7 and all(len(day) == 24 for day in days)
    assert days[WED][23] == 300
    assert days[THU][0] == 120
    assert days[SUN][10] == 60
    assert body["total"] == 480
    assert body["peak_hour"] == {"day": WED, "hour": 23, "seconds": 300}
    assert body["peak_day"] == {"day": WED, "seconds": 300}


def test_the_period_bounds_the_plays(clock_api):
    scrobble(datetime(2025, 1, 1, 12, 0), 200)

    assert clock(clock_api, "week")["total"] == 0
    assert clock(clock_api, "week")["peak_hour"] is None
    assert clock(clock_api, "alltime")["total"] == 200


def test_each_user_has_their_own_clock(clock_api):
    scrobble(datetime(2025, 1, 6, 8, 0), 200, userid=2)

    assert clock(clock_api)["total"] == 0
    clock_api.userid = 2
    assert clock(clock_api)["days"][MON][8] == 200


def test_a_new_play_shows_at_once(clock_api):
    scrobble(datetime(2025, 1, 6, 8, 0), 200)
    assert clock(clock_api)["total"] == 200

    scrobble(datetime(2025, 1, 6, 9, 0), 100)
    assert clock(clock_api)["days"][MON][9] == 100


def test_an_unknown_period_is_refused(clock_api):
    assert clock_api.get("/logger/clock?period=decade").status_code == 422
