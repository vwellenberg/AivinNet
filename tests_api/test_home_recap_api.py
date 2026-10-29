"""`GET /nothome/recap` and `POST /nothome/recap/dismiss` — the Home recap card (#530).

Real request cycle, real `ScrobbleTable` rows and a real `UserTable.extra`, on
the library of `test_home_discover_api` (six albums, Red Hot Chili Peppers,
Faith No More, Primus, Miles Davis). The day is pinned, so "last week" is a
known week: Monday 26 October 2026 recaps 19-25 October.
"""

from datetime import date

import pendulum
import pytest
from test_home_discover_api import (  # noqa: F401 - the imported fixtures
    FNM,
    MILES,
    RHCP,
    TRACKS,
    artisthash,
    home,
    th,
)

from aivinnet.utils.dates import seconds_to_time_string

MONDAY = date(2026, 10, 26)


@pytest.fixture()
def recap(home, monkeypatch):  # noqa: F811 - the imported fixture
    """The Home API as user 1, on a pinned day, with no recap cached and no dismissal kept."""
    import aivinnet.api.home as home_api
    from aivinnet.db.userdata import UserTable
    from aivinnet.models.user import RECAP_DISMISSED_KEY

    monkeypatch.setattr(home_api, "get_current_userid", lambda: home.userid)
    monkeypatch.setattr(home_api, "_is_guest", lambda userid: False)
    monkeypatch.setattr(home_api, "_recaps", {})
    monkeypatch.setattr(home_api, "recap_today", lambda: MONDAY)
    # The users outlive a test: what one dismissed, the next must not have.
    for userid in (1, 2):
        UserTable.set_extra(userid, RECAP_DISMISSED_KEY, None)
    return home


def play(trackhash: str, when: pendulum.DateTime, duration: int = 200):
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.add(
        {"trackhash": trackhash, "timestamp": int(when.timestamp()), "duration": duration, "source": "", "userid": 1}
    )


def at(year: int, month: int, day: int, hour: int = 20) -> pendulum.DateTime:
    """A moment in the server's local time, the zone the recap counts in."""
    return pendulum.datetime(year, month, day, hour, tz="local")


def get_recap(api) -> dict | None:
    res = api.get("/nothome/recap")
    assert res.status_code == 200, res.text
    return res.get_json()["recap"]


def last_week(api):
    """Three albums heard in 19-25 October: RHCP 3 x 300 s, FNM 2 x 240 s, Miles 1 x 100 s."""
    for day in (20, 21, 22):
        play(th(RHCP, 1), at(2026, 10, day), duration=300)
    play(th(FNM, 2), at(2026, 10, 23), duration=240)
    play(th(FNM, 2), at(2026, 10, 24), duration=240)
    play(th(MILES, 1), at(2026, 10, 25), duration=100)


def test_monday_tells_last_week(recap):
    last_week(recap)

    card = get_recap(recap)

    assert card["key"] == "week:2026-10-19"
    assert card["kind"] == "week"
    assert card["plays"] == 6
    assert card["listened"] == seconds_to_time_string(3 * 300 + 2 * 240 + 100)
    assert card["new_albums"] == 3
    assert card["top_artist"] == {"artisthash": artisthash(RHCP), "name": TRACKS[(RHCP, 1)].albumartists[0]["name"]}
    assert card["top_track"]["trackhash"] == th(RHCP, 1)
    assert card["top_track"]["title"] == TRACKS[(RHCP, 1)].title


def test_the_first_tells_last_month_and_a_monday_on_the_first_too(recap, monkeypatch):
    import aivinnet.api.home as home_api

    play(th(RHCP, 1), at(2026, 10, 3))
    play(th(RHCP, 1), at(2026, 10, 15))
    monkeypatch.setattr(home_api, "recap_today", lambda: date(2026, 11, 1))

    card = get_recap(recap)

    assert card["kind"] == "month"
    assert card["key"] == "month:2026-10"
    assert card["plays"] == 2


def test_no_card_on_other_days(recap, monkeypatch):
    import aivinnet.api.home as home_api

    last_week(recap)
    monkeypatch.setattr(home_api, "recap_today", lambda: date(2026, 10, 27))

    assert get_recap(recap) is None


def test_an_empty_week_has_no_card(recap):
    # Outside 19-25 October: the Sunday before and the Monday itself.
    play(th(RHCP, 1), at(2026, 10, 18))
    play(th(RHCP, 1), at(2026, 10, 26, 8))

    assert get_recap(recap) is None


def test_dismissed_is_gone_until_the_next_week_and_stays_gone(recap, monkeypatch):
    import aivinnet.api.home as home_api
    from aivinnet.db.userdata import UserTable
    from aivinnet.models.user import RECAP_DISMISSED_KEY

    last_week(recap)
    play(th(RHCP, 2), at(2026, 10, 28))  # the week after, for the next Monday
    assert get_recap(recap)["key"] == "week:2026-10-19"

    res = recap.post("/nothome/recap/dismiss", json={"key": "week:2026-10-19"})
    assert res.status_code == 200, res.text
    assert get_recap(recap) is None

    # A restart forgets the cached recap, not the dismissal: it is stored per user.
    monkeypatch.setattr(home_api, "_recaps", {})
    assert get_recap(recap) is None
    assert UserTable.get_extra(1)[RECAP_DISMISSED_KEY] == "week:2026-10-19"

    # The next Monday is a new week: the card is back, for the new week.
    monkeypatch.setattr(home_api, "recap_today", lambda: date(2026, 11, 2))
    card = get_recap(recap)
    assert card["key"] == "week:2026-10-26"
    assert card["plays"] == 1


def test_a_bad_key_is_refused_and_nothing_is_kept(recap):
    from aivinnet.db.userdata import UserTable
    from aivinnet.models.user import RECAP_DISMISSED_KEY

    res = recap.post("/nothome/recap/dismiss", json={"key": "day:2026-10-19"})

    assert res.status_code == 422
    assert UserTable.get_extra(1).get(RECAP_DISMISSED_KEY) is None


def test_the_guest_account_closes_nothing(recap, monkeypatch):
    import aivinnet.api.home as home_api

    monkeypatch.setattr(home_api, "_is_guest", lambda userid: True)

    res = recap.post("/nothome/recap/dismiss", json={"key": "week:2026-10-19"})

    assert res.status_code == 403
