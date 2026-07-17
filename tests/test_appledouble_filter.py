"""Regression tests for AppleDouble / hidden-file filtering.

macOS writes an AppleDouble sidecar (``._<name>``) next to every real file on
non-HFS volumes. Those sidecars share the audio extension of the real file, so
the scanner used to index them as ghost tracks — producing phantom albums and
artists (e.g. an artist ``._Louis cole`` from the filename tag-fallback). 317
such rows had accumulated in the live database.

These tests lock in that:

* the directory walker skips ``._*`` and other hidden dot-entries, and
* the periodic-scan cleanup path (``IndexTracks.filter_modded``) drops tracks
  already indexed from such paths, even though the sidecar file still exists on
  disk (so the "file no longer exists" check never fires for them).
"""

import sys
from unittest.mock import MagicMock

from swingmusic.utils.filesystem import is_hidden_path, run_fast_scandir


class TestIsHiddenPath:
    """The shared predicate used by the walker, the cleanup path and watchdog."""

    def test_appledouble_sidecar_bare_name(self):
        assert is_hidden_path("._01 - New Lands.mp3") is True

    def test_appledouble_sidecar_posix_path(self):
        assert is_hidden_path("/mnt/data/media/shared/music/._01 - New Lands.mp3") is True

    def test_appledouble_sidecar_windows_path(self):
        assert is_hidden_path(r"C:\media\music\._01 - New Lands.mp3") is True

    def test_plain_dotfile(self):
        assert is_hidden_path("/music/.hidden.flac") is True

    def test_ds_store(self):
        assert is_hidden_path("/music/.DS_Store") is True

    def test_dollar_system_entry(self):
        assert is_hidden_path("/music/$RECYCLE.BIN") is True

    def test_regular_file_posix(self):
        assert is_hidden_path("/mnt/data/media/shared/music/01 - New Lands.mp3") is False

    def test_regular_file_windows(self):
        assert is_hidden_path(r"C:\media\music\01 - New Lands.mp3") is False

    def test_regular_bare_name(self):
        assert is_hidden_path("01 - New Lands.mp3") is False

    def test_dot_inside_name_is_not_hidden(self):
        # A leading dot on the *directory* must not flag a normal child name.
        assert is_hidden_path("My.Band - Track.mp3") is False


class TestRunFastScandirSkipsHidden:
    """The directory walker must not enumerate AppleDouble / hidden files."""

    def test_skips_appledouble_keeps_real(self, tmp_path):
        real = tmp_path / "01 - New Lands.mp3"
        sidecar = tmp_path / "._01 - New Lands.mp3"
        dotfile = tmp_path / ".hidden.flac"
        for f in (real, sidecar, dotfile):
            f.write_bytes(b"\x00")

        _dirs, files = run_fast_scandir(str(tmp_path), full=True)

        assert real.as_posix() in files
        assert sidecar.as_posix() not in files
        assert dotfile.as_posix() not in files
        assert len(files) == 1

    def test_skips_appledouble_in_subdir(self, tmp_path):
        sub = tmp_path / "album"
        sub.mkdir()
        real = sub / "track.flac"
        sidecar = sub / "._track.flac"
        real.write_bytes(b"\x00")
        sidecar.write_bytes(b"\x00")

        _dirs, files = run_fast_scandir(str(tmp_path), full=True)

        assert files == [real.as_posix()]

    def test_skips_hidden_directory(self, tmp_path):
        hidden_dir = tmp_path / ".Trashes"
        hidden_dir.mkdir()
        (hidden_dir / "track.mp3").write_bytes(b"\x00")

        _dirs, files = run_fast_scandir(str(tmp_path), full=True)

        assert files == []


# ---------------------------------------------------------------------------
# Cleanup path: IndexTracks.filter_modded
#
# ``swingmusic.lib.tagger`` pulls in the full backend stack (SQLAlchemy, Flask,
# watchdog, Pillow, ...). In the fast unit lane those are not installed, so we
# install MagicMock stand-ins for the heavy modules *only if absent* and pop the
# ones WE inserted again afterwards, so a later-collected test module still sees
# the real modules (known sys.modules-pollution gotcha in this repo).
# ``swingmusic.utils.filesystem`` is deliberately never mocked: filter_modded
# must call the real ``is_hidden_path``.
# ---------------------------------------------------------------------------

_HEAVY_MODULES = [
    "tqdm",
    "sqlalchemy",
    "sqlalchemy.orm",
    "flask",
    "flask_jwt_extended",
    "watchdog",
    "watchdog.events",
    "watchdog.observers",
    "watchdog.observers.api",
    "PIL",
    "PIL.Image",
    "swingmusic.db.libdata",
    "swingmusic.db.userdata",
    "swingmusic.lib.taglib",
    "swingmusic.store.folder",
    "swingmusic.store.tracks",
    "swingmusic.store.albums",
    "swingmusic.store.artists",
    "swingmusic.lib.remove_duplicates",
    "swingmusic.utils.remove_duplicates",
]

_inserted = [m for m in _HEAVY_MODULES if m not in sys.modules]
for _m in _inserted:
    sys.modules[_m] = MagicMock()

from swingmusic.lib import tagger  # noqa: E402

# Undo only the stubs we added, so real modules resolve for later test modules.
for _m in _inserted:
    sys.modules.pop(_m, None)


class _StubTrack:
    def __init__(self, filepath: str, last_mod: int = 100, albumhash: str = "alb"):
        self.filepath = filepath
        self.last_mod = last_mod
        self.albumhash = albumhash


class TestFilterModdedPrunesHidden:
    def test_prunes_appledouble_and_missing_keeps_valid(self, monkeypatch):
        tracks = [
            _StubTrack("/music/01 - Real.mp3", last_mod=100),  # exists, unchanged -> keep
            _StubTrack("/music/._01 - Real.mp3", last_mod=100),  # AppleDouble  -> remove
            _StubTrack("/music/.hidden.flac", last_mod=100),  # dotfile      -> remove
            _StubTrack("/music/Gone.mp3", last_mod=100),  # missing      -> remove
        ]

        removed: dict[str, set] = {}

        def fake_getmtime(path: str) -> float:
            # Only non-hidden, existing files should reach this call.
            if path == "/music/01 - Real.mp3":
                return 100.0
            if path == "/music/Gone.mp3":
                raise FileNotFoundError(path)
            raise AssertionError(f"getmtime called for filtered path: {path}")

        monkeypatch.setattr("os.path.getmtime", fake_getmtime)
        monkeypatch.setattr(tagger.TrackTable, "get_all", lambda: iter(tracks), raising=False)
        monkeypatch.setattr(
            tagger.TrackTable,
            "remove_tracks_by_filepaths",
            lambda fps: removed.update(paths=set(fps)),
            raising=False,
        )
        # The lingering post-remove debug assertion in filter_modded must see
        # "nothing left", so return an empty (falsy) list.
        monkeypatch.setattr(tagger.TrackTable, "get_tracks_by_filepaths", lambda fps: [], raising=False)

        unmodified, modified = tagger.IndexTracks.filter_modded()

        assert removed["paths"] == {
            "/music/._01 - Real.mp3",
            "/music/.hidden.flac",
            "/music/Gone.mp3",
        }
        assert unmodified == {"/music/01 - Real.mp3"}
        assert [t["filepath"] for t in modified] == ["/music/Gone.mp3"]
