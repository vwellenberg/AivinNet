"""
The date cards of Home in `GET /nothome/` (#776): the recap and the Advent
calendar come with the rows. A card whose data is not computed yet is absent on
that load, and its computation runs on a thread: nothing in the request waits.
"""

import time
from datetime import date

import pytest
from test_home_discover_api import home  # noqa: F401 - the imported fixture


@pytest.fixture()
def as_user(home, monkeypatch):
    """The discover scenario's API, acting as its user, with empty date caches."""
    import aivinnet.api.home as home_api
    import aivinnet.store.homepage as homepage

    monkeypatch.setattr(home_api, "get_current_userid", lambda: home.userid)
    monkeypatch.setattr(homepage, "get_current_userid", lambda: home.userid)
    monkeypatch.setattr(home_api, "_recaps", {})
    monkeypatch.setattr(home_api, "_advent_ready", set())
    monkeypatch.setattr(home_api, "_warming", set())
    return home


def wait_until(predicate, seconds: float = 10.0) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError("the background computation did not finish")


def test_the_recap_comes_with_the_rows_and_is_never_waited_for(as_user, monkeypatch):
    import aivinnet.api.home as home_api

    monkeypatch.setattr(home_api, "recap_today", lambda: date(2026, 11, 9))  # a Monday: last week's recap

    first = as_user.get("/nothome/?limit=9").get_json()
    assert set(first) == {"rows", "stations", "recap", "advent"}
    assert first["recap"] is None, "not computed yet: the card is absent on this load"

    wait_until(lambda: as_user.userid in home_api._recaps)
    later = as_user.get("/nothome/?limit=9").get_json()
    assert later["recap"] == home_api._recaps[as_user.userid][1]


def test_the_advent_calendar_is_computed_in_the_background(as_user, monkeypatch):
    import aivinnet.api.home as home_api

    today = date(2026, 12, 10)
    monkeypatch.setattr(home_api, "recap_today", lambda: today)

    first = as_user.get("/nothome/?limit=9").get_json()
    assert first["advent"] == {"day": 0, "doors": []}, "not computed yet: no calendar on this load"

    wait_until(lambda: (as_user.userid, today) in home_api._advent_ready)
    later = as_user.get("/nothome/?limit=9").get_json()
    assert later["advent"]["day"] == 10
    assert len(later["advent"]["doors"]) <= 10


def test_outside_the_season_no_advent_work_is_started(as_user, monkeypatch):
    import aivinnet.api.home as home_api

    monkeypatch.setattr(home_api, "recap_today", lambda: date(2026, 6, 3))

    body = as_user.get("/nothome/?limit=9").get_json()

    assert body["advent"] == {"day": 0, "doors": []}
    assert not any(ident[0] == "advent" for ident in home_api._warming)
