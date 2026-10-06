"""
Makes `user.username` unique in the database itself.

The handlers check a name before they create or rename a user (#291), but the
table accepted a second row with the same name: anything that went around the
handlers — an older version, a direct write — could add one, and login then
answered for whichever row SQLite happened to return first.

⚠️ The repair RENAMES, it never deletes or merges. Each user's playlists,
favourites and history hang off their id, and whose to keep is not a decision a
start may take. The oldest row (lowest id) keeps the name; every other one
becomes "<name>-<id>" and is logged, so the admin can tell that person.

Idempotent by inspection: once a unique index covers the column, there is
nothing to do. A fresh database gets one from the model (`unique=True`).
"""

import logging

from sqlalchemy import text

from aivinnet.db.engine import DbEngine

log = logging.getLogger(__name__)

TABLE = "user"
INDEX = "uq_user_username"


def _has_unique_username_index(session) -> bool:
    # PRAGMA index_list: (seq, name, unique, origin, partial)
    for row in session.execute(text(f"PRAGMA index_list({TABLE})")).fetchall():
        if not row[2]:
            continue
        columns = [c[2] for c in session.execute(text(f"PRAGMA index_info('{row[1]}')")).fetchall()]
        if columns == ["username"]:
            return True
    return False


def make_usernames_unique() -> None:
    """Rename duplicate usernames, then let the database refuse new ones. Safe on every start."""
    with DbEngine.manager(commit=True) as session:
        if _has_unique_username_index(session):
            return

        rows = session.execute(
            text(
                f"SELECT id, username FROM {TABLE} WHERE username IN "
                f"(SELECT username FROM {TABLE} GROUP BY username HAVING COUNT(*) > 1) ORDER BY username, id"
            )
        ).fetchall()

        keeps_name: set[str] = set()
        for userid, name in rows:
            if name not in keeps_name:
                keeps_name.add(name)
                continue

            new = f"{name}-{userid}"
            while session.execute(text(f"SELECT 1 FROM {TABLE} WHERE username = :n"), {"n": new}).first():
                new += "_"

            session.execute(text(f"UPDATE {TABLE} SET username = :n WHERE id = :i"), {"n": new, "i": userid})
            log.warning("Two users were called %r; user %s now logs in as %r", name, userid, new)

        session.execute(text(f"CREATE UNIQUE INDEX {INDEX} ON {TABLE} (username)"))

    log.info("Usernames are unique in the database now")
