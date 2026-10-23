"""`GET /logger/rewind?year=` — AivinNet Rewind (#527).

Real request cycle and real `ScrobbleTable` rows, on the library the Home
tests build (`test_home_discover_api`: six albums, artists and genres made by
the scanner's own `Track`): the cards Rewind sends are the ones the client
draws.
"""

from datetime import datetime

import pendulum
import pytest
from test_home_discover_api import ALBUMS, FNM, MILES, PRIMUS, RHCP, home, th  # noqa: F401 - `home` is a fixture

assert ALBUMS  # the fixture module's library


@pytest.fixture()
def rewind_api(home, api_client, monkeypatch):  # noqa: F811 - the imported fixture
    """The Home tests' library in the stores, and the logger blueprint to ask."""
    import aivinnet.api.scrobble as scrobble_api

    api = api_client("aivinnet.api.scrobble")
    monkeypatch.setattr(scrobble_api, "get_current_userid", lambda: api.userid)
    monkeypatch.setattr(scrobble_api, "_rewinds", {})
    monkeypatch.setattr(scrobble_api, "_rewind_years", {})
    return api


def play(trackhash: str, when: pendulum.DateTime, duration: int = 200, source: str = "al:x", userid: int = 1):
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.add(
        {
            "trackhash": trackhash,
            "timestamp": int(when.timestamp()),
            "duration": duration,
            "source": source,
            "userid": userid,
        }
    )


def rewind(api, year: int | None = None):
    res = api.get("/logger/rewind" + (f"?year={year}" if year else ""))
    assert res.status_code == 200, res.text
    return res.get_json()


def local(year: int, month: int, day: int, hour: int = 20) -> pendulum.DateTime:
    """A moment in the C library's local time — the zone Rewind counts in."""
    return pendulum.instance(datetime(year, month, day, hour).astimezone())


# A Rewind opens on January 1 for the year that ended: the tests look back at
# last year, whatever year they run in.
THIS = datetime.now().year
LAST = THIS - 1
# A play this year: its first minute is never in the future, and never in
# last year either (`now - 5 minutes` is, shortly after midnight on New Year's).
THIS_YEAR = (THIS, 1, 1, 0)


def test_a_year_told_in_cards(rewind_api):
    play(th(FNM, 1), local(LAST - 1, 3, 1))  # the year before: FNM is not new
    for day in range(1, 6):
        play(th(RHCP, 1), local(LAST, 1, day), duration=300)
    play(th(FNM, 2), local(LAST, 7, 4), duration=240, source="pl:3")
    play(th(FNM, 2), local(LAST, 7, 5), duration=240, source="pl:3")
    play(th(PRIMUS, 3), local(LAST, 1, 1, 0), duration=100)

    body = rewind(rewind_api, LAST)

    assert body["year"] == LAST
    assert body["years"] == [LAST - 1, LAST]
    assert body["plays"] == 8
    assert body["seconds"] == 5 * 300 + 2 * 240 + 100
    assert [a["name"] for a in body["top_artists"]] == ["Red Hot Chili Peppers", "Faith No More", "Primus"]
    assert body["top_artists"][0]["seconds"] == 1500
    assert body["top_albums"][0]["albumhash"] == RHCP
    assert body["top_albums"][0]["image"] == f"{RHCP}.webp?pathhash=ph-Blood Sugar"
    assert body["top_tracks"][0]["trackhash"] == th(RHCP, 1)
    assert body["top_tracks"][0]["seconds"] == 1500
    assert body["top_tracks"][0]["plays"] == 5
    assert body["summer_track"]["track"]["trackhash"] == th(FNM, 2)
    assert body["summer_track"]["plays"] == 2
    assert body["first_track"]["track"]["trackhash"] == th(PRIMUS, 3)
    assert body["busiest_day"] == {"date": f"{LAST}-01-01", "seconds": 400}
    # Faith No More was played the year before: only Red Hot Chili Peppers and Primus are new.
    assert body["new_artists"] == 2
    assert [a["name"] for a in body["new_artists_top"]] == ["Red Hot Chili Peppers", "Primus"]
    assert body["listener"] == {"kind": "album", "share": 0.75}


def test_this_year_opens_on_new_years_day(rewind_api):
    play(th(MILES, 1), local(LAST, 6, 1))
    play(th(MILES, 1), local(*THIS_YEAR))

    res = rewind_api.get(f"/logger/rewind?year={THIS}")

    assert res.status_code == 404
    # When it opens, and where to go meanwhile: a bookmark lands here.
    assert res.get_json()["opens"] == f"{THIS + 1}-01-01"
    assert res.get_json()["years"] == [LAST]
    # Nor does it count as a year to open.
    assert rewind_api.get("/logger/rewind/years").get_json() == {"years": [LAST]}


def test_a_later_year_is_not_open_either(rewind_api):
    assert rewind_api.get(f"/logger/rewind?year={THIS + 3}").status_code == 404


def test_without_a_year_it_is_last_year(rewind_api):
    play(th(MILES, 1), local(LAST, 5, 1))
    play(th(MILES, 2), local(*THIS_YEAR))

    body = rewind(rewind_api)

    assert body["year"] == LAST
    assert body["years"] == [LAST]
    assert body["plays"] == 1


def test_after_a_quiet_spell_it_is_the_last_year_with_music(rewind_api):
    play(th(MILES, 1), local(LAST - 2, 5, 1))
    play(th(MILES, 2), local(*THIS_YEAR))  # back to music this year

    body = rewind(rewind_api)

    # Last year had none: the year before the quiet one is the latest to open.
    assert body["year"] == LAST - 2
    assert body["years"] == [LAST - 2]
    assert body["plays"] == 1


def test_a_year_without_music_is_no_year_to_open(rewind_api):
    play(th(MILES, 1), local(LAST - 3, 5, 1))
    play(th(MILES, 1), local(LAST - 1, 5, 1))

    assert rewind_api.get("/logger/rewind/years").get_json() == {"years": [LAST - 3, LAST - 1]}


def test_without_any_music_it_is_last_year(rewind_api):
    body = rewind(rewind_api)

    assert body["year"] == LAST
    assert body["plays"] == 0


def test_the_years_are_the_finished_ones_with_music(rewind_api):
    play(th(MILES, 1), local(LAST - 1, 6, 1))
    play(th(MILES, 1), local(LAST, 6, 1))
    play(th(MILES, 2), local(*THIS_YEAR))
    play(th(MILES, 2), pendulum.now().add(years=2))  # a clock running ahead

    assert rewind_api.get("/logger/rewind/years").get_json() == {"years": [LAST - 1, LAST]}
    assert rewind(rewind_api)["years"] == [LAST - 1, LAST]


def test_an_empty_year_is_an_answer_not_an_error(rewind_api):
    body = rewind(rewind_api, 2019)

    assert body["plays"] == 0
    assert body["top_tracks"] == []
    assert body["summer_track"] is None
    assert body["first_track"] is None
    assert body["years"] == []


def test_another_users_year_stays_theirs(rewind_api):
    play(th(RHCP, 1), local(LAST, 2, 2), userid=2)

    assert rewind(rewind_api, LAST)["plays"] == 0
    assert rewind_api.get("/logger/rewind/years").get_json() == {"years": []}

    rewind_api.userid = 2
    assert rewind(rewind_api, LAST)["plays"] == 1
    assert rewind_api.get("/logger/rewind/years").get_json() == {"years": [LAST]}


def test_a_new_play_is_a_new_rewind(rewind_api):
    play(th(RHCP, 1), local(LAST, 2, 2))
    assert rewind(rewind_api, LAST)["plays"] == 1

    play(th(RHCP, 2), local(LAST, 2, 3))
    assert rewind(rewind_api, LAST)["plays"] == 2


def test_a_year_out_of_range_is_refused(rewind_api):
    assert rewind_api.get("/logger/rewind?year=12345").status_code == 422


def test_the_first_year_is_an_empty_answer(rewind_api):
    # 1970 starts before the epoch east of UTC, which Windows' clock refuses.
    assert rewind(rewind_api, 1970)["plays"] == 0


@pytest.mark.parametrize("zone", ["Pacific/Kiritimati", "Pacific/Pago_Pago"])
def test_days_are_the_ones_the_calendar_counts_in(rewind_api, monkeypatch, zone):
    """
    Rewind counts in the C library's zone, like the listening calendar beside
    it, not in pendulum's: where pendulum falls back to UTC
    (`ensure_local_timezone`), the biggest day would be another day than the
    calendar's. Noon on New Year's Eve is a day off libc's in one of the two
    zones, and always inside the calendar's twelve months.
    """
    import aivinnet.api.scrobble as scrobble_api

    monkeypatch.setattr(scrobble_api, "_calendars", {})
    play(th(RHCP, 1), local(LAST, 12, 31, 12))

    before = pendulum.local_timezone()
    pendulum.set_local_timezone(pendulum.timezone(zone))
    try:
        body = rewind(rewind_api, LAST)
        calendar = rewind_api.get("/logger/calendar").get_json()
    finally:
        pendulum.set_local_timezone(before)

    assert list(calendar["days"]) == [body["busiest_day"]["date"]] == [f"{LAST}-12-31"]
