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
        "image": "pg.webp",
        "color": "#123456",
    }
    fields.update(overrides)
    return Artist(**fields)


class _Entry:
    """Stands in for `ArtistMapEntry` — same two attributes the route reads."""

    def __init__(self, artist, trackhashes):
        self.artist = artist
        self.trackhashes = trackhashes


@pytest.fixture()
def artist_api(api_client, monkeypatch):
    """The real artist blueprint with a one-entry artist map."""
    import aivinnet.api.artist as artist_api_module

    entry = _Entry(_artist(), {f"track-{i}" for i in range(143)})
    monkeypatch.setattr(artist_api_module.ArtistStore, "artistmap", {"9d24d526ac9192b1": entry}, raising=False)

    # No JWT context in this lane, so `is_favorite` (which reads the current
    # user) would raise. The property is on the class, so it is patched there.
    monkeypatch.setattr(type(entry.artist), "is_favorite", property(lambda self: False), raising=False)

    return api_client("aivinnet.api.artist"), entry


def test_returns_counts_and_genres(artist_api):
    api, _ = artist_api

    res = api.get("/artist/9d24d526ac9192b1/summary")

    assert res.status_code == 200
    artist = res.get_json()["artist"]
    assert artist["name"] == "Peter Gabriel"
    assert artist["albumcount"] == 12
    assert artist["image"] == "pg.webp"
    assert artist["genres"] == [{"name": "Art Rock", "genrehash": "artrock"}]


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


def test_never_loads_tracks(artist_api, monkeypatch):
    """The whole point of the route. `GET /artist/<hash>` calls
    `TrackStore.get_tracks_by_trackhashes` and then sorts, stats and fetches
    albums; on a single-threaded server that is playback-blocking work for a
    caller that only wants two numbers."""
    import aivinnet.api.artist as artist_api_module

    api, _ = artist_api
    calls = []

    monkeypatch.setattr(
        artist_api_module.TrackStore,
        "get_tracks_by_trackhashes",
        lambda *a, **k: calls.append(a) or [],
        raising=False,
    )

    assert api.get("/artist/9d24d526ac9192b1/summary").status_code == 200
    assert calls == []


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


def test_summary_is_a_strict_subset_of_the_full_artist_payload(artist_api):
    """Guards against the two routes drifting into different field names for the
    same thing — the panel and the artist page must not disagree."""
    from aivinnet.serializers.artist import serialize_for_card

    api, entry = artist_api

    artist = api.get("/artist/9d24d526ac9192b1/summary").get_json()["artist"]
    full_keys = set(serialize_for_card(entry.artist, include={"playcount", "lastplayed", "genres"}).keys()) | {
        "trackcount",
        "albumcount",
        "is_favorite",
    }

    assert set(artist).issubset(full_keys)
    # And the fields the panel renders are all actually there.
    assert {"name", "image", "albumcount", "trackcount", "genres", "playcount", "lastplayed"} <= set(artist)


def test_artist_dataclass_still_has_the_fields_the_route_reads():
    """A rename in `models/artist.py` would otherwise surface as a KeyError in
    the client, one layer too late."""
    from aivinnet.models.artist import Artist

    names = {f.name for f in dataclasses.fields(Artist)}

    assert {"albumcount", "genres", "playcount", "lastplayed", "image", "color"} <= names
