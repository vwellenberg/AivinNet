"""Reading an artist and a title out of a file name, when the tags have neither.

The live case: "Saving Private Ryan", ten files named `01 - Hymn to the Fallen.mp3`
with a title tag but no artist and no album artist. Read as "Artist - Title",
the track number became the artist — `01`, `02` … `10` — and because the album
artist goes into the albumhash, every track became an album of its own.
Manor Lords (22 files), Evil Genius and Mavi had the same shape.
"""

import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

# Pillow is not in the fast lane; guarded, as in test_folder_cover.py.
for mod_name in ["PIL", "tinytag"]:
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

import pytest  # noqa: E402

from aivinnet.lib.taglib import extract_artist_title  # noqa: E402

CONFIG = SimpleNamespace(artistSeparators=[",", ";", "/", "&"], artistSplitIgnoreList=[])


class TestALeadingNumberIsATrackNumber:
    @pytest.mark.parametrize(
        "stem,title",
        [
            ("01 - Hymn to the Fallen", "Hymn to the Fallen"),
            ("10 - Hymn to the Fallen (Reprise)", "Hymn to the Fallen (Reprise)"),
            # Three digits: the Zelda soundtracks number across both discs.
            ("147 - Get Orb", "Get Orb"),
        ],
    )
    def test_it_is_not_an_artist(self, stem, title):
        parsed = extract_artist_title(stem, CONFIG)

        assert parsed.artist == []
        assert parsed.title == title


class TestWhatStillReadsAsArtistAndTitle:
    def test_artist_dash_title(self):
        parsed = extract_artist_title("U2 - One Tree Hill", CONFIG)

        assert parsed.artist == ["U2"]
        assert parsed.title == "One Tree Hill"

    def test_number_artist_title(self):
        parsed = extract_artist_title("09 - U2 - One Tree Hill", CONFIG)

        assert parsed.artist == ["U2"]
        assert parsed.title == "One Tree Hill"

    def test_a_name_that_only_starts_with_digits_is_still_an_artist(self):
        # "10cc", "50 Cent": digits, but not only digits.
        parsed = extract_artist_title("10cc - Dreadlock Holiday", CONFIG)

        assert parsed.artist == ["10cc"]
        assert parsed.title == "Dreadlock Holiday"
