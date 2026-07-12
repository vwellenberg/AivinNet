"""Shared test fixtures for SubspaceRadio."""

import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

# Add src to path so we can import swingmusic modules without full install
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

# Pre-import the real libraries when they are installed. Several test
# modules install a MagicMock into sys.modules for these ONLY as a fallback
# (`if name not in sys.modules`), so loading the real ones first lets tests
# that need the real thing (test_tag_writer_roundtrip for mutagen/tinytag,
# test_playlistlib_cleanup for sqlalchemy via the store/db import chain) run
# in the same session without those fallback mocks shadowing them. In the
# fast CI lane, where a dep is not installed, the import fails and the mocks
# apply exactly as before.
for _real_lib in ("mutagen", "tinytag", "sqlalchemy"):
    try:
        __import__(_real_lib)
    except ImportError:
        pass


@dataclass
class MockUserConfig:
    """Lightweight UserConfig substitute for testing without filesystem/singleton side effects."""

    artistSeparators: set[str] = field(default_factory=lambda: {";", "/", "&"})
    artistSplitIgnoreList: set[str] = field(default_factory=lambda: {"AC/DC", "Earth, Wind & Fire"})
    genreSeparators: set[str] = field(default_factory=lambda: {"/", ";", "&"})
    extractFeaturedArtists: bool = True
    removeProdBy: bool = True
    removeRemasterInfo: bool = True
    cleanAlbumTitle: bool = True
    mergeAlbums: bool = False
    showAlbumsAsSingles: bool = False


@pytest.fixture
def config():
    return MockUserConfig()


@pytest.fixture
def config_no_ignore():
    return MockUserConfig(artistSplitIgnoreList=set())


@pytest.fixture
def config_multiword_ignore():
    # Multi-word, case-insensitive ignore entry (a band name that itself contains
    # a separator). Used to verify split_artists matches case-insensitively but
    # preserves the original input casing of the match.
    return MockUserConfig(artistSplitIgnoreList={"AC/DC", "Bob marley & the wailers"})
