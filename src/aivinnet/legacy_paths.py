"""Move the config directory and database from the old `swingmusic` names.

The package was renamed to `aivinnet`, but the data was deliberately left
behind: `~/.config/swingmusic/` holds the library database, the cover cache and
the playlists of every installation that already exists. Renaming those without
moving the data means the app comes up with an empty library and the user's
first impression is that their music is gone.

Two rules make this safe, and both matter more than the rename itself:

1. **Never overwrite.** Anything is only moved when the destination does not
   exist. A half-migrated install (new dir present, old one too) keeps the new
   one and leaves the old alone — no merge, no clobber.
2. **Failure is not fatal.** If the move cannot happen (permissions, a
   cross-device config dir, an antivirus holding a handle), the app must still
   find its data. The path properties therefore *resolve* rather than assume:
   they prefer the new name, fall back to the old one if only that exists, and
   use the new name for a fresh install. The migration is an optimisation of
   the naming, never a precondition for starting.

`os.rename` is atomic within a filesystem, so a directory move cannot be
observed half-done. The database is three files, though — SQLite in WAL mode
keeps `-wal` and `-shm` next to it, and they are only valid together with a db
of the matching base name. They are moved as a set, and the db file goes LAST:
if the process dies midway, the original db is still there with its sidecars,
which SQLite can recover from. The reverse order could leave a db without its
WAL, and that loses the transactions the WAL still held.
"""

import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

LEGACY_DIR_NAME = "swingmusic"
LEGACY_DOT_DIR_NAME = ".swingmusic"
DIR_NAME = "aivinnet"
DOT_DIR_NAME = ".aivinnet"

LEGACY_DB_NAME = "swingmusic.db"
DB_NAME = "aivinnet.db"

# SQLite WAL sidecars. Order matters on the move — see the module docstring.
DB_SIDECAR_SUFFIXES = ("-wal", "-shm")


def resolve_config_dir_name(config_parent: Path, *, dotted: bool) -> str:
    """Pick the config folder name to use under `config_parent`.

    Prefers the new name, keeps using the legacy one when that is the only one
    present, and uses the new name for a fresh install. This is what makes a
    failed migration harmless.
    """
    new_name = DOT_DIR_NAME if dotted else DIR_NAME
    legacy_name = LEGACY_DOT_DIR_NAME if dotted else LEGACY_DIR_NAME

    if (config_parent / new_name).is_dir():
        return new_name

    if (config_parent / legacy_name).is_dir():
        return legacy_name

    return new_name


def resolve_db_name(config_dir: Path) -> str:
    """Same idea for the database file inside the config directory."""
    if (config_dir / DB_NAME).is_file():
        return DB_NAME

    if (config_dir / LEGACY_DB_NAME).is_file():
        return LEGACY_DB_NAME

    return DB_NAME


def migrate_config_dir(config_parent: Path, *, dotted: bool) -> bool:
    """Rename `<parent>/swingmusic` to `<parent>/aivinnet`. True if moved."""
    new_name = DOT_DIR_NAME if dotted else DIR_NAME
    legacy_name = LEGACY_DOT_DIR_NAME if dotted else LEGACY_DIR_NAME

    source = config_parent / legacy_name
    destination = config_parent / new_name

    if destination.exists() or not source.is_dir():
        return False

    try:
        os.rename(source, destination)
    except OSError as error:
        # Keep going with the legacy directory — resolve_config_dir_name()
        # will hand it back, so the library stays reachable.
        log.warning("Could not move %s to %s (%s); continuing with the old location", source, destination, error)
        return False

    log.info("Moved the config directory from %s to %s", source, destination)
    return True


def migrate_db_files(config_dir: Path) -> bool:
    """Rename `swingmusic.db` and its WAL sidecars to `aivinnet.db`.

    Returns True when the database itself was moved.
    """
    source = config_dir / LEGACY_DB_NAME
    destination = config_dir / DB_NAME

    if destination.exists() or not source.is_file():
        return False

    # Sidecars first, database last: a crash in between leaves the ORIGINAL
    # db with a recoverable state rather than a db that lost its WAL.
    moved_sidecars: list[tuple[Path, Path]] = []
    for suffix in DB_SIDECAR_SUFFIXES:
        sidecar = config_dir / f"{LEGACY_DB_NAME}{suffix}"
        if not sidecar.is_file():
            continue
        target = config_dir / f"{DB_NAME}{suffix}"
        try:
            os.rename(sidecar, target)
            moved_sidecars.append((sidecar, target))
        except OSError as error:
            log.warning("Could not move %s (%s); leaving the database where it is", sidecar, error)
            _undo(moved_sidecars)
            return False

    try:
        os.rename(source, destination)
    except OSError as error:
        log.warning("Could not move %s to %s (%s); continuing with the old name", source, destination, error)
        _undo(moved_sidecars)
        return False

    log.info("Renamed the database from %s to %s", LEGACY_DB_NAME, DB_NAME)
    return True


def _undo(moved: list[tuple[Path, Path]]) -> None:
    """Put sidecars back so db and WAL keep the same base name."""
    for original, target in reversed(moved):
        try:
            os.rename(target, original)
        except OSError:
            log.error("Could not restore %s — the database and its WAL now disagree", original)
