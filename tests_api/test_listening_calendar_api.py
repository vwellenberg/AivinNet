"""`GET /logger/calendar` — the listening calendar on the stats page (#525).

Real request cycle and real `ScrobbleTable` rows: the per-day sums happen in
SQL (`seconds_per_day`), so that is the part a fast-lane test cannot see.
"""

import time
from datetime import datetime

import pendulum
import pytest


@pytest.fixture()
def calendar_api(api_client, monkeypatch):
    import aivinnet.api.scrobble as scrobble_api

    api = api_client("aivinnet.api.scrobble")
    monkeypatch.setattr(scrobble_api, "get_current_userid", lambda: api.userid)
    # Ids restart after the between-tests wipe: a cache from another test
    # could match this one's marker.
    monkeypatch.setattr(scrobble_api, "_calendars", {})
    return api


def scrobble(when: pendulum.DateTime, duration: int, userid: int = 1):
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


def calendar(api):
    res = api.get("/logger/calendar")
    assert res.status_code == 200, res.json
    return res.json


def libc_today() -> pendulum.DateTime:
    """Today in the C library's zone — the one SQLite's `localtime` uses."""
    return pendulum.instance(datetime.fromtimestamp(time.time())).start_of("day")


def test_plays_are_summed_per_server_day(calendar_api):
    today = libc_today()
    yesterday = today.subtract(days=1)

    scrobble(today.add(hours=9), 200)
    scrobble(today.add(minutes=1), 100)
    scrobble(yesterday.add(hours=23, minutes=59), 120)

    body = calendar(calendar_api)

    assert body["end"] == today.to_date_string()
    assert body["days"] == {today.to_date_string(): 300, yesterday.to_date_string(): 120}
    assert body["streaks"]["current"]["days"] == 2
    assert body["streaks"]["longest"]["days"] == 2


def test_a_day_of_skips_is_no_listening_day(calendar_api):
    today = libc_today()
    for minute in range(5):
        scrobble(today.add(minutes=minute), 10)

    body = calendar(calendar_api)

    assert body["days"] == {}
    assert body["streaks"]["current"]["days"] == 0


def test_the_longest_streak_looks_past_the_window(calendar_api):
    long_ago = libc_today().subtract(years=3)
    for day in range(5):
        scrobble(long_ago.add(days=day, hours=12), 600)

    body = calendar(calendar_api)

    assert body["days"] == {}
    assert body["streaks"]["longest"] == {
        "days": 5,
        "start": long_ago.to_date_string(),
        "end": long_ago.add(days=4).to_date_string(),
    }


def test_another_users_plays_stay_theirs(calendar_api):
    scrobble(pendulum.now(), 600, userid=2)

    assert calendar(calendar_api)["days"] == {}

    calendar_api.userid = 2
    assert len(calendar(calendar_api)["days"]) == 1


@pytest.mark.parametrize("zone", ["Pacific/Kiritimati", "Pacific/Pago_Pago"])
def test_today_is_the_day_the_plays_are_counted_in(calendar_api, zone):
    """
    The calendar ended on pendulum's today while SQLite put the plays in libc's
    zone. Where pendulum falls back to UTC (`ensure_local_timezone`) and libc
    does not, the newest plays fell after the end of the calendar. With pendulum
    14 hours ahead and 11 behind, one of the two disagrees at any hour.
    """
    before = pendulum.local_timezone()
    pendulum.set_local_timezone(pendulum.timezone(zone))
    try:
        scrobble(pendulum.now(), 600)
        body = calendar(calendar_api)
    finally:
        pendulum.set_local_timezone(before)

    today = libc_today().to_date_string()
    assert body["end"] == today
    assert list(body["days"]) == [today]
    assert body["streaks"]["current"]["days"] == 1


def test_a_play_stamped_in_the_future_counts_nowhere(calendar_api):
    """A device clock running ahead must not end a streak on a date the grid never shows."""
    today = libc_today()
    scrobble(today.add(hours=12), 600)
    scrobble(today.add(days=1, hours=12), 600)

    body = calendar(calendar_api)

    assert list(body["days"]) == [today.to_date_string()]
    assert body["streaks"]["longest"]["end"] == today.to_date_string()


def test_a_revisit_without_a_new_play_reuses_the_calendar(calendar_api, monkeypatch):
    from aivinnet.db.userdata import ScrobbleTable

    scrobble(libc_today().add(hours=1), 600)
    calls = []
    real = ScrobbleTable.seconds_per_day.__func__
    monkeypatch.setattr(ScrobbleTable, "seconds_per_day", classmethod(lambda cls, *a: calls.append(1) or real(cls, *a)))

    first = calendar(calendar_api)
    assert calendar(calendar_api) == first
    assert len(calls) == 1

    # A new play is a new calendar.
    scrobble(libc_today().add(hours=2), 600)
    assert calendar(calendar_api)["days"][libc_today().to_date_string()] == 1200
    assert len(calls) == 2

    # Another user's calendar is theirs, not a cache hit.
    calendar_api.userid = 2
    assert calendar(calendar_api)["days"] == {}
