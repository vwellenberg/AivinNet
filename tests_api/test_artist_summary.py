"""Request-cycle tests for `GET /artist/<hash>/summary`.

The route exists for one reason: `GET /artist/<hash>` is expensive and the Now
Playing panel asks on every artist change. So the interesting assertion is not
"it returns the counts" but **"it never touches the track store"** — a summary
that quietly loaded every track of the artist would look identical in its
response and still block the app's only thread.
"""

import dataclasses

import pytest


def _artist(**overrides):
    """A real `Artist`, so the serializer is exercised, not a stand-in for it."""
    from aivinnet.models.artist import Artist

    fields = {
        "name": "Peter Gabriel",
        "albumcount": 12,
        "artisthash": "9d24d526ac9192b1",
        "created_date": 0,
        "date": 0,
        "duration": 42_000,
        "genres": [{"name": "Art Rock", "genrehash": "artrock"}],
        "genrehashes": ["artrock"],
        "trackcount": 999,  # deliberately WRONG, see the trackcount test
        "lastplayed": 1_700_000_000,
        "playcount": 184,
        "playduration": 60_000,
        "extra": {},
        # Whatever is passed here is discarded: `Artist.__post_init__` derives
        # the image from the hash. Kept as a wrong value on purpose so the test
        # below documents that, rather than agreeing with it by accident.
        "image": "ignored.webp",
        "color": "#123456",
    }
    fields.update(overrides)
    return Artist(**fields)


def _entry(artist=None, trackcount=143):
    """A REAL `ArtistMapEntry`, not a stand-in.

    An earlier version of this file used a two-attribute fake here. It passed
    every test while binding the route to nothing: renaming `trackhashes` on the
    real class would have kept the suite green and 500'd in production.
    """
    from aivinnet.store.artists import ArtistMapEntry

    return ArtistMapEntry(
        artist=artist if artist is not None else _artist(),
        albumhashes={f"album-{i}" for i in range(12)},
        trackhashes={f"track-{i}" for i in range(trackcount)},
    )


@pytest.fixture()
def artist_api(api_client, monkeypatch):
    """The real artist blueprint with a one-entry artist map."""
    import aivinnet.api.artist as artist_api_module

    entry = _entry()
    monkeypatch.setattr(artist_api_module.ArtistStore, "artistmap", {"9d24d526ac9192b1": entry})

    # No JWT context in this lane, so `is_favorite` (which reads the current
    # user) would raise. The property is on the class, so it is patched there.
    monkeypatch.setattr(type(entry.artist), "is_favorite", property(lambda self: False))

    return api_client("aivinnet.api.artist"), entry


def test_returns_counts_and_genres(artist_api):
    api, _ = artist_api

    res = api.get("/artist/9d24d526ac9192b1/summary")

    assert res.status_code == 200
    artist = res.get_json()["artist"]
    assert artist["name"] == "Peter Gabriel"
    assert artist["albumcount"] == 12
    assert artist["genres"] == [{"name": "Art Rock", "genrehash": "artrock"}]


def test_image_is_derived_from_the_hash(artist_api):
    """`Artist.__post_init__` sets `image = artisthash + ".webp"` and ignores
    whatever was passed in. The panel therefore never has to guess a filename —
    and a client that builds its own would drift the moment this changes."""
    api, _ = artist_api

    artist = api.get("/artist/9d24d526ac9192b1/summary").get_json()["artist"]

    assert artist["image"] == "9d24d526ac9192b1.webp"


def test_includes_the_play_counters_the_panel_asks_for(artist_api):
    """`serialize_for_card` strips these by default — the panel is why they are
    requested back, so a regression there must fail here."""
    api, _ = artist_api

    artist = api.get("/artist/9d24d526ac9192b1/summary").get_json()["artist"]

    assert artist["playcount"] == 184
    assert artist["lastplayed"] == 1_700_000_000


def test_trackcount_counts_the_indexed_hashes_not_the_stored_field(artist_api):
    """The fixture's artist carries `trackcount = 999` while its entry indexes
    143 hashes. The answer must come from what the store actually indexed."""
    api, entry = artist_api

    artist = api.get("/artist/9d24d526ac9192b1/summary").get_json()["artist"]

    assert len(entry.trackhashes) == 143
    assert artist["trackcount"] == 143


def test_does_none_of_the_expensive_work_the_artist_page_does(artist_api, monkeypatch):
    """The whole point of the route.

    `GET /artist/<hash>` loads the tracks, sorts them by playcount, computes
    group stats and fetches the albums. On a single-threaded server every one of
    those is playback-blocking work for a caller that only wants two numbers, so
    each is asserted separately — guarding just the track load would let the
    other three creep back in.
    """
    import aivinnet.api.artist as artist_api_module

    api, _ = artist_api
    called: list[str] = []

    monkeypatch.setattr(
        artist_api_module.TrackStore,
        "get_tracks_by_trackhashes",
        lambda *a, **k: called.append("load_tracks") or [],
    )
    monkeypatch.setattr(artist_api_module, "sort_tracks", lambda *a, **k: called.append("sort") or [])
    monkeypatch.setattr(artist_api_module, "get_track_group_stats", lambda *a, **k: called.append("stats") or [])
    # `raising=True` on purpose: with raising=False a renamed method would be
    # patched onto nothing and this test would pass while guarding nothing.
    # (It was written as `get_albums_by_albumhash` first — the real name is
    # `get_albums_by_hashes`, and only the strict setattr said so.)
    monkeypatch.setattr(
        artist_api_module.AlbumStore,
        "get_albums_by_hashes",
        lambda *a, **k: called.append("load_albums") or [],
    )

    assert api.get("/artist/9d24d526ac9192b1/summary").status_code == 200
    assert called == []


def test_unknown_artist_is_404(artist_api):
    api, _ = artist_api

    # A well-formed hash that nothing is stored under.
    res = api.get("/artist/0000000000000000/summary")

    assert res.status_code == 404
    assert res.get_json()["error"] == "Artist not found"


def test_a_malformed_hash_is_rejected_before_the_handler(artist_api):
    """`ArtistHashSchema` requires 16 characters, so a short hash never reaches
    the handler — it is a 422 from validation, not a 404 from the store.

    Written down because the first version of these tests used "pg-hash" as a
    fixture hash and every single one failed with 422: the shape of the request
    is part of the endpoint, and only a real request cycle shows it.
    """
    api, _ = artist_api

    res = api.get("/artist/short/summary")

    assert res.status_code == 422
    assert res.get_json()[0]["loc"] == ["artisthash"]


def test_serves_every_field_the_panel_renders(artist_api):
    """Named against the payload the panel actually draws, not against another
    call to the same serializer — a test built from the implementation agrees
    with it by construction and catches nothing."""
    api, _ = artist_api

    artist = api.get("/artist/9d24d526ac9192b1/summary").get_json()["artist"]

    assert {
        "name",
        "artisthash",
        "image",
        "albumcount",
        "trackcount",
        "genres",
        "playcount",
        "lastplayed",
        "is_favorite",
    } <= set(artist)


def test_genres_carry_the_same_decade_chip_as_the_artist_page(artist_api, monkeypatch):
    """The artist page prepends a decade chip built from `artist.date`. The panel
    sits next to that page, so a chip on one and not the other reads as a bug.
    Both call `genres_with_decade`; this pins the behaviour through the route."""
    import aivinnet.api.artist as artist_api_module

    api, entry = artist_api
    # 1986-01-01, i.e. the "80s" chip.
    monkeypatch.setattr(entry.artist, "date", 504_921_600)

    artist = api.get("/artist/9d24d526ac9192b1/summary").get_json()["artist"]

    assert artist["genres"][0] == {"name": "80s", "genrehash": "80s"}
    assert artist["genres"][1]["name"] == "Art Rock"
    assert artist_api_module.genres_with_decade(entry.artist) == artist["genres"]


def test_an_unknown_date_adds_no_decade_chip(artist_api):
    """The fixture's artist has `date = 0`, which means "unknown" — not 1970."""
    api, _ = artist_api

    artist = api.get("/artist/9d24d526ac9192b1/summary").get_json()["artist"]

    assert artist["genres"] == [{"name": "Art Rock", "genrehash": "artrock"}]


def test_artist_dataclass_still_has_the_fields_the_route_reads():
    """A rename in `models/artist.py` would otherwise surface as a KeyError in
    the client, one layer too late."""
    from aivinnet.models.artist import Artist

    names = {f.name for f in dataclasses.fields(Artist)}

    assert {"albumcount", "genres", "playcount", "lastplayed", "image", "color"} <= names
