"""A path in a request body must never be a path the server acts on.

Two endpoints took one straight from the client:

* `POST /plugins/lyrics/search` passed `filepath` to the downloader, which does
  `Path(p).with_suffix(".lrc")` then `touch()` and `write_text()` — file
  creation anywhere the service user can write, available to the guest account.
* `POST /file/silence` handed `ending_file` / `starting_file` to
  `get_silence_paddings`, which calls `.exists()` (an oracle for any path on the
  host) and then spawns a process that decodes the whole file while the handler
  blocks on join(). Under bjoern, which serves one request at a time, that one
  call stops the app for everyone.

The rule both now follow: a supplied path is honoured only when it belongs to a
track the library has indexed. Legitimate clients send exactly such a path, so
nothing changes for them.
"""

from types import SimpleNamespace

import pytest

# Only the pre-existing function is imported at module level. The two new
# helpers are imported inside the tests that use them, so this module still
# COLLECTS against an unpatched tree — which is what lets the silence tests
# below actually go red there instead of erroring out at import time. A test
# that cannot run without the fix proves much less than one that fails with it.
from aivinnet.lib.trackslib import get_silence_paddings

HASH = "abc123def456"


class _Group:
    def __init__(self, tracks):
        self.tracks = tracks


@pytest.fixture()
def library(monkeypatch, tmp_path):
    """A two-file track group whose paths really exist on disk."""
    mp3 = tmp_path / "song.mp3"
    flac = tmp_path / "song.flac"
    mp3.write_bytes(b"x")
    flac.write_bytes(b"x")

    tracks = [
        SimpleNamespace(filepath=str(mp3), bitrate=320, trackhash=HASH),
        SimpleNamespace(filepath=str(flac), bitrate=1411, trackhash=HASH),
    ]

    import aivinnet.lib.trackslib as trackslib

    monkeypatch.setattr(trackslib.TrackStore, "trackhashmap", {HASH: _Group(tracks)}, raising=False)
    monkeypatch.setattr(
        trackslib.TrackStore,
        "get_tracks_by_filepaths",
        classmethod(lambda cls, paths: [t for t in tracks if t.filepath in paths]),
        raising=False,
    )

    return str(mp3), str(flac)


class TestIsIndexedTrackPath:
    @staticmethod
    def _fn():
        from aivinnet.lib.trackslib import is_indexed_track_path

        return is_indexed_track_path

    def test_a_known_file_passes(self, library):
        mp3, _ = library
        assert self._fn()(mp3) is True

    @pytest.mark.parametrize("path", ["/etc/passwd", "/root/.ssh/id_ed25519", "", "/music/real/other.mp3"])
    def test_anything_else_is_refused(self, library, path):
        assert self._fn()(path) is False


class TestResolveTrackFilepath:
    @staticmethod
    def _fn():
        from aivinnet.lib.trackslib import resolve_track_filepath

        return resolve_track_filepath

    def test_an_unknown_hash_resolves_to_nothing(self, library):
        assert self._fn()("nosuchhash", None) is None

    def test_a_requested_path_of_that_track_is_honoured(self, library):
        """What a real client sends — it must keep working exactly as before."""
        mp3, _ = library
        assert self._fn()(HASH, mp3) == mp3

    def test_a_foreign_path_is_ignored_not_obeyed(self, library):
        """THE guard: the caller does not get to name the file."""
        mp3, flac = library

        resolved = self._fn()(HASH, "/etc/cron.d/payload")

        assert resolved in {mp3, flac}
        assert resolved != "/etc/cron.d/payload"

    def test_no_request_path_falls_back_to_the_best_file(self, library):
        _, flac = library
        assert self._fn()(HASH, None) == flac  # highest bitrate


class TestSilencePaddings:
    def test_unknown_paths_answer_zero_without_touching_them(self, library, monkeypatch):
        """
        No process is spawned, and the answer is identical for a path that
        exists and one that does not — so it is not an oracle either.
        """
        import aivinnet.lib.trackslib as trackslib

        def explode(*_args, **_kwargs):
            raise AssertionError("a process was spawned for an unindexed path")

        monkeypatch.setattr(trackslib, "ProcessWithReturnValue", explode)

        missing = get_silence_paddings("/etc/passwd", "/definitely/not/here.mp3")
        present = get_silence_paddings("/etc/passwd", "/etc/hosts")

        assert missing == {"starting_file": 0, "ending_file": 0}
        assert present == missing

    def test_indexed_paths_are_still_processed(self, library, monkeypatch):
        import aivinnet.lib.trackslib as trackslib

        started = []

        class _FakeProcess:
            def __init__(self, target=None, args=()):
                started.append(args[0])

            def start(self):
                pass

            def join(self):
                return 42

        monkeypatch.setattr(trackslib, "ProcessWithReturnValue", _FakeProcess)

        mp3, flac = library
        result = get_silence_paddings(mp3, flac)

        assert len(started) == 2, "both indexed files should be measured"
        assert result == {"starting_file": 42, "ending_file": 42}
