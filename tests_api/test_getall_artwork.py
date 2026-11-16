"""GET /getall/<itemtype>?artwork=true answers `has_artwork` per item.

Home's record crates ask for it instead of probing every cover with a HEAD
request of their own (the server answers one request at a time). Pinned here,
through the real request cycle:

1. The flag for each shape of artwork on disk: a medium file, only a smaller
   size from an embedded-art scan, nothing, a cover the user removed, and a
   cover that only the image server's folder lookup finds ("Front Cover.JPG"
   beside "Back.jpg" — names the scanner's own folder-cover rule does not take),
   and an album whose music folder is gone (it answered 500 before).
2. The consistency guard: for every item, the image URL the client loads
   answers with the placeholder header exactly when `has_artwork` is false.
   Both read `lib/artwork.find_image`; this is the test that goes red if one
   of them stops doing so.
3. Without `artwork` the field is absent (the album list and the search
   browser do not pay for it), above 50 items the request is refused, and a
   file system error is "no artwork" for the list and the image alike.

The query says `artwork=true`, as the client sends it.

Real Paths on the throwaway config dir (conftest), real image server, real
serializers, real `Album`/`Track` objects and map entries. Album `image` keeps
its `?pathhash=` suffix.
"""

import pytest

from aivinnet.store.albums import AlbumMapEntry
from aivinnet.store.artists import ArtistMapEntry

PLACEHOLDER = "X-Aivinnet-Placeholder"

ALBUM_MEDIUM = "artworkalbmedium"
ALBUM_SMALL_ONLY = "artworkalbsmall0"
ALBUM_NO_FILES = "artworkalbnone00"
ALBUM_REMOVED = "artworkalbremovd"
ALBUM_CACHED = "artworkalbcached"
ALBUM_FOLDER_COVER = "artworkalbfolder"
ARTIST_MEDIUM = "artworkartmedium"
ARTIST_NO_FILE = "artworkartnone00"
PATHHASH = "ph00000001"
FOLDER_TRACK = "artworkfoldertrk"
ALBUM_FOLDER_GONE = "artworkalbgone00"
GONE_TRACK = "artworkgonetrack"


def _album(albumhash: str, pathhash: str = PATHHASH):
    from aivinnet.models.album import Album

    return Album(
        albumartists=[{"name": "Api Artist", "artisthash": "artworkartist000"}],
        albumhash=albumhash,
        artisthashes=[],
        base_title="Api Album",
        color="",
        created_date=1_700_000_000,
        date=1_600_000_000,
        duration=60,
        genres=[],
        genrehashes=[],
        og_title="Api Album",
        title="Api Album",
        trackcount=1,
        lastplayed=0,
        playcount=0,
        playduration=0,
        extra={},
        pathhash=pathhash,
    )


def _artist(artisthash: str):
    from aivinnet.models.artist import Artist

    return Artist(
        name="Api Artist " + artisthash,
        albumcount=1,
        artisthash=artisthash,
        created_date=1_700_000_000,
        date=0,
        duration=60,
        genres=[],
        genrehashes=[],
        trackcount=1,
        lastplayed=0,
        playcount=0,
        playduration=0,
        extra={},
    )


def _track_in(folder: str, albumhash: str, trackhash: str):
    from aivinnet.config import UserConfig
    from aivinnet.models.track import Track

    return Track(
        id=1,
        album="Api Album",
        albumartists="Api Artist",
        albumhash=albumhash,
        artists="Api Artist",
        bitrate=320,
        copyright="",
        date=1_600_000_000,
        disc=1,
        duration=60,
        filepath=f"{folder}/01 - Song.mp3",
        folder=folder,
        genres="",
        last_mod=1_700_000_000,
        title="Song",
        track=1,
        trackhash=trackhash,
        extra={},
        lastplayed=0,
        playcount=0,
        playduration=0,
        config=UserConfig(),
        added=1_700_000_000,
    )


@pytest.fixture()
def library(monkeypatch, tmp_path):
    """Albums and artists in the stores, real artwork files on the real Paths."""
    import aivinnet.api.imgserver as imgserver
    from aivinnet.lib.coverart import _album_cover_tombstone
    from aivinnet.settings import Paths
    from aivinnet.store.albums import AlbumStore
    from aivinnet.store.artists import ArtistStore
    from aivinnet.store.tracks import TrackGroup, TrackStore

    paths = Paths()
    files = [
        paths.md_thumb_path / f"{ALBUM_MEDIUM}.webp",
        paths.sm_thumb_path / f"{ALBUM_SMALL_ONLY}.webp",
        # Served once from the album folder: the image server cached it.
        paths.image_cache_path / paths.md_thumb_path.name / f"{ALBUM_CACHED}.webp",
        paths.md_artist_img_path / f"{ARTIST_MEDIUM}.webp",
    ]
    tombstone = _album_cover_tombstone(ALBUM_REMOVED)
    for path in files:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"not-a-real-webp-but-a-file")
    tombstone.parent.mkdir(parents=True, exist_ok=True)
    tombstone.write_bytes(b"")
    # The placeholders the image server falls back to. A fresh config dir has
    # none, and a missing one answers 404 without the marker header.
    placeholders = [paths.assets_path / "default.webp", paths.assets_path / "artist.webp"]
    created = []
    for path in placeholders:
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"placeholder")
            created.append(path)

    # An album whose only cover sits in its music folder under names the
    # scanner does not take as a cover: no thumbnail was ever extracted.
    music = tmp_path / "music" / "Api Artist" / "Api Album"
    music.mkdir(parents=True)
    # Upper-case extension, as Windows rippers write it.
    (music / "Front Cover.JPG").write_bytes(b"jpeg-bytes")
    (music / "Back.jpg").write_bytes(b"jpeg-bytes")
    # A directory that looks like the best-ranked cover: it is no image, and
    # serving it would fail.
    (music / "Cover.jpg").mkdir()
    track = _track_in(music.as_posix(), ALBUM_FOLDER_COVER, FOLDER_TRACK)
    # An album whose music folder has gone since the scan (moved, NAS offline).
    gone = _track_in((tmp_path / "music" / "Moved Away").as_posix(), ALBUM_FOLDER_GONE, GONE_TRACK)
    monkeypatch.setattr(TrackStore, "trackhashmap", {FOLDER_TRACK: TrackGroup([track]), GONE_TRACK: TrackGroup([gone])})
    # Serving the folder cover caches its thumbnails in the background; not
    # this test's subject, and a thread writing into the config dir after the
    # test ended would outlive the fixture.
    cached = []
    monkeypatch.setattr(imgserver, "cache_thumbnails", lambda path, albumhash: cached.append((path.name, albumhash)))

    albums = {
        h: AlbumMapEntry(album=_album(h), trackhashes=set())
        for h in (ALBUM_MEDIUM, ALBUM_SMALL_ONLY, ALBUM_NO_FILES, ALBUM_REMOVED, ALBUM_CACHED)
    }
    albums[ALBUM_FOLDER_COVER] = AlbumMapEntry(
        album=_album(ALBUM_FOLDER_COVER, track.pathhash), trackhashes={FOLDER_TRACK}
    )
    albums[ALBUM_FOLDER_GONE] = AlbumMapEntry(album=_album(ALBUM_FOLDER_GONE, gone.pathhash), trackhashes={GONE_TRACK})
    monkeypatch.setattr(AlbumStore, "albummap", albums)
    monkeypatch.setattr(
        ArtistStore,
        "artistmap",
        {
            h: ArtistMapEntry(artist=_artist(h), albumhashes=set(), trackhashes=set())
            for h in (ARTIST_MEDIUM, ARTIST_NO_FILE)
        },
    )

    yield cached

    for path in [*files, tombstone, *created]:
        path.unlink(missing_ok=True)


@pytest.fixture()
def getall(api_client, library):
    return api_client("aivinnet.api.getall")


@pytest.fixture()
def images(api_client, library):
    return api_client("aivinnet.api.imgserver")


def _items(getall, itemtype: str, query: str = "limit=50&artwork=true") -> dict:
    res = getall.get(f"/getall/{itemtype}?{query}")
    assert res.status_code == 200
    return {item["albumhash" if itemtype == "albums" else "artisthash"]: item for item in res.json["items"]}


@pytest.mark.parametrize(
    ("albumhash", "expected"),
    [
        (ALBUM_MEDIUM, True),
        # Embedded art only: the image server falls back to the small size.
        (ALBUM_SMALL_ONLY, True),
        (ALBUM_NO_FILES, False),
        (ALBUM_REMOVED, False),
        (ALBUM_CACHED, True),
        # Found only by the image server's look into the album folder.
        (ALBUM_FOLDER_COVER, True),
        # The folder cannot be listed: no cover, the placeholder.
        (ALBUM_FOLDER_GONE, False),
    ],
)
def test_album_flag_per_shape_of_artwork(getall, albumhash, expected):
    assert _items(getall, "albums")[albumhash]["has_artwork"] is expected


@pytest.mark.parametrize(("artisthash", "expected"), [(ARTIST_MEDIUM, True), (ARTIST_NO_FILE, False)])
def test_artist_flag(getall, artisthash, expected):
    assert _items(getall, "artists")[artisthash]["has_artwork"] is expected


def test_the_flag_caches_nothing(getall, library):
    """Asking is reading: only serving the folder cover caches its thumbnails."""
    _items(getall, "albums")
    assert library == []


@pytest.mark.parametrize(
    ("itemtype", "url_for"),
    [
        ("albums", lambda item: f"/img/thumbnail/medium/{item['image']}"),
        ("artists", lambda item: f"/img/artist/medium/{item['image']}"),
    ],
)
def test_the_flag_agrees_with_what_the_image_server_serves(getall, images, itemtype, url_for):
    """The guard: the flag is true exactly when the image URL answers with real artwork."""
    items = _items(getall, itemtype).values()
    assert any(item["has_artwork"] for item in items) and not all(item["has_artwork"] for item in items)
    for item in items:
        res = images.get(url_for(item))
        assert res.status_code == 200, url_for(item)
        served_placeholder = PLACEHOLDER in res.headers
        assert item["has_artwork"] == (not served_placeholder), (item.get("image"), item["has_artwork"])


def test_the_folder_cover_is_served_and_cached_like_before(getall, images, library):
    """The image server kept its own behaviour: it serves the folder file and caches it."""
    item = _items(getall, "albums")[ALBUM_FOLDER_COVER]
    res = images.get(f"/img/thumbnail/medium/{item['image']}")
    assert PLACEHOLDER not in res.headers
    assert res.data == b"jpeg-bytes"
    assert library == [("Front Cover.JPG", ALBUM_FOLDER_COVER)]

    # Another pathhash: no track of the album lives there, so no folder to look into.
    res = images.get(f"/img/thumbnail/medium/{ALBUM_FOLDER_COVER}.webp?pathhash={PATHHASH}")
    assert PLACEHOLDER in res.headers


@pytest.mark.parametrize("itemtype", ["albums", "artists"])
def test_without_the_parameter_there_is_no_flag(getall, itemtype):
    for item in _items(getall, itemtype, "limit=50").values():
        assert "has_artwork" not in item


def test_a_file_system_error_is_no_artwork_for_the_list_and_the_image_alike(getall, images, monkeypatch):
    """An unreadable folder answered the image request with 500; now both say "placeholder"."""
    import aivinnet.lib.artwork as artwork

    def unreadable(*_args, **_kwargs):
        raise PermissionError("thumbnails folder not readable")

    # The first check past "is the medium file there": every album without one hits it.
    monkeypatch.setattr(artwork, "album_cover_removed", unreadable)
    items = _items(getall, "albums")
    assert len(items) == 7
    assert items[ALBUM_MEDIUM]["has_artwork"] is True
    assert items[ALBUM_SMALL_ONLY]["has_artwork"] is False
    res = images.get(f"/img/thumbnail/medium/{items[ALBUM_SMALL_ONLY]['image']}")
    assert res.status_code == 200
    assert PLACEHOLDER in res.headers


def test_an_unknown_item_type_is_404_not_500(getall):
    res = getall.get("/getall/tracks")
    assert res.status_code == 404


def test_an_album_whose_folder_is_gone_gets_the_placeholder_not_a_500(getall, images):
    """`find_thumbnail` raised on the missing folder; the image request answered 500."""
    item = _items(getall, "albums")[ALBUM_FOLDER_GONE]
    res = images.get(f"/img/thumbnail/medium/{item['image']}")
    assert res.status_code == 200
    assert PLACEHOLDER in res.headers


def test_artwork_is_refused_above_fifty_items(getall):
    # Every album without artwork lists its folder on the one request thread.
    assert getall.get("/getall/albums?limit=51&artwork=true").status_code == 422
    assert getall.get("/getall/albums?limit=50&artwork=true").status_code == 200
    # The list itself is not limited by it.
    assert getall.get("/getall/albums?limit=2000").status_code == 200


def test_a_cover_that_cannot_be_opened_gets_the_placeholder_not_a_500(getall, images, monkeypatch):
    """Found, but not readable when sent (permissions, a mount gone since the lookup)."""
    import aivinnet.api.imgserver as imgserver

    real_send = imgserver.send_from_directory

    def send(directory, name, *args, **kwargs):
        if name.endswith(".webp") and "assets" not in str(directory):
            raise PermissionError(f"{name}: permission denied")
        return real_send(directory, name, *args, **kwargs)

    monkeypatch.setattr(imgserver, "send_from_directory", send)
    item = _items(getall, "albums")[ALBUM_MEDIUM]
    res = images.get(f"/img/thumbnail/medium/{item['image']}")
    assert res.status_code == 200
    assert PLACEHOLDER in res.headers


def test_a_missing_folder_is_logged_once_not_per_request(getall, images, caplog):
    import aivinnet.lib.artwork as artwork

    artwork._warned.clear()
    item = _items(getall, "albums")[ALBUM_FOLDER_GONE]
    with caplog.at_level("WARNING", logger="aivinnet.lib.artwork"):
        for _ in range(3):
            images.get(f"/img/thumbnail/medium/{item['image']}")
            _items(getall, "albums")
    warnings = [r for r in caplog.records if "not readable" in r.getMessage()]
    assert len(warnings) == 1
