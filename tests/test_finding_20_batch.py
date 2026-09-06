"""Three settings that quietly did not do what they said.

Each was a candidate from the pre-release audit that nobody had measured. All
three turned out to be real, and none of them announces itself: the symptom is
always something that looks like it worked.
"""

import socket

from aivinnet.utils.filesystem import run_fast_scandir
from aivinnet.utils.network import has_connection


class TestExcludeDirs:
    """
    `excludeDirs` has been in the config and in the settings API since before
    this fork — accepted, stored, returned, and never once consulted. A setting
    that answers "saved" and then scans the folder anyway is worse than no
    setting at all.
    """

    def test_an_excluded_directory_is_skipped(self, tmp_path):
        keep = tmp_path / "Albums"
        drop = tmp_path / "Podcasts"
        keep.mkdir()
        drop.mkdir()
        (keep / "song.mp3").write_bytes(b"x")
        (drop / "episode.mp3").write_bytes(b"x")

        _dirs, files = run_fast_scandir(str(tmp_path), full=True, exclude=[str(drop)])

        assert any("song.mp3" in f for f in files)
        assert not any("episode.mp3" in f for f in files)

    def test_everything_beneath_it_is_skipped_too(self, tmp_path):
        drop = tmp_path / "Podcasts"
        deep = drop / "2026" / "March"
        deep.mkdir(parents=True)
        (deep / "episode.mp3").write_bytes(b"x")

        _dirs, files = run_fast_scandir(str(tmp_path), full=True, exclude=[str(drop)])

        assert files == []

    def test_no_exclusions_scans_everything(self, tmp_path):
        """The default must not change what anyone already has."""
        (tmp_path / "song.mp3").write_bytes(b"x")

        _dirs, files = run_fast_scandir(str(tmp_path), full=True)

        assert len(files) == 1

    def test_a_nonsense_entry_is_ignored_not_fatal(self, tmp_path):
        """A hand-edited config must not stop the scan."""
        (tmp_path / "song.mp3").write_bytes(b"x")

        _dirs, files = run_fast_scandir(str(tmp_path), full=True, exclude=["", "\0not-a-path"])

        assert len(files) == 1

    def test_matching_is_by_resolved_path(self, tmp_path):
        """`./Podcasts` and the absolute path are the same folder."""
        from aivinnet.utils.filesystem import is_excluded

        drop = tmp_path / "Podcasts"
        drop.mkdir()

        assert is_excluded(drop.resolve(), [str(drop) + "/."])


class TestConnectivityProbe:
    """
    ⚠️ `has_connection` used to call `socket.setdefaulttimeout(3)` — which is
    PROCESS-wide and was never put back. One connectivity probe gave every
    socket created afterwards, anywhere, a three-second timeout for the rest of
    the server's life. It also never closed its socket.
    """

    def test_the_global_socket_timeout_is_left_alone(self):
        before = socket.getdefaulttimeout()

        has_connection(host="127.0.0.1", port=9, timeout=1)

        assert socket.getdefaulttimeout() == before

    def test_an_unreachable_host_is_false_not_an_exception(self):
        assert has_connection(host="127.0.0.1", port=9, timeout=1) is False

    def test_the_socket_is_closed(self, monkeypatch):
        """A leaked descriptor per probe adds up on a server that scans on a timer."""
        closed = []
        real = socket.socket

        class Tracking(real):
            def close(self):
                closed.append(True)
                super().close()

        monkeypatch.setattr(socket, "socket", Tracking)

        has_connection(host="127.0.0.1", port=9, timeout=1)

        assert closed, "the probe socket was never closed"
