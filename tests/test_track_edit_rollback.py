"""Tests for track_edit's rollback backup safety.

``track_edit`` imports heavy store/db/tagger modules at import time (and
``swingmusic.db.__init__`` builds a SQLAlchemy declarative ``Base`` that cannot be
constructed against a mocked sqlalchemy). Third-party deps are mocked globally
(same pattern as ``test_album_model``); the heavy ``swingmusic`` leaf modules are
mocked only for the duration of the import via ``patch.dict`` so we do NOT shadow
the real modules for other test files in the same pytest session. The rollback
logic under test uses only ``os``/``shutil`` and touches no mocked module on the
failure paths it exercises.
"""

import sys
from unittest.mock import MagicMock, patch

# Third-party deps not installed in the CI test job — mocked globally (other
# tests rely on these being mocked too; none of the CI tests use the real libs).
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

# Heavy swingmusic leaf modules track_edit imports. Scoped to the import only so
# the real modules stay available to the rest of the suite.
_SWING_MOCKS = {
    name: MagicMock()
    for name in [
        "swingmusic.config",
        "swingmusic.db",
        "swingmusic.db.libdata",
        "swingmusic.db.utils",
        "swingmusic.lib.tagger",
        "swingmusic.lib.taglib",
        "swingmusic.models",
        "swingmusic.store",
        "swingmusic.store.albums",
        "swingmusic.store.artists",
        "swingmusic.store.tracks",
    ]
}

with patch.dict(sys.modules, _SWING_MOCKS):
    from swingmusic.lib import track_edit

import os  # noqa: E402


def _seed(tmp_path):
    """Create an 'edited' target file and its pristine .bak backup."""
    target = tmp_path / "song.mp3"
    target.write_bytes(b"EDITED-TAGS")
    backup = tmp_path / "song.mp3.bak"
    backup.write_bytes(b"ORIGINAL")
    return str(target), str(backup)


def test_rollback_keeps_backup_when_restore_fails(tmp_path, monkeypatch):
    """If restoring the backup fails, the .bak is the only intact copy and must
    never be deleted (regression: it used to be removed on the failure path)."""
    target, backup = _seed(tmp_path)

    def boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(track_edit.shutil, "copy2", boom)
    remove_spy = MagicMock()
    monkeypatch.setattr(track_edit, "_remove_backup", remove_spy)

    track_edit._rollback(target, backup, "oldalbum", set(), None, set())

    assert os.path.exists(backup), "backup must survive a failed restore"
    remove_spy.assert_not_called()


def test_rollback_noop_when_backup_missing(tmp_path, monkeypatch):
    """No backup on disk -> rollback does nothing (never tries to restore)."""
    target = str(tmp_path / "song.mp3")
    missing_backup = str(tmp_path / "absent.bak")

    copy_spy = MagicMock()
    monkeypatch.setattr(track_edit.shutil, "copy2", copy_spy)

    track_edit._rollback(target, missing_backup, "oldalbum", set(), None, set())

    copy_spy.assert_not_called()
