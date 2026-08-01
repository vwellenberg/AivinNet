"""
Module to setup Sqlite databases and tables.
Applies migrations.
"""

from sqlalchemy import create_engine

from swingmusic.db import create_all_tables
from swingmusic.db.engine import DbEngine
from swingmusic.db.userdata import UserTable
from swingmusic.migrations import apply_migrations
from swingmusic.migrations.album_title_from_folder import rename_albums_after_their_folder
from swingmusic.migrations.albumhash_collapse import repair_collapsed_albumhashes
from swingmusic.migrations.drop_mixes import drop_mix_data
from swingmusic.settings import Paths


def run_migrations():
    """
    Run migrations and updates migration version.
    """
    apply_migrations()

    # Not part of `apply_migrations` because that mechanism is currently inert
    # (its module list is empty and its apply loop is commented out), so a
    # migration registered there would never run. Both are safe to call on
    # every start instead of being versioned: each only touches rows that still
    # carry the old shape, so the second run finds nothing.
    #
    # Order matters. The rename below identifies its rows by the FOLDER-derived
    # album hash, which is exactly what the repair above writes.
    repair_collapsed_albumhashes()
    rename_albums_after_their_folder()

    # Same reasoning: idempotent, so it rides along on every start instead of
    # being versioned. Clears out what the removed mixes feature left in the
    # database (see the module docstring for why the scrobbles are kept).
    drop_mix_data()


def setup_sqlite():
    """
    Create Sqlite databases and tables.
    """
    DbEngine._engine = create_engine(
        f"sqlite+pysqlite:///{Paths().app_db_path}",
        echo=False,
        max_overflow=20,
        pool_size=10,
    )

    create_all_tables()
    # create_user_tables()

    if not list(UserTable.get_all()):
        UserTable.insert_default_user()
