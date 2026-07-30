"""
Module to setup Sqlite databases and tables.
Applies migrations.
"""

from sqlalchemy import create_engine

from swingmusic.db import create_all_tables
from swingmusic.db.engine import DbEngine
from swingmusic.db.userdata import UserTable
from swingmusic.migrations import apply_migrations
from swingmusic.migrations.albumhash_collapse import repair_collapsed_albumhashes
from swingmusic.settings import Paths


def run_migrations():
    """
    Run migrations and updates migration version.
    """
    apply_migrations()

    # Not part of `apply_migrations` because that mechanism is currently inert
    # (its module list is empty and its apply loop is commented out), so a
    # migration registered there would never run. This one is safe to call on
    # every start instead of being versioned: it only rewrites a track whose
    # stored hash still equals the broken one, so the second run finds nothing.
    repair_collapsed_albumhashes()


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
