"""Tests for album_cover_edit: file selection, per-file reporting and rollback.

``album_cover_edit`` imports the in-memory stores at module level, which drag in
SQLAlchemy. Same approach as ``test_track_edit_rollback``: third-party deps are
mocked globally, the heavy aivinnet leaf modules only for the duration of the
import, so the real modules stay available to the rest of the session.

The interesting behaviour here is what happens when a single file misbehaves:
the album must not abort, the bad file must be reported (never silently skipped),
and its bytes must be exactly what they were before.
"""

import sys
from unittest.mock import MagicMock, patch

for _mod in [
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
    "sqlalchemy.orm",
    "sortedcontainers",
    "ffmpeg",
    "schedule",
    "pystray",
    "rapidfuzz",
    "mutagen",
]:
    sys.modules.setdefault(_mod, MagicMock())

_SWING_MOCKS = {
    name: MagicMock()
    for name in [
        "aivinnet.db",
        "aivinnet.db.libdata",
        "aivinnet.store",
        "aivinnet.store.albums",
        "aivinnet.store.tracks",
    ]
}

with patch.dict(sys.modules, _SWING_MOCKS):
    from aivinnet.lib import album_cover_edit

import os  # noqa: E402

import pytest  # noqa: E402

from aivinnet.lib.cover_writer import CoverWriteError, UnsupportedCoverFormatError  # noqa: E402

COVER = b"cover-bytes"


class FakeTrack:
    def __init__(self, filepath, albumhash):
        self.filepath = filepath
        self.albumhash = albumhash


class FakeGroup:
    def __init__(self, tracks):
        self.tracks = tracks


class FakeAlbumEntry:
    def __init__(self, trackhashes):
        self.trackhashes = trackhashes


def install_album(monkeypatch, albumhash, groups):
    """Point the mocked stores at one album made of `groups` {trackhash: [tracks]}."""
    monkeypatch.setattr(
        album_cover_edit.AlbumStore,
        "albummap",
        {albumhash: FakeAlbumEntry(list(groups))},
        raising=False,
    )
    monkeypatch.setattr(
        album_cover_edit.TrackStore,
        "trackhashmap",
        {th: FakeGroup(tracks) for th, tracks in groups.items()},
        raising=False,
    )


class TestGetAlbumFilepaths:
    def test_collects_every_file_of_the_album(self, monkeypatch):
        install_album(
            monkeypatch,
            "ALB",
            {
                "t1": [FakeTrack("/m/1.mp3", "ALB")],
                "t2": [FakeTrack("/m/2.mp3", "ALB")],
            },
        )

        assert album_cover_edit.get_album_filepaths("ALB") == ["/m/1.mp3", "/m/2.mp3"]

    def test_keeps_duplicate_files_sharing_one_trackhash(self, monkeypatch):
        # Two copies of the same song in the album's folder share a trackhash
        # (it is derived from title/artists/album text). Both are files on disk
        # and both need the cover.
        install_album(
            monkeypatch,
            "ALB",
            {"t1": [FakeTrack("/m/1.mp3", "ALB"), FakeTrack("/m/1-copy.mp3", "ALB")]},
        )

        assert album_cover_edit.get_album_filepaths("ALB") == ["/m/1.mp3", "/m/1-copy.mp3"]

    def test_ignores_group_members_from_another_album(self, monkeypatch):
        # A trackhash groups by TEXT tags, so identical tags in two different
        # folders land in one group with two different album hashes.
        install_album(
            monkeypatch,
            "ALB",
            {"t1": [FakeTrack("/m/1.mp3", "ALB"), FakeTrack("/other/1.mp3", "OTHER")]},
        )

        assert album_cover_edit.get_album_filepaths("ALB") == ["/m/1.mp3"]

    def test_unknown_album_raises(self, monkeypatch):
        install_album(monkeypatch, "ALB", {})

        with pytest.raises(album_cover_edit.AlbumCoverError):
            album_cover_edit.get_album_filepaths("NOPE")


class TestEmbedAlbumCover:
    def _album(self, monkeypatch, tmp_path, names):
        paths = []
        groups = {}

        for i, name in enumerate(names):
            path = tmp_path / name
            path.write_bytes(b"AUDIO-" + name.encode())
            paths.append(str(path))
            groups[f"t{i}"] = [FakeTrack(str(path), "ALB")]

        install_album(monkeypatch, "ALB", groups)
        monkeypatch.setattr(album_cover_edit, "build_embeddable_cover", lambda h: (COVER, 512, 512))
        return paths

    def test_writes_every_file_and_reports_the_count(self, monkeypatch, tmp_path):
        paths = self._album(monkeypatch, tmp_path, ["1.mp3", "2.mp3"])
        seen = []
        monkeypatch.setattr(album_cover_edit, "write_cover", lambda p, *a: seen.append(p))

        result = album_cover_edit.embed_album_cover("ALB")

        assert seen == paths
        assert result == {"total": 2, "written": 2, "failed": []}

    def test_backups_are_cleaned_up_on_success(self, monkeypatch, tmp_path):
        paths = self._album(monkeypatch, tmp_path, ["1.mp3"])
        monkeypatch.setattr(album_cover_edit, "write_cover", lambda p, *a: None)

        album_cover_edit.embed_album_cover("ALB")

        assert not os.path.exists(paths[0] + ".bak")

    def test_one_failure_does_not_abort_the_album(self, monkeypatch, tmp_path):
        paths = self._album(monkeypatch, tmp_path, ["1.mp3", "2.mp3", "3.mp3"])

        def write(path, *args):
            if path == paths[1]:
                raise CoverWriteError("mutagen said no")

        monkeypatch.setattr(album_cover_edit, "write_cover", write)

        result = album_cover_edit.embed_album_cover("ALB")

        assert result["total"] == 3
        assert result["written"] == 2
        assert result["failed"] == [{"file": paths[1], "error": "mutagen said no"}]

    def test_a_failed_write_restores_the_original_bytes(self, monkeypatch, tmp_path):
        paths = self._album(monkeypatch, tmp_path, ["1.mp3"])
        with open(paths[0], "rb") as f:
            original = f.read()

        def half_write(path, *args):
            # What a real interrupted mutagen save looks like: the file is
            # already damaged when the error surfaces.
            with open(path, "wb") as f:
                f.write(b"HALF-WRITTEN")
            raise CoverWriteError("boom")

        monkeypatch.setattr(album_cover_edit, "write_cover", half_write)

        result = album_cover_edit.embed_album_cover("ALB")

        assert result["written"] == 0
        with open(paths[0], "rb") as f:
            assert f.read() == original
        assert not os.path.exists(paths[0] + ".bak")

    def test_unsupported_container_is_reported_not_skipped(self, monkeypatch, tmp_path):
        paths = self._album(monkeypatch, tmp_path, ["1.mp3", "2.wma"])
        monkeypatch.setattr(album_cover_edit, "write_cover", lambda p, *a: None)

        result = album_cover_edit.embed_album_cover("ALB")

        assert result["written"] == 1
        assert result["failed"] == [{"file": paths[1], "error": "Unsupported format: .wma"}]
        # Rejected on the extension, so no pointless copy of the file was made.
        assert not os.path.exists(paths[1] + ".bak")

    def test_unsupported_reported_by_the_writer_is_reported_too(self, monkeypatch, tmp_path):
        # The extension pre-filter is only a shortcut; mutagen has the last word.
        paths = self._album(monkeypatch, tmp_path, ["1.mp3"])

        def write(path, *args):
            raise UnsupportedCoverFormatError("No cover art support for Foo files")

        monkeypatch.setattr(album_cover_edit, "write_cover", write)

        result = album_cover_edit.embed_album_cover("ALB")

        assert result["failed"] == [{"file": paths[0], "error": "No cover art support for Foo files"}]

    def test_missing_file_is_reported(self, monkeypatch, tmp_path):
        paths = self._album(monkeypatch, tmp_path, ["1.mp3", "2.mp3"])
        os.remove(paths[1])
        monkeypatch.setattr(album_cover_edit, "write_cover", lambda p, *a: None)

        result = album_cover_edit.embed_album_cover("ALB")

        assert result["written"] == 1
        assert result["failed"] == [{"file": paths[1], "error": "File not found on disk"}]

    def test_album_without_files_raises(self, monkeypatch, tmp_path):
        self._album(monkeypatch, tmp_path, [])

        with pytest.raises(album_cover_edit.AlbumCoverError):
            album_cover_edit.embed_album_cover("ALB")
