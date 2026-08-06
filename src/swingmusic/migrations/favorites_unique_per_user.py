"""
Rebuilds the `favorite` table so that its UNIQUE constraint is per user.

`FavoritesTable.hash` used to carry a GLOBAL `UNIQUE`. Each row has its own
`userid`, so the constraint said "one row per item in the whole installation" —
the second user to favorite something already favorited by someone else hit an
IntegrityError and got an HTTP 500 (AivinNet-Client#435). The model now declares
`UNIQUE (hash, userid)` instead, but `create_all` never ALTERS an existing
table: without this repair every database that already exists keeps the old
constraint forever.

Why here and not in the versioned mechanism: that mechanism is inert (empty
module list, commented-out apply loop, see `.claude/rules/database.md`), so a
migration registered there would never run. Like `repair_collapsed_albumhashes`
and `rename_albums_after_their_folder`, this one rides along on every start and
is written to be idempotent instead of versioned.

**Idempotent by construction:** it only fires while the table still carries a
UNIQUE index over `hash` ALONE. The rebuild replaces that with a unique index
over `(hash, userid)`, so the next start finds nothing to do. That is also how
you tell from the outside whether the repair already ran::

    sqlite3 ~/.config/swingmusic/swingmusic.db \\
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='favorite';"

    before:  hash VARCHAR NOT NULL,  ... UNIQUE (hash)
    after:   hash VARCHAR NOT NULL,  ... CONSTRAINT uq_favorite_hash_userid UNIQUE (hash, userid)

SQLite cannot drop a column constraint, so the table has to be rebuilt: create
the new shape, copy the rows, drop the old one. Two details that make the dance
safe here:

- **Foreign keys are switched off for the rebuild** (the procedure SQLite's own
  docs prescribe). `favorite.userid` references `user.id`; a row whose user
  disappeared before the FK was enforced would otherwise abort the copy and take
  the whole startup with it.
- **The new schema is generated from the model**, not hand-written, so it cannot
  drift away from `FavoritesTable`.
"""

import logging

from sqlalchemy.dialects import sqlite
from sqlalchemy.schema import CreateIndex, CreateTable

from swingmusic.db.engine import DbEngine

# `swingmusic.logger.log` is None until `setup_logger()` has run, and migrations
# also get called from a shell against a copy of a database — where that global
# is never set. A module logger works in both.
log = logging.getLogger(__name__)

OLD_TABLE = "_favorite_pre_435"
"""Scratch name for the old table. Only ever exists inside the transaction."""


def unique_index_on_hash_alone(cursor, table: str = "favorite") -> str | None:
    """
    The name of a UNIQUE index that spans exactly the `hash` column, or None.

    That index is the fingerprint of the old schema: SQLite materializes an
    inline column `UNIQUE` as an implicit (`sqlite_autoindex_*`) unique index
    over that single column. The fixed schema's unique index spans two columns,
    so it never matches — which is what makes the repair a no-op on a second run.

    Detecting by COLUMNS rather than by index name is deliberate: the implicit
    index is named by SQLite, the explicit one by SQLAlchemy, and neither name
    is part of a contract we control.
    """
    for row in cursor.execute(f'PRAGMA index_list("{table}")').fetchall():
        name, is_unique = row[1], row[2]

        if not is_unique:
            continue

        columns = [info[2] for info in cursor.execute(f'PRAGMA index_info("{name}")').fetchall()]

        if columns == ["hash"]:
            return name

    return None


def _target_schema_sql() -> tuple[str, list[str]]:
    """
    CREATE TABLE + CREATE INDEX statements for the CURRENT `FavoritesTable`.

    Compiled from the model so the rebuilt table is byte-for-byte what
    `create_all` would produce on a fresh database. A hand-written copy of the
    DDL would be a second source of truth and would rot.
    """
    from swingmusic.db.userdata import FavoritesTable

    dialect = sqlite.dialect()
    table = FavoritesTable.__table__

    create_table = str(CreateTable(table).compile(dialect=dialect))
    create_indexes = [str(CreateIndex(index).compile(dialect=dialect)) for index in table.indexes]

    return create_table, create_indexes


def repair_favorites_unique_constraint() -> dict[str, int | bool]:
    """
    Give an existing `favorite` table the per-user unique constraint.

    Returns a small report so the caller can log what happened:
    ``{"rebuilt": bool, "rows": int}``.
    """
    report: dict[str, int | bool] = {"rebuilt": False, "rows": 0}

    raw = DbEngine.engine.raw_connection()

    # The rebuild drives its own transaction: `PRAGMA foreign_keys` is silently
    # ignored INSIDE one, and sqlite3 opens an implicit transaction before the
    # first INSERT. Autocommit mode (isolation_level=None) hands that control
    # back, so the BEGIN below is the only transaction in play.
    dbapi = getattr(raw, "driver_connection", raw)
    previous_isolation = dbapi.isolation_level
    dbapi.isolation_level = None

    cursor = dbapi.cursor()

    try:
        stale_index = unique_index_on_hash_alone(cursor)

        if stale_index is None:
            # Either the table does not exist yet (fresh install — `create_all`
            # builds the right shape) or the repair already ran.
            return report

        create_table, create_indexes = _target_schema_sql()

        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.execute("BEGIN")

        try:
            # Indexes travel with the table across a RENAME and keep their old
            # names, so they have to go first — otherwise creating the new table
            # fails with "index ix_favorite_type already exists".
            for row in cursor.execute('PRAGMA index_list("favorite")').fetchall():
                name, origin = row[1], row[3]

                # "c" = created by CREATE INDEX. The implicit unique indexes
                # ("u"/"pk") are dropped together with the table and cannot be
                # dropped on their own.
                if origin == "c":
                    cursor.execute(f'DROP INDEX "{name}"')

            cursor.execute(f'ALTER TABLE favorite RENAME TO "{OLD_TABLE}"')
            cursor.execute(create_table)

            for statement in create_indexes:
                cursor.execute(statement)

            # Copy only the columns both shapes have. A database from an older
            # version may be missing one the model has gained since; the copy
            # must not die on it.
            old_columns = {info[1] for info in cursor.execute(f'PRAGMA table_info("{OLD_TABLE}")').fetchall()}
            new_columns = [info[1] for info in cursor.execute('PRAGMA table_info("favorite")').fetchall()]
            shared = [name for name in new_columns if name in old_columns]
            column_list = ", ".join(f'"{name}"' for name in shared)

            # The OLD constraint made `hash` globally unique, so no two rows can
            # collide on (hash, userid) — the copy needs no de-duplication.
            cursor.execute(f'INSERT INTO favorite ({column_list}) SELECT {column_list} FROM "{OLD_TABLE}"')
            report["rows"] = cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0

            cursor.execute(f'DROP TABLE "{OLD_TABLE}"')

            violations = cursor.execute("PRAGMA foreign_key_check").fetchall()

            if violations:
                # Pre-existing orphans, carried over unchanged. Deleting a user's
                # favorites to satisfy a constraint they never saw enforced would
                # be worse than leaving the database exactly as dirty as it was.
                log.warning(
                    "favorite rebuild: %s row(s) reference a user that no longer exists; kept as they were",
                    len(violations),
                )

            cursor.execute("COMMIT")
        except Exception:
            cursor.execute("ROLLBACK")
            raise

        report["rebuilt"] = True
        log.info(
            "Rebuilt the favorite table: UNIQUE(hash) -> UNIQUE(hash, userid), %s row(s) carried over",
            report["rows"],
        )

        return report
    finally:
        # Best effort: this connection goes back into the pool, so it must not
        # keep foreign keys switched off — but a failure here must not replace
        # the exception that brought us into `finally`.
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
        except Exception:
            log.exception("Could not restore PRAGMA foreign_keys on the favorite-rebuild connection")

        dbapi.isolation_level = previous_isolation
        raw.close()
