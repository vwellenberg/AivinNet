"""An archive download must not be sized by the library.

Building a ZIP is the one request whose cost the caller does not set: an album
of game soundtracks is several gigabytes, and a playlist can be the whole
collection. It used to be assembled in an `io.BytesIO` — the entire thing in RAM
before a byte went out, with `ZIP_STORED` so the buffer was roughly the sum of
the files.

Two guards, and both are needed. The limit bounds how long one click can occupy
a server that answers one request at a time. Building on disk bounds the memory
regardless of the limit — a cap alone would still mean "that much RAM at once",
and this ships as an aarch64 AppImage, so a Raspberry Pi is a plausible host.
"""

import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture()
def library(monkeypatch, tmp_path):
    """Three one-kilobyte tracks, and a config knob we can turn."""
    import aivinnet.api.download as download

    files = []
    for i in range(3):
        p = tmp_path / f"{i:02d} track.mp3"
        p.write_bytes(b"x" * 1024)
        files.append(p)

    tracks = [SimpleNamespace(filepath=str(p)) for p in files]

    def set_limit(mb):
        monkeypatch.setattr(download, "UserConfig", lambda: SimpleNamespace(maxDownloadSizeMB=mb))

    set_limit(1024)

    return download, tracks, files, set_limit


class TestTheLimit:
    def test_a_normal_download_is_allowed(self, library):
        download, tracks, _files, _set = library

        oversized, _total, _limit = download._too_large(download._existing_files(tracks))

        assert oversized is False

    def test_going_over_is_refused(self, library):
        """3 KB against a 0-MB-ish limit: the check is on real byte counts."""
        download, tracks, _files, set_limit = library
        set_limit(0.000001)

        oversized, total, limit = download._too_large(download._existing_files(tracks))

        assert oversized is True
        assert total == 3 * 1024
        assert limit < total

    def test_the_refusal_says_what_to_do(self, library):
        download, _tracks, _files, _set = library

        body, status = download._refuse_oversized(5 * 1024 * 1024, 1 * 1024 * 1024)

        assert status == 413
        assert "maxDownloadSizeMB" in body["msg"]
        assert "individually" in body["msg"]

    def test_a_zero_limit_means_no_limit(self, library):
        """So an admin can turn the cap off rather than guess a huge number."""
        download, tracks, _files, set_limit = library
        set_limit(0)

        oversized, _total, _limit = download._too_large(download._existing_files(tracks))

        assert oversized is False

    def test_missing_files_are_skipped_not_counted(self, library):
        download, tracks, files, _set = library
        files[0].unlink()

        paths = download._existing_files(tracks)
        _oversized, total, _limit = download._too_large(paths)

        assert len(paths) == 2
        assert total == 2 * 1024


class TestBuiltOnDisk:
    """
    ⚠️ Asserted on the RESPONSE, not by grepping the source. The first version of
    this checked that the string "BytesIO" no longer appears in download.py — and
    went red against the fixed code, because the comment explaining what was
    removed contains the word. A census that matches its own documentation
    measures nothing.
    """

    @staticmethod
    def _build(download, tracks, name="album.zip"):
        from flask import Flask

        app = Flask(__name__)

        with app.test_request_context():
            return download._zip_response(download._existing_files(tracks), name)

    def test_the_archive_is_backed_by_a_real_file(self, library):
        """
        THE guard: an in-memory buffer is what made a 4 GB album a 4 GB
        allocation. A real file has a descriptor; a BytesIO does not.
        """
        import io

        download, tracks, _files, _set = library

        res = self._build(download, tracks)
        backing = res.response.file

        assert not isinstance(backing, io.BytesIO)
        assert backing.fileno() > 0, "expected a file on disk, not a memory buffer"

    def test_the_archive_still_contains_the_tracks(self, library):
        """Building on disk must not change what the user gets."""
        download, tracks, files, _set = library

        res = self._build(download, tracks)

        with zipfile.ZipFile(res.response.file) as zf:
            assert sorted(zf.namelist()) == sorted(p.name for p in files)

    def test_no_temp_file_is_left_behind(self, library):
        """
        On POSIX the temp file is unlinked while still open, so the data lives
        only as long as the response does — nothing to clean up even if the
        transfer dies halfway.
        """
        download, tracks, _files, _set = library

        res = self._build(download, tracks)
        leftover = Path(res.response.file.name)

        assert not leftover.exists(), f"{leftover} survived the response"
