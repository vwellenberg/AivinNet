"""`year` on a serialized track over the real request cycle (AivinNet FM shows "Album · 1999").

A tagged track carries its release year as an int; an untagged one, whose
`date` is the file's mtime, carries null. `date` itself never leaves the server.
"""

from datetime import UTC, datetime

import pytest

TAGGED = int(datetime(1999, 5, 3, tzinfo=UTC).timestamp())
MTIME = 1_700_000_000  # the file's mtime, stored as `date` when the file has no year tag


def _track(n: int, date: int, last_mod: int):
    from aivinnet.config import UserConfig
    from aivinnet.models.track import Track

    return Track(
        id=n,
        album="Icon",
        albumartists="Sleeping Giant",
        albumhash="icon0000albumha1",
        artists="Sleeping Giant",
        bitrate=320,
        copyright="",
        date=date,
        disc=1,
        duration=240,
        filepath=f"/music/Sleeping Giant/Icon/{n:02}.flac",
        folder="/music/Sleeping Giant/Icon",
        genres="Metal",
        last_mod=last_mod,
        title=f"Track {n}",
        track=n,
        trackhash=f"year-track-{n}",
        extra={},
        lastplayed=0,
        playcount=0,
        playduration=0,
        config=UserConfig(),
        added=last_mod,
    )


@pytest.fixture()
def album_api(api_client, monkeypatch):
    import aivinnet.api.album as album_module
    from aivinnet.store.albums import AlbumStore

    tracks = [_track(1, TAGGED, MTIME), _track(2, MTIME, MTIME)]
    monkeypatch.setattr(AlbumStore, "get_album_tracks", lambda _albumhash: list(tracks))
    return api_client("aivinnet.api.album"), album_module


def test_a_tagged_track_carries_its_release_year_and_an_untagged_one_null(album_api):
    api, _ = album_api

    res = api.get("/album/icon0000albumha1/tracks")

    assert res.status_code == 200, res.get_data(as_text=True)
    tagged, untagged = res.get_json()
    assert tagged["year"] == 1999
    assert untagged["year"] is None
    assert "date" not in tagged
    assert "date" not in untagged


@pytest.mark.parametrize(
    ("date", "last_mod", "expected"),
    [
        (TAGGED, MTIME, 1999),
        # No year tag: `date` is the mtime, no release year.
        (MTIME, MTIME, None),
        (0, MTIME, None),
        # Before 1970, which Windows' clock cannot read with fromtimestamp.
        (int(datetime(1965, 7, 1, tzinfo=UTC).timestamp()), MTIME, 1965),
        # A year-only tag: the first second of the year in UTC (#391).
        (int(datetime(2000, 1, 1, tzinfo=UTC).timestamp()), MTIME, 2000),
    ],
)
def test_release_year_rule(date, last_mod, expected):
    assert _track(1, date, last_mod).release_year() == expected


def test_a_non_numeric_date_is_no_year_not_a_failed_listing():
    track = _track(1, TAGGED, MTIME)
    track.date = "2019-05-03"  # a stray TEXT value in an old row
    assert track.release_year() is None
