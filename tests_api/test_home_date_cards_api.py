"""
The date cards of Home in `GET /nothome/` (#776): the recap and the Advent
calendar come with the rows, on the FIRST load. A first draft warmed them on a
thread and left them out until ready; the client never asks again, so the first
Home of a Monday had no recap, and a later refetch popped the card in above the
rows. They are computed in the request now, behind the same caches the
standalone endpoints always used.
"""

from datetime import date

import pytest
from test_home_discover_api import home  # noqa: F401 - the imported fixture


@pytest.fixture()
def as_user(home, monkeypatch):
    """The discover scenario's API, acting as its user, with an empty recap cache."""
    import aivinnet.api.home as home_api
    import aivinnet.store.homepage as homepage

    monkeypatch.setattr(home_api, "get_current_userid", lambda: home.userid)
    monkeypatch.setattr(homepage, "get_current_userid", lambda: home.userid)
    monkeypatch.setattr(home_api, "_recaps", {})
    return home


def test_the_first_home_of_a_monday_carries_the_recap(as_user, monkeypatch):
    import aivinnet.api.home as home_api

    monkeypatch.setattr(home_api, "recap_today", lambda: date(2026, 11, 9))  # a Monday: last week's recap
    # The recap's content is `test_home_recap_api.py`'s business; here only when it comes.
    monkeypatch.setattr(home_api, "_build_recap", lambda userid, period: {"key": period.key, "plays": 7})

    first = as_user.get("/nothome/?limit=9").get_json()

    assert set(first) == {"rows", "stations", "recap", "advent"}
    assert first["recap"] == {"key": first["recap"]["key"], "plays": 7}
    # The same card the standalone endpoint serves, on the very first load.
    assert first["recap"] == as_user.get("/nothome/recap").get_json()["recap"]
    assert first["recap"] == home_api._recaps[as_user.userid][1]


def test_the_first_home_in_advent_carries_the_calendar(as_user, monkeypatch):
    import aivinnet.api.home as home_api

    monkeypatch.setattr(home_api, "recap_today", lambda: date(2026, 12, 10))

    first = as_user.get("/nothome/?limit=9").get_json()

    assert first["advent"]["day"] == 10
    assert first["advent"] == as_user.get("/nothome/advent").get_json()


def test_outside_the_season_there_is_no_calendar_and_no_recap(as_user, monkeypatch):
    import aivinnet.api.home as home_api

    monkeypatch.setattr(home_api, "recap_today", lambda: date(2026, 6, 3))  # a Wednesday in June

    body = as_user.get("/nothome/?limit=9").get_json()

    assert body["advent"] == {"day": 0, "doors": []}
    assert body["recap"] is None
