"""The Content-Type the stream endpoint sends for each audio format.

Browsers measured on 2026-10-04 played or refused files by codec alone, so a
wrong header does not break playback today — but it is still a wrong answer,
and it must not depend on whether the image ships /etc/mime.types.
"""

import mimetypes
from unittest.mock import patch

import pytest

from aivinnet.utils.files import AUDIO_MIME_TYPES, guess_mime_type
from aivinnet.utils.filesystem import FILES


@pytest.fixture()
def bare_mimetypes():
    """`mimetypes` as it is in the `python:3.11-slim` image: no /etc/mime.types,
    only Python's built-in table — which knows neither .m4a nor .flac."""
    db = mimetypes.MimeTypes(filenames=())
    with patch.object(mimetypes, "guess_type", db.guess_type):
        yield


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("/music/a.m4a", "audio/mp4"),
        ("/music/a.flac", "audio/flac"),
        ("/music/a.mp3", "audio/mpeg"),
        ("/music/a.ogg", "audio/ogg"),
        ("/music/a.opus", "audio/ogg"),
        ("/music/A.M4A", "audio/mp4"),
    ],
)
def test_audio_types_do_not_depend_on_the_system_table(bare_mimetypes, filename, expected):
    assert guess_mime_type(filename) == expected


def test_the_bare_table_really_lacks_m4a(bare_mimetypes):
    # Guards the fixture: if Python's built-in table ever learns .m4a, the test
    # above stops proving anything about the slim image.
    assert mimetypes.guess_type("a.m4a")[0] is None


def test_every_indexed_format_has_a_type():
    # A format the indexer accepts but this table misses falls back to
    # `audio/<ext>`, which is not a registered type for most extensions.
    assert set(FILES) <= set(AUDIO_MIME_TYPES)
