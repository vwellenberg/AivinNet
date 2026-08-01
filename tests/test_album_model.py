"""Tests for Album model type detection."""

import sys
from unittest.mock import MagicMock

# Mock heavy dependencies before importing swingmusic modules
for mod_name in [
    "flask_jwt_extended",
    "flask",
    "flask_cors",
    "flask_compress",
    "flask_openapi3",
    "PIL",
    "colorgram",
    "tqdm",
    "tinytag",
    "psutil",
    "show_in_file_manager",
    "tabulate",
    "setproctitle",
    "locust",
    "watchdog",
    "sqlalchemy",
    "sortedcontainers",
    "ffmpeg",
    "schedule",
    "pystray",
    "rapidfuzz",
]:
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

from swingmusic.models.album import Album  # noqa: E402
from swingmusic.utils.hashing import create_hash  # noqa: E402


def make_album(title: str, albumartists: list[str] | None = None, trackcount: int = 10) -> Album:
    """Helper to create Album instances for testing."""
    if albumartists is None:
        albumartists = [{"name": "Test Artist", "artisthash": create_hash("Test Artist")}]
    else:
        albumartists = [{"name": a, "artisthash": create_hash(a)} for a in albumartists]

    return Album(
        albumartists=albumartists,
        albumhash=create_hash(title),
        artisthashes=[a["artisthash"] for a in albumartists],
        base_title=title,
        color="#000000",
        created_date=0,
        date=2024,
        duration=3600,
        genres=[],
        genrehashes=[],
        og_title=title,
        title=title,
        trackcount=trackcount,
        lastplayed=0,
        playcount=0,
        playduration=0,
        extra={},
    )


def make_mock_track(title: str):
    """Create a minimal mock track for album type checking."""

    class MockTrack:
        def __init__(self, title):
            self.title = title

    return MockTrack(title)


class TestAlbumIsSoundtrack:
    def test_soundtrack_keyword(self):
        album = make_album("The Lion King (Original Motion Picture Soundtrack)")
        assert album.is_soundtrack() is True

    def test_soundtrack_word(self):
        album = make_album("Guardians of the Galaxy Soundtrack")
        assert album.is_soundtrack() is True

    def test_the_album_suffix(self):
        album = make_album("Spider-Man: Into the Spider-Verse The Album")
        assert album.is_soundtrack() is True

    def test_normal_album_not_soundtrack(self):
        album = make_album("Abbey Road")
        assert album.is_soundtrack() is False


class TestAlbumIsCompilation:
    def test_various_artists(self):
        album = make_album("Now That's What I Call Music", albumartists=["Various Artists"])
        assert album.is_compilation() is True

    def test_greatest_hits(self):
        album = make_album("Greatest Hits")
        assert album.is_compilation() is True

    def test_best_of(self):
        album = make_album("Best of Beatles")
        assert album.is_compilation() is True

    def test_the_essential(self):
        album = make_album("The Essential Michael Jackson")
        assert album.is_compilation() is True

    def test_normal_album_not_compilation(self):
        album = make_album("Thriller")
        assert album.is_compilation() is False


class TestAlbumIsLiveAlbum:
    def test_live_at(self):
        album = make_album("Live at Wembley")
        assert album.is_live_album() is True

    def test_live_from(self):
        album = make_album("Live from Madison Square Garden")
        assert album.is_live_album() is True

    def test_mtv_unplugged(self):
        album = make_album("MTV Unplugged")
        assert album.is_live_album() is True

    def test_normal_album_not_live(self):
        album = make_album("Let It Be")
        assert album.is_live_album() is False


class TestAlbumIsEP:
    def test_ep_suffix(self):
        album = make_album("My Songs EP")
        assert album.is_ep() is True

    def test_no_ep(self):
        album = make_album("My Songs")
        assert album.is_ep() is False

    def test_ep_in_middle_not_detected(self):
        album = make_album("EP1 Remixes")
        assert album.is_ep() is False


class TestAlbumIsSingle:
    def test_single_version_keyword(self):
        album = make_album("Song (Single Version)")
        tracks = [make_mock_track("Song")]
        assert album.is_single(tracks, singleTrackAsSingle=False) is True

    def test_dash_single_keyword(self):
        album = make_album("Song - Single")
        tracks = [make_mock_track("Song")]
        assert album.is_single(tracks, singleTrackAsSingle=False) is True

    def test_single_track_as_single_enabled(self):
        album = make_album("Song", trackcount=1)
        tracks = [make_mock_track("Song")]
        assert album.is_single(tracks, singleTrackAsSingle=True) is True

    def test_single_track_matching_title(self):
        album = make_album("My Song", trackcount=1)
        tracks = [make_mock_track("My Song")]
        assert album.is_single(tracks, singleTrackAsSingle=False) is True

    def test_multi_track_not_single(self):
        album = make_album("Full Album", trackcount=12)
        tracks = [make_mock_track(f"Track {i}") for i in range(12)]
        assert not album.is_single(tracks, singleTrackAsSingle=False)


class TestAlbumToggleFavorite:
    def test_add_favorite(self):
        album = make_album("Test")
        album.toggle_favorite_user(1)
        assert 1 in album.fav_userids

    def test_remove_favorite(self):
        album = make_album("Test")
        album.fav_userids = [1]
        album.toggle_favorite_user(1)
        assert 1 not in album.fav_userids

    def test_toggle_idempotent(self):
        album = make_album("Test")
        album.toggle_favorite_user(1)
        album.toggle_favorite_user(1)
        assert 1 not in album.fav_userids
