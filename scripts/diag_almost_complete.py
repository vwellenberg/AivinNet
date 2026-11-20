"""
Diagnose "Almost complete": is the song a card calls missing really unplayed?

Read-only (SQLite `mode=ro`), safe next to the running server. Run it in the
app's environment, because the hashes have to be the ones the SERVER computes:
it does not use `track.trackhash` from the database but re-derives every hash
from the tags when it loads the library (`models/track.py`). Comparing against
the stored column would be comparing against hashes the server never uses.

For every track of the matching albums it prints the user's plays, counted:

  hash   under the hash the server uses now. This is the ONLY count
         "Almost complete" looks at (`ScrobbleTable.heard_trackhashes_of`).
  old    under one of the track's earlier hashes (`_legacyhash`,
         `_previoushashes`) that the name cleanup should have carried over
  path   by `extra.filepath`, stored with every scrobble since the endpoint
         writes it; survives any later hash change
  title  by `extra.title` + `extra.album` (the albumhash)

  --  never logged under any key: really unheard (or skipped before 5 s)
  !!  heard, but not under the hash "Almost complete" counts: an index bug

Usage (on the server, in the checkout):
    uv run --frozen python scripts/diag_almost_complete.py --user <name> "Blood Sugar" "Escapades"
"""

import argparse
import dataclasses
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

from aivinnet.config import UserConfig
from aivinnet.lib.play_floor import can_be_logged
from aivinnet.models.track import Track
from aivinnet.settings import Paths


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("albums", nargs="+", help="part of an album title (case-insensitive)")
    parser.add_argument("--db", type=Path, help="default: the server's own database")
    parser.add_argument("--user", help="username (default: the only user, else required)")
    args = parser.parse_args()

    db_path = args.db or Paths().app_db_path
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row

    users = [(r["id"], r["username"]) for r in db.execute("SELECT id, username FROM user")]
    if args.user:
        match = [u for u in users if u[1] == args.user]
        if not match:
            sys.exit(f"no user {args.user!r}; known: {', '.join(u[1] for u in users)}")
        userid = match[0][0]
    elif len(users) == 1:
        userid = users[0][0]
    else:
        sys.exit(f"several users, pass --user: {', '.join(u[1] for u in users)}")

    by_hash: Counter[str] = Counter()
    by_path: Counter[str] = Counter()
    by_title: Counter[tuple[str, str]] = Counter()
    for row in db.execute("SELECT trackhash, extra FROM scrobble WHERE userid = ?", (userid,)):
        by_hash[row["trackhash"]] += 1
        try:
            info = json.loads(row["extra"]) if row["extra"] else {}
        except ValueError:
            info = {}
        if not isinstance(info, dict):
            continue
        if info.get("filepath"):
            by_path[info["filepath"]] += 1
        if info.get("title") and info.get("album"):
            by_title[(str(info["title"]).casefold(), info["album"])] += 1

    accepted = {f.name for f in dataclasses.fields(Track)}
    config = UserConfig()
    for pattern in args.albums:
        albums: dict[str, list[Track]] = defaultdict(list)
        for row in db.execute("SELECT * FROM track WHERE album LIKE ?", (f"%{pattern}%",)):
            # `.keys()` is needed: iterating an sqlite3.Row yields its values.
            data = {k: row[k] for k in row.keys() if k in accepted}  # noqa: SIM118
            if isinstance(data.get("extra"), str):
                data["extra"] = json.loads(data["extra"] or "{}")
            track = Track(**data, config=config)
            albums[track.albumhash].append(track)

        if not albums:
            print(f"\n=== {pattern!r}: no track in the library")
            continue

        for albumhash, tracks in albums.items():
            tracks.sort(key=lambda t: (t.disc, t.track, t.title))
            # As the routine counts: a track too short to ever be logged is not required (#882).
            distinct = list(dict.fromkeys(t.trackhash for t in tracks if can_be_logged(t.duration)))
            missing = [h for h in distinct if not by_hash[h]]
            print(f"\n=== {tracks[0].album}  (albumhash {albumhash})")
            print(
                f"    {len(distinct)} tracks, {len(distinct) - len(missing)} heard by hash -> card: {len(missing)} to go"
            )
            print(f"{'':2} {'d-#':>5}  {'hash':>4} {'old':>3} {'path':>4} {'title':>5}  {'len':>5}  title")
            for t in tracks:
                h = by_hash[t.trackhash]
                o = sum(by_hash[x] for x in (t._legacyhash, *t._previoushashes) if x)
                p = by_path[t.filepath]
                n = by_title[(t.title.casefold(), albumhash)]
                mark = "  " if h else ("!!" if o or p or n else "--")
                short = "  (too short to ever be logged, not required)" if not can_be_logged(t.duration) else ""
                print(
                    f"{mark} {t.disc:>2}-{t.track:<2}  {h:>4} {o:>3} {p:>4} {n:>5}  {t.duration:>4}s  {t.title}{short}"
                )
                if mark != "  ":
                    print(f"{'':31}{t.filepath}")
                    print(f"{'':31}hash now {t.trackhash}, in db {row_hash(db, t.filepath)}")

    print("\n--  never logged under any key      !!  heard, but under another hash (index bug)")
    return 0


def row_hash(db: sqlite3.Connection, filepath: str) -> str:
    row = db.execute("SELECT trackhash FROM track WHERE filepath = ?", (filepath,)).fetchone()
    return row["trackhash"] if row else "?"


if __name__ == "__main__":
    sys.exit(main())
