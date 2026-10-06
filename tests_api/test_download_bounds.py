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

import io
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


class TestStreamed:
    """
    ⚠️ Asserted on the RESPONSE, not by grepping the source. An earlier version
    checked that the string "BytesIO" no longer appears in download.py — and went
    red against the fixed code, because the comment explaining what was removed
    contains the word. A census that matches its own documentation measures
    nothing.

    The archive is produced while it is sent (#295): built up front — in RAM
    once, later in a temp file — it held the server's one request thread for as
    long as copying the files took, and every listener's playback with it.
    """

    @staticmethod
    def _build(download, tracks, name="album.zip"):
        from flask import Flask

        app = Flask(__name__)

        with app.test_request_context():
            return download._zip_response(download._existing_files(tracks), name)

    def test_nothing_is_read_before_the_first_chunk_is_asked_for(self, library, monkeypatch):
        """THE guard: building the response must not build the archive."""
        download, tracks, _files, _set = library
        opened = []
        real_open = Path.open
        monkeypatch.setattr(Path, "open", lambda self, *a, **k: opened.append(self) or real_open(self, *a, **k))

        res = self._build(download, tracks)

        assert res.is_streamed
        assert opened == [], "the archive was built inside the request"

    def test_a_big_file_goes_out_in_many_small_chunks(self, library, monkeypatch, tmp_path):
        """Each chunk is a point where the server serves the other listeners."""
        download, _tracks, _files, _set = library
        monkeypatch.setattr(download, "CHUNK", 64 * 1024)
        big = tmp_path / "big.flac"
        big.write_bytes(b"y" * (1024 * 1024))

        chunks = list(self._build(download, [SimpleNamespace(filepath=str(big))]).response)

        assert len(chunks) >= 16
        assert max(len(c) for c in chunks) <= 64 * 1024 + 1024, "a chunk held more than one copy step"

    def test_the_archive_still_contains_the_tracks(self, library):
        """Streaming must not change what the user gets — names and bytes (CRC checked)."""
        download, tracks, files, _set = library

        body = b"".join(self._build(download, tracks).response)

        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            assert sorted(zf.namelist()) == sorted(p.name for p in files)
            assert zf.testzip() is None
            assert zf.read(files[0].name) == files[0].read_bytes()

    def test_a_file_gone_since_the_size_check_is_left_out(self, library):
        download, tracks, files, _set = library
        entries = download._existing_files(tracks)
        files[1].unlink()

        from flask import Flask

        with Flask(__name__).test_request_context():
            body = b"".join(download._zip_response(entries, "album.zip").response)

        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            assert sorted(zf.namelist()) == sorted(p.name for p in (files[0], files[2]))

    def test_no_temp_file_is_made(self, library, monkeypatch):
        """Nothing to clean up when a transfer dies halfway — and nothing for Windows to keep locked."""
        import tempfile

        download, tracks, _files, _set = library
        for name in ("NamedTemporaryFile", "TemporaryFile", "mkstemp", "SpooledTemporaryFile"):
            monkeypatch.setattr(tempfile, name, lambda *a, **k: pytest.fail("a temp file was made"))

        assert b"".join(self._build(download, tracks).response)

    def test_a_name_that_is_not_ascii_survives_the_header(self, library):
        download, tracks, _files, _set = library

        res = self._build(download, tracks, name="Die Ärzte.zip")

        disposition = res.headers["Content-Disposition"]
        assert "filename*=UTF-8''Die%20%C3%84rzte.zip" in disposition
        assert 'filename="Die Arzte.zip"' in disposition


class TestThroughTheEndpoint:
    """The real request cycle: route, path model, the streamed body as a client reads it."""

    ALBUM = "0123456789abcdef"

    def test_an_album_downloads_as_a_complete_archive(self, library, api_client, monkeypatch):
        download, _tracks, files, _set = library
        tracks = [
            SimpleNamespace(
                trackhash=f"h{i}", albumhash=self.ALBUM, filepath=str(p), disc=1, track=i, album="Album", bitrate=320
            )
            for i, p in enumerate(files)
        ]
        monkeypatch.setattr(download.TrackStore, "trackhashmap", {})
        for t in tracks:
            download.TrackStore.add_track(t)
        monkeypatch.setattr(
            download.AlbumStore, "albummap", {self.ALBUM: SimpleNamespace(trackhashes={t.trackhash for t in tracks})}
        )

        res = api_client("aivinnet.api.download").get(f"/download/album/{self.ALBUM}")

        assert res.status_code == 200
        assert res.headers["Content-Type"] == "application/zip"
        assert res.headers["Content-Disposition"] == "attachment; filename=Album.zip"
        with zipfile.ZipFile(io.BytesIO(res.data)) as zf:
            assert len(zf.namelist()) == 3
            assert zf.testzip() is None

    def test_an_unknown_album_is_404(self, library, api_client, monkeypatch):
        download, *_ = library
        monkeypatch.setattr(download.AlbumStore, "albummap", {})

        res = api_client("aivinnet.api.download").get(f"/download/album/{self.ALBUM}")

        assert res.status_code == 404
