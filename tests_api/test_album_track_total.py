"""POST /album with track totals as tinytag 2 stores them.

tinytag 2's `as_dict()` hands every extra field over as a LIST of strings, so a
file tagged "track 1/12" lands in `Track.extra` as `{"track_total": ["12"]}`.
The album handler and the completeness stat both ran `int(...)` on that and
answered 500 — for every album of a properly tagged library. In the client the
missing body then surfaced as `Cannot read properties of undefined (reading
'image')`.
"""

import pytest

# Real album hashes are 16 hex chars; the request model enforces the length.
ALBUMHASH = "63e329a1b0641f44"


def _track(n: int, extra: dict):
    from aivinnet.config import UserConfig
    from aivinnet.models.track import Track

    return Track(
        id=n,
        album="Ten Songs",
        albumartists="Some Band",
        albumhash=ALBUMHASH,
        artists="Some Band",
        bitrate=256,
        copyright="",
        date=0,
        disc=1,
        duration=180,
        filepath=f"/music/ten/{n:02}.m4a",
        folder="/music/ten",
        genres="",
        last_mod=0,
        title=f"Song {n}",
        track=n,
        trackhash=f"th{n}",
        extra=extra,
        lastplayed=0,
        playcount=0,
        playduration=0,
        config=UserConfig(),
    )


def _album():
    from aivinnet.models.album import Album

    return Album(
        albumartists=[{"name": "Some Band", "artisthash": "ah1"}],
        albumhash=ALBUMHASH,
        artisthashes=["ah1"],
        base_title="Ten Songs",
        color="",
        created_date=0,
        date=0,
        duration=0,
        genres=[],
        genrehashes=[],
        og_title="Ten Songs",
        title="Ten Songs",
        trackcount=0,
        lastplayed=0,
        playcount=0,
        playduration=0,
        extra={},
        pathhash="ph1",
    )


@pytest.fixture()
def album_api(api_client, monkeypatch):
    def build(*extras: dict):
        from aivinnet.store.albums import AlbumMapEntry, AlbumStore
        from aivinnet.store.tracks import TrackGroup, TrackStore

        tracks = [_track(n, extra) for n, extra in enumerate(extras, start=1)]
        monkeypatch.setattr(AlbumStore, "albummap", {ALBUMHASH: AlbumMapEntry(_album(), {t.trackhash for t in tracks})})
        monkeypatch.setattr(TrackStore, "trackhashmap", {t.trackhash: TrackGroup([t]) for t in tracks})
        return api_client("aivinnet.api.album")

    return build


def _completeness(body):
    return next(s for s in body["stats"] if s["cssclass"] == "completeness")


def test_tinytag_2_list_values_do_not_500(album_api):
    api = album_api({"track_total": ["12"]}, {"track_total": ["12"]})

    res = api.post("/album", json={"albumhash": ALBUMHASH, "limit": 7})

    assert res.status_code == 200, res.text
    body = res.get_json()
    assert body["extra"]["track_total"] == 12
    assert body["info"]["image"]
    assert _completeness(body)["text"] == "2/12 tracks available"


def test_rows_from_both_tinytag_eras_mix(album_api):
    # An old row (plain int) next to a new one (list) for the same disc.
    api = album_api({"track_total": 12}, {"track_total": ["12"]})

    res = api.post("/album", json={"albumhash": ALBUMHASH, "limit": 7})

    assert res.status_code == 200, res.text
    assert res.get_json()["extra"]["track_total"] == 12


def test_no_track_total_at_all(album_api):
    api = album_api({}, {"track_total": [""]})

    res = api.post("/album", json={"albumhash": ALBUMHASH, "limit": 7})

    assert res.status_code == 200, res.text
    assert res.get_json()["extra"]["track_total"] == 1
