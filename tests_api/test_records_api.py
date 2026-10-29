"""`POST /logger/track/log` answers with the play count and a milestone (#545),
and `GET /logger/records` serves the records board the cron counts (#540).

Real request cycle and real `ScrobbleTable` rows: the count the milestone check
reads is a SQL COUNT, which only a database can show.
"""

from datetime import datetime

import pytest
from test_scrobble_log import ALBUM, HASH, TIMESTAMP, log, logger, make_track

assert logger  # the fixture module's stores


@pytest.fixture()
def records(logger, monkeypatch):
    import aivinnet.api.scrobble as scrobble_api
    import aivinnet.lib.recipes.records as records_module

    # The board is counted by the cron; the tests count it by hand, from a clean slate.
    monkeypatch.setattr(records_module, "_boards", {})
    # The real serializer wants a fully built Track: the fixture's track stands in.
    track = make_track()
    monkeypatch.setattr(
        scrobble_api.TrackStore,
        "get_tracks_by_trackhashes",
        lambda hashes: [track] if HASH in hashes else [],
    )
    monkeypatch.setattr(scrobble_api, "serialize_track", lambda t: {"title": t.title, "artists": t.artists})
    return logger


def seed(userid: int, count: int, start: int = TIMESTAMP, duration: int = 200):
    """`count` plays of the library track, one per `duration` seconds from `start`."""
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.insert_many(
        [
            {
                "trackhash": HASH,
                "duration": duration,
                "timestamp": start + i * duration,
                "source": f"al:{ALBUM}",
                "userid": userid,
            }
            for i in range(count)
        ]
    )


def play(api):
    res = log(api)
    assert res.status_code == 201, res.json
    return res.json


# --- milestone plays (#545) -------------------------------------------------


def test_every_play_answers_with_the_play_count(records):
    body = play(records.api)

    assert body == {"msg": "recorded", "plays": 1, "milestone": None}


def test_the_thousandth_play_names_its_number_and_track(records):
    seed(records.api.userid, 999)

    body = play(records.api)

    assert body["plays"] == 1_000
    assert body["milestone"] == {"number": 1_000, "track": "Blue"}


def test_1337_is_celebrated_too(records):
    seed(records.api.userid, 1_336)

    assert play(records.api)["milestone"] == {"number": 1_337, "track": "Blue"}


def test_a_milestone_fires_once_for_the_same_user(records):
    seed(records.api.userid, 999)
    play(records.api)  # the 1,000th

    body = play(records.api)  # the 1,001st

    assert body["plays"] == 1_001
    assert body["milestone"] is None


def test_the_count_is_each_users_own(records):
    seed(2, 999)  # another user's history must not make this play the thousandth

    body = play(records.api)

    assert body["plays"] == 1
    assert body["milestone"] is None


# --- the records board (#540) -----------------------------------------------


def test_a_user_the_cron_has_not_counted_sees_an_empty_board(records):
    res = records.api.get("/logger/records")

    assert res.status_code == 200
    assert res.json == {"plays": 0, "longest_session": None, "obsession": None, "milestones": []}


def test_the_board_names_the_longest_session_the_obsession_and_the_first_play(records):
    import aivinnet.lib.recipes.records as records_module

    # Three plays back to back, a pause, then one more: the first session is the longest.
    start = TIMESTAMP
    seed(records.api.userid, 3, start=start, duration=200)
    seed(records.api.userid, 1, start=start + 100_000, duration=200)
    records_module.refresh_records()

    res = records.api.get("/logger/records")

    assert res.status_code == 200
    body = res.json
    assert body["plays"] == 4
    assert body["longest_session"] == {"start": start, "end": start + 600, "seconds": 600, "plays": 3}
    day = datetime.fromtimestamp(start).date().isoformat()  # the C library's local zone, as SQLite's localtime
    assert body["obsession"] == {
        "track": {"title": "Blue", "artists": [{"name": "The Artist"}]},
        "day": day,
        "plays": 3,
    }
    assert body["milestones"] == [
        {"number": 1, "timestamp": start, "track": {"title": "Blue", "artists": [{"name": "The Artist"}]}}
    ]


def test_a_track_no_longer_in_the_library_names_no_track(records):
    import aivinnet.lib.recipes.records as records_module
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.insert_many(
        [
            {
                "trackhash": "ffffffffffffffff",
                "duration": 200,
                "timestamp": TIMESTAMP,
                "source": "x",
                "userid": records.api.userid,
            }
        ]
    )
    records_module.refresh_records()

    body = records.api.get("/logger/records").json

    assert body["milestones"] == [{"number": 1, "timestamp": TIMESTAMP, "track": None}]
    assert body["plays"] == 1
