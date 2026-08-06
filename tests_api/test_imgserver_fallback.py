"""Full-stack tests for the per-entity thumbnail placeholder (fb=track).

A track and its album share the same thumbnail file, so the entity has to
travel with the URL: Track.image appends `fb=track` and the image server picks
the note placeholder (track.webp) over the record one (default.webp) when the
cover is missing. Only this lane can prove the query model actually maps the
param through the real flask_openapi3 request cycle.
"""

import pytest

DEFAULT_BYTES = b"record-placeholder"
TRACK_BYTES = b"note-placeholder"
COVER_BYTES = b"a-real-cover"


@pytest.fixture()
def img_client(monkeypatch, tmp_path):
    """
    The REAL imgserver blueprint on a fresh app, with Paths pointed at
    tmp_path: an assets dir carrying both placeholders and one existing
    large thumbnail (`known.webp`).
    """
    from flask_openapi3 import OpenAPI

    from swingmusic.api import imgserver

    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "default.webp").write_bytes(DEFAULT_BYTES)
    (assets / "track.webp").write_bytes(TRACK_BYTES)

    sizes = {}
    for name in ["lg", "md", "sm", "xsm"]:
        folder = tmp_path / name
        folder.mkdir()
        sizes[name] = folder
    (sizes["lg"] / "known.webp").write_bytes(COVER_BYTES)

    class FakePaths:
        assets_path = assets
        lg_thumb_path = sizes["lg"]
        md_thumb_path = sizes["md"]
        sm_thumb_path = sizes["sm"]
        xsm_thumb_path = sizes["xsm"]
        image_cache_path = tmp_path / "cache"

    monkeypatch.setattr(imgserver, "Paths", FakePaths)

    app = OpenAPI(__name__)
    app.register_api(imgserver.api)
    app.config["TESTING"] = True
    return app.test_client()


def test_missing_cover_serves_the_record_placeholder(img_client):
    res = img_client.get("/img/thumbnail/missing.webp")
    assert res.status_code == 200
    assert res.data == DEFAULT_BYTES


def test_missing_cover_with_fb_track_serves_the_note(img_client):
    res = img_client.get("/img/thumbnail/missing.webp?fb=track")
    assert res.status_code == 200
    assert res.data == TRACK_BYTES


@pytest.mark.parametrize("size", ["xsmall", "small", "medium"])
def test_fb_track_reaches_every_size_endpoint(img_client, size):
    res = img_client.get(f"/img/thumbnail/{size}/missing.webp?fb=track")
    assert res.status_code == 200
    assert res.data == TRACK_BYTES


def test_fb_track_combines_with_pathhash(img_client):
    # The real Track.image is "<hash>.webp?pathhash=<ph>&fb=track" — both
    # params must survive the query model together. The unknown pathhash walks
    # the recovery path (empty stores) and must still end at the note.
    res = img_client.get("/img/thumbnail/missing.webp?pathhash=someph&fb=track")
    assert res.status_code == 200
    assert res.data == TRACK_BYTES


def test_fb_track_never_overrides_an_existing_cover(img_client):
    res = img_client.get("/img/thumbnail/known.webp?fb=track")
    assert res.status_code == 200
    assert res.data == COVER_BYTES


def test_unknown_fb_value_falls_back_to_the_record(img_client):
    res = img_client.get("/img/thumbnail/missing.webp?fb=artist")
    assert res.status_code == 200
    assert res.data == DEFAULT_BYTES


# --- the model side of the contract -----------------------------------------


def _make_track(**overrides):
    from swingmusic.config import UserConfig
    from swingmusic.models.track import Track

    fields = dict(
        id=1,
        album="Naruto Original Soundtrack II",
        # artists arrive as raw tag strings; __post_init__ splits them.
        albumartists="Toshiro Masuda",
        albumhash="alb1",
        artists="Toshiro Masuda",
        bitrate=320,
        copyright="",
        date=1032739200,
        disc=1,
        duration=103,
        filepath="/music/naruto/01 - Fooling Mode.mp3",
        folder="/music/naruto",
        genres="soundtrack",
        last_mod=0,
        title="Fooling Mode",
        track=1,
        trackhash="th1",
        extra={},
        lastplayed=0,
        playcount=0,
        playduration=0,
        config=UserConfig(),
    )
    fields.update(overrides)
    return Track(**fields)


def test_track_image_carries_the_entity():
    track = _make_track()
    assert track.image == f"alb1.webp?pathhash={track.pathhash}&fb=track"


def test_album_image_stays_bare():
    # The album keeps the record placeholder: same file, no fb param.
    from swingmusic.models.album import Album

    album = Album(
        albumartists=[{"name": "Toshiro Masuda", "artisthash": "ah1"}],
        albumhash="alb1",
        artisthashes=["ah1"],
        base_title="Naruto Original Soundtrack II",
        color="",
        created_date=0,
        date=1032739200,
        duration=4000,
        genres=[],
        genrehashes=[],
        og_title="Naruto Original Soundtrack II",
        title="Naruto Original Soundtrack II",
        trackcount=22,
        lastplayed=0,
        playcount=0,
        playduration=0,
        extra={},
        pathhash="ph1",
    )

    assert album.image == "alb1.webp?pathhash=ph1"
    assert "fb=" not in album.image
