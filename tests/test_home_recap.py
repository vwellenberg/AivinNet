"""The recap card's rules (#530): which period on which day, and when it is news."""

from datetime import date

import pytest

from aivinnet.lib.home.recap import has_plays, is_news, is_recap_key, recap_period


def test_monday_recaps_the_week_before():
    # 2026-10-26 is a Monday: the week of 19-25 October.
    period = recap_period(date(2026, 10, 26))

    assert period is not None
    assert period.kind == "week"
    assert (period.first, period.until) == (date(2026, 10, 19), date(2026, 10, 26))
    assert period.key == "week:2026-10-19"


def test_the_first_recaps_the_month_before():
    # 2026-11-01 is a Sunday: October.
    period = recap_period(date(2026, 11, 1))

    assert period is not None
    assert period.kind == "month"
    assert (period.first, period.until) == (date(2026, 10, 1), date(2026, 11, 1))
    assert period.key == "month:2026-10"


def test_the_first_of_january_recaps_december_of_the_year_before():
    period = recap_period(date(2027, 1, 1))

    assert period is not None
    assert period.kind == "month"
    assert (period.first, period.until) == (date(2026, 12, 1), date(2027, 1, 1))


def test_a_monday_that_is_the_first_recaps_the_month_once():
    # 2026-06-01 is a Monday.
    both = date(2026, 6, 1)
    assert both.weekday() == 0 and both.day == 1

    period = recap_period(both)

    assert period is not None
    assert period.kind == "month"


@pytest.mark.parametrize("day", [date(2026, 10, 27), date(2026, 10, 31), date(2026, 10, 2)])
def test_no_card_on_other_days(day):
    assert recap_period(day) is None


def test_dismissed_for_a_period_it_is_gone_until_the_next_one():
    monday = recap_period(date(2026, 10, 26))
    next_monday = recap_period(date(2026, 11, 2))

    assert not is_news(monday, monday.key)
    assert is_news(next_monday, monday.key)
    assert is_news(monday, None)


def test_the_month_card_is_not_closed_by_a_week_card():
    month = recap_period(date(2026, 11, 1))
    week = recap_period(date(2026, 10, 26))

    assert is_news(month, week.key)


def test_no_period_is_no_news():
    assert not is_news(None, None)


def test_an_empty_period_has_no_card():
    assert not has_plays(0)
    assert has_plays(1)


@pytest.mark.parametrize("key", ["week:2026-10-19", "month:2026-10"])
def test_a_recap_key_is_well_formed(key):
    assert is_recap_key(key)


@pytest.mark.parametrize("key", ["", "week", "week:2026-10", "day:2026-10-19", "week:2026-10-19 ", "x" * 40])
def test_anything_else_is_no_recap_key(key):
    assert not is_recap_key(key)


def test_the_dismissal_stays_out_of_the_user_json():
    # `todict()` is what every token and `/auth/user` answer carries (#530).
    from aivinnet.models.user import RECAP_DISMISSED_KEY, User

    user = User(id=1, image="", password="", username="u", roles=["user"], extra={RECAP_DISMISSED_KEY: "week:x"})

    assert user.todict()["extra"] == {}
