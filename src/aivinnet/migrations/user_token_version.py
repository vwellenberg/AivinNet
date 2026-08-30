"""
Adds `user.token_version`, the counter that makes a token revocable.

Issued tokens live 30 days and renew themselves while they are used, so before
this there was no way to end a session at all: logging out only deleted the
browser's cookie, and changing a password left every token that existed before it
fully valid. A token that leaked once was good indefinitely.

The counter is put into the token when it is minted and compared against the
database on every request (`app_builder.user_lookup_loader`). Bumping the row
invalidates every token that carries the older number, at once, without keeping
any server-side session state.

⚠️ Runs from `setup_sqlite()`, NOT from `run_migrations()`, and the order is the
whole reason this module exists separately. `setup_sqlite` asks
`UserTable.get_all()` whether it needs to create the first admin — a SELECT that
names every mapped column. On a database that predates this change, that query
fails with `no such column: user.token_version` before `run_migrations()` is ever
reached, and the app cannot start. So the column has to exist before the first
query, which means before that check.

Idempotent by inspection rather than by version: `PRAGMA table_info` says whether
the column is already there. `create_all` never ALTERs an existing table, so
without this an upgraded install would never get the column at all.
"""

import logging

from sqlalchemy import text

from aivinnet.db.engine import DbEngine

log = logging.getLogger(__name__)

COLUMN = "token_version"
TABLE = "user"


def _has_column(session) -> bool:
    rows = session.execute(text(f"PRAGMA table_info({TABLE})")).fetchall()
    # PRAGMA table_info returns (cid, name, type, notnull, dflt_value, pk).
    return any(row[1] == COLUMN for row in rows)


def add_token_version_column() -> None:
    """Give every existing user a `token_version` of 0. Safe to call on every start."""
    with DbEngine.manager(commit=True) as session:
        if _has_column(session):
            return

        # NOT NULL with a constant default is one of the few ALTERs SQLite
        # accepts in place, so no table rebuild is needed here.
        session.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN {COLUMN} INTEGER NOT NULL DEFAULT 0"))

    log.info("Added %s.%s — sessions can now be revoked", TABLE, COLUMN)
