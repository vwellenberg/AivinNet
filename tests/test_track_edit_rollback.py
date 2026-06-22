"""Tests for track_edit's rollback backup safety.

``track_edit`` imports heavy store/db/tagger modules at import time (and
``swingmusic.db.__init__`` builds a SQLAlchemy declarative ``Base`` that cannot be
constructed against a mocked sqlalchemy). We therefore mock both the third-party
deps AND the heavy ``swingmusic`` leaf modules ``track_edit`` imports, so their
bodies never run. The rollback logic under test uses only ``os``/``shutil`` and
does not touch any mocked module on the failure paths it exercises.
"""

import sys
from unittest.mock import MagicMock

# Third-party deps not installed in the CI test job.
_THIRD_PARTY = [
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
]

# Heavy swingmusic modules track_edit imports — mocked so their module bodies
# (and swingmusic.db.__init__'s declarative Base) never execute. tag_writer and
# reference_migration are left real because they are light (no heavy top-level
# imports).
_SWING = [
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

for _mod in _THIRD_PARTY + _SWING:
    sys.modules.setdefault(_mod, MagicMock())

import os  # noqa: E402

from swingmusic.lib import track_edit  # noqa: E402


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
