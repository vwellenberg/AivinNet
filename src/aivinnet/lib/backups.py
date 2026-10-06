"""
Where backups live.

⚠️ In the container that is under the config volume. `~` is /root there, in
the container's own layer: a backup made in the UI vanished with the next
`docker compose up -d` that recreated the container — the safety net was gone
exactly when the database next to it might be needed (#296). Everywhere else
it stays in the home directory, where existing backups already are.
"""

import logging
import shutil
from pathlib import Path

from aivinnet.settings import Paths
from aivinnet.start_info_logger import in_container

log = logging.getLogger(__name__)

FOLDER = "aivinnet.backup"


def _home_root() -> Path:
    return Path("~").expanduser() / FOLDER


def get_backup_root() -> Path:
    """
    The one directory every backup lives in. A single definition so the path
    guard in api/backup_and_restore.py and its callers cannot disagree about
    what "inside" means.
    """
    if in_container():
        return Paths().config_parent / FOLDER

    return _home_root()


def adopt_container_backups() -> None:
    """
    Move backups an earlier image left in /root into the volume, once, at start.

    Only what a recreated container has not lost yet can be saved. Never
    overwrites: a backup of the same name already in the volume is kept, and
    the old one stays where it is.
    """
    if not in_container():
        return

    old, new = _home_root(), get_backup_root()
    if not old.is_dir() or old.resolve() == new.resolve():
        return

    new.mkdir(parents=True, exist_ok=True)
    for entry in old.iterdir():
        target = new / entry.name
        if target.exists():
            log.warning("Backup %s is in the volume already; the copy in %s stays where it is", entry.name, old)
            continue
        try:
            shutil.move(str(entry), str(target))
            log.info("Moved backup %s into the config volume", entry.name)
        except OSError as exc:
            log.warning("Could not move backup %s into the config volume: %s", entry, exc)
