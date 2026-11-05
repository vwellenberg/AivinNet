"""Seed a running AivinNet server with the demo library, playlists and listening history (#713).

This script starts nothing. Point it at a server you started yourself:

    uv run --frozen python scripts/demo/seed.py \
        --url http://127.0.0.1:19800 --password <admin password> \
        --music <outdir from make_library.py>

What it does, in order:
  1. logs in as `admin`;
  2. adds the music folder as a root dir (the server scans it) and waits for the albums;
  3. creates playlists (one inside a folder), pins 2 playlists and 1 album, favourites
     10 tracks, 3 albums and 2 artists;
  4. writes ~10 weeks of plays through the real `POST /logger/track/log` endpoint, plus
     a few plays on this calendar day one and two years back for "On this day".

Home rows are computed at server start and by the hourly crons. After seeding, restart
the server so every row is recomputed from the new history (see README.md).

Standard library only. The random generator is seeded, so the same library and the same
--today date give the same history.
"""

from __future__ import annotations

import argparse
import datetime as dt
import http.cookiejar
import json
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SEED = 713
WEEKS = 10
ALBUM_COUNT = 15  # 14 albums plus the compilation, see make_library.py
PLAY_PROBABILITY = 0.75
PLAY_TRACKS = (3, 7)


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method: str, path: str, body: Any = None, timeout: float = 30.0) -> Any:
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(req, timeout=timeout) as res:
                raw = res.read()
                return res.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as err:
            raw = err.read()
            try:
                return err.code, json.loads(raw)
            except ValueError:
                return err.code, raw.decode(errors="replace")

    def upload(self, path: str, fields: dict[str, str], file_field: str, file_path: Path) -> tuple[int, Any]:
        """multipart/form-data POST with one file, standard library only."""
        boundary = f"demo{random.Random(str(file_path)).getrandbits(64):x}"
        parts = []
        for name, value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'
            f"Content-Type: image/jpeg\r\n\r\n".encode()
            + file_path.read_bytes()
            + b"\r\n"
        )
        parts.append(f"--{boundary}--\r\n".encode())
        req = urllib.request.Request(
            self.base + path,
            data=b"".join(parts),
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"},
        )
        try:
            with self.opener.open(req, timeout=30) as res:
                return res.status, json.loads(res.read() or b"null")
        except urllib.error.HTTPError as err:
            return err.code, err.read().decode(errors="replace")

    def must(self, method: str, path: str, body: Any = None, ok=(200, 201)) -> Any:
        status, payload = self.call(method, path, body)
        if status not in ok:
            raise SystemExit(f"{method} {path} -> {status}: {payload}")
        return payload


@dataclass
class Song:
    trackhash: str
    title: str
    album: str
    artist: str
    albumhash: str
    duration: int
    genre: str
    position: int


def is_christmas(song: Song) -> bool:
    """The first five tracks of "Winter Harbour Carols" (see make_library.py).

    The track dicts of the API carry no genre, so the album and the position stand in for it.
    """
    return song.album == "Winter Harbour Carols" and song.position < 5


def wait_for(description: str, check, timeout: float = 180.0, interval: float = 1.0) -> Any:
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        last = check()
        if last:
            return last
        time.sleep(interval)
    raise SystemExit(f"timed out waiting for {description} (last: {last})")


def list_albums(api: Api) -> list[dict]:
    albums: list[dict] = []
    start = 0
    while True:
        page = api.must("GET", f"/getall/albums?limit=50&start={start}")
        albums.extend(page["items"])
        start += len(page["items"])
        if not page["items"] or start >= page["total"]:
            return albums


def load_songs(api: Api) -> tuple[list[dict], list[Song]]:
    albums = list_albums(api)
    songs: list[Song] = []
    for album in albums:
        tracks = api.must("GET", f"/album/{album['albumhash']}/tracks")
        for pos, t in enumerate(tracks):
            songs.append(
                Song(
                    trackhash=t["trackhash"],
                    title=t["title"],
                    album=album["title"],
                    artist=album["albumartists"][0]["name"] if album.get("albumartists") else "",
                    albumhash=album["albumhash"],
                    duration=int(t.get("duration") or 30),
                    genre=t.get("genre", "") or "",
                    position=pos,
                )
            )
    return albums, songs


def find_album(albums: list[dict], title: str, artist: str | None = None) -> dict:
    for album in albums:
        names = [a["name"] for a in album.get("albumartists", [])]
        if album["title"] == title and (artist is None or artist in names):
            return album
    raise SystemExit(f"album not in library: {title!r}")


def songs_of(songs: list[Song], album: dict) -> list[Song]:
    return [s for s in songs if s.albumhash == album["albumhash"]]


def seed_playlists(api: Api, albums: list[dict], songs: list[Song], rng: random.Random) -> dict[str, int]:
    def hashes(items: list[Song], limit: int | None = None) -> str:
        chosen = items[:limit] if limit else items
        return ",".join(s.trackhash for s in chosen)

    by_artist = lambda name: [s for s in songs if s.artist == name]
    neon = by_artist("Neon Lagoon")
    jazz = by_artist("Marta Kessler Trio")
    funk = by_artist("Velvet Orchard")
    carols = [s for s in songs if is_christmas(s)]
    carol_fill = [s for s in songs if s.artist == "Northwind Choir" and not is_christmas(s)]
    mixed = rng.sample(songs, 12)

    spec = [
        ("Late Night Synth", neon, 6),
        ("Rainy Afternoon Jazz", jazz, 6),
        ("Sunday Funk Crate", funk, 6),
        ("Winter Carols", carols + carol_fill, None),
        ("Road Trip Mix", mixed, None),
    ]

    ids: dict[str, int] = {}
    for name, items, limit in spec:
        payload = api.must("POST", "/playlists/new", {"name": name})
        pid = int(payload["playlist"]["id"])
        ids[name] = pid
        api.must("POST", f"/playlists/{pid}/add", {"itemtype": "tracks", "itemhash": hashes(items, limit)})

    folder = api.must("POST", "/playlistfolders", {"name": "Moods"})
    folder_id = int(folder["id"])
    for name in ("Late Night Synth", "Rainy Afternoon Jazz"):
        api.must("POST", "/playlistfolders/move", {"playlist_id": ids[name], "folder_id": folder_id, "position": -1})

    # Pin two playlists and one album to the sidebar. pin_unpin toggles, so a pin
    # that is already set would be undone: only pin what is not pinned yet.
    for name in ("Sunday Funk Crate", "Road Trip Mix"):
        api.must("POST", f"/playlists/{ids[name]}/pin_unpin")
    chrome = find_album(albums, "Chrome Coastline", "Neon Lagoon")
    api.must("POST", f"/album/{chrome['albumhash']}/pin_unpin")
    return ids


def seed_favorites(api: Api, albums: list[dict], songs: list[Song]) -> list[Song]:
    neon = [s for s in songs if s.artist == "Neon Lagoon"]
    jazz = [s for s in songs if s.artist == "Marta Kessler Trio"]
    picks = neon[:4] + jazz[:3] + [s for s in songs if s.album == "Paper Weather"][:3]
    for s in picks:
        api.must("POST", "/favorites/add", {"hash": s.trackhash, "type": "track"})
    for title, artist in (
        ("Chrome Coastline", "Neon Lagoon"),
        ("Quiet Arithmetic", "Marta Kessler Trio"),
        ("Paper Weather", "The Paper Kites of Ostend"),
    ):
        api.must("POST", "/favorites/add", {"hash": find_album(albums, title, artist)["albumhash"], "type": "album"})
    for artist in ("Neon Lagoon", "Marta Kessler Trio"):
        artist_hash = next(a["artisthash"] for a in find_album_artists(albums, artist))
        api.must("POST", "/favorites/add", {"hash": artist_hash, "type": "artist"})
    return picks


def find_album_artists(albums: list[dict], name: str) -> list[dict]:
    return [a for album in albums for a in album.get("albumartists", []) if a["name"] == name][:1]


def build_history(
    today: dt.date, songs: list[Song], playlists: dict[str, int], favorites: list[Song], rng: random.Random
) -> list[dict]:
    """Plays for the last WEEKS weeks, as dicts ready for POST /logger/track/log.

    Each row of Home needs a different shape of history, so the rules below are deliberate:
      - "Small Hours Folk" is never played: Never played has something to show.
      - "Hollow Meridian" and "Glasshouse Suite" are played only 61-70 days ago: Rediscover.
      - The three forgotten favourites are played only 61+ days ago: Forgotten favorites.
      - Some sessions mix albums of different artists: Because you listened, Your mixes.
      - The last 7 days repeat one album's tracks: On repeat.
    """
    unplayed = {"Small Hours Folk"}
    quiet = {"Hollow Meridian", "Glasshouse Suite"}
    forgotten = {s.trackhash for s in favorites[:3]}

    by_album: dict[str, list[Song]] = {}
    for s in songs:
        by_album.setdefault(s.albumhash, []).append(s)
    for group in by_album.values():
        group.sort(key=lambda s: s.position)
    groups = [g for g in by_album.values() if g[0].album not in unplayed]

    hours = {"Neon Lagoon": (21, 23), "Marta Kessler Trio": (7, 10), "Velvet Orchard": (18, 21)}
    weights = [3.0 if g[0].artist in hours else 1.0 for g in groups]

    plays: list[dict] = []

    def session(day: dt.date, hour_window: tuple[int, int], tracks: list[Song], source: str) -> None:
        start = dt.datetime.combine(day, dt.time(rng.randint(*hour_window), rng.randint(0, 59)))
        t = int(start.timestamp())
        for s in tracks:
            plays.append({"trackhash": s.trackhash, "timestamp": t, "duration": s.duration, "source": source})
            t += s.duration + rng.randint(2, 20)

    days = WEEKS * 7
    for offset in range(days, 0, -1):
        day = today - dt.timedelta(days=offset)
        weekend = day.weekday() >= 5
        sessions = 1 + (1 if weekend and rng.random() < 0.5 else 0)
        for _ in range(sessions):
            if rng.random() > PLAY_PROBABILITY:
                continue
            group = rng.choices(groups, weights)[0]
            if group[0].album in quiet and offset <= 60:
                continue
            artist = group[0].artist
            pool = [s for s in group if not (offset <= 60 and s.trackhash in forgotten)]
            if not pool:
                continue
            count = min(len(pool), rng.randint(*PLAY_TRACKS))
            chosen = pool[:count] if rng.random() < 0.6 else rng.sample(pool, count)
            if rng.random() < 0.5:
                other = [g for g in groups if g[0].artist != artist and not (offset <= 60 and g[0].album in quiet)]
                extra = [s for s in rng.choice(other) if not (offset <= 60 and s.trackhash in forgotten)]
                if extra:
                    chosen = chosen + rng.sample(extra, min(len(extra), rng.randint(2, 3)))
            session(day, hours.get(artist, (17, 22)), chosen, f"al:{group[0].albumhash}")

    # Forgotten favourites: one burst of plays 61-70 days ago, nothing since.
    for offset in range(70, 60, -1):
        if rng.random() < 0.7:
            session(today - dt.timedelta(days=offset), (19, 22), favorites[:3], f"al:{favorites[0].albumhash}")

    # Quiet albums: a few full listens 61-70 days ago, nothing since (Rediscover).
    for offset in range(70, 60, -1):
        day = today - dt.timedelta(days=offset)
        for group in by_album.values():
            if group[0].album in quiet and rng.random() < 0.8:
                session(day, (19, 21), group, f"al:{group[0].albumhash}")

    # Playlist sessions in the last three weeks, so "Recently played" shows playlists too.
    pool = [s for s in songs if s.trackhash not in forgotten and s.album not in unplayed | quiet]
    for offset in range(21, 0, -1):
        if rng.random() > 0.35:
            continue
        name = rng.choice(list(playlists))
        chosen = rng.sample(pool, rng.randint(3, 5))
        session(today - dt.timedelta(days=offset), (12, 20), chosen, f"pl:{playlists[name]}")

    # On repeat: the last 7 days lean on one album well above its usual weekly rate.
    repeat = next(g for g in groups if g[0].album == "Pocket Weather")
    for offset in range(7, 0, -1):
        day = today - dt.timedelta(days=offset)
        session(day, (20, 22), repeat[:4], f"al:{repeat[0].albumhash}")

    # The Christmas station draws from the user's plays of the Christmas pool: a few sittings.
    christmas = [s for s in songs if is_christmas(s)]
    for offset in (5, 20, 35, 50):
        session(today - dt.timedelta(days=offset), (18, 22), christmas, f"al:{christmas[0].albumhash}")

    # "On this day": the same calendar day one and two years back.
    for years in (1, 2):
        try:
            anniversary = today.replace(year=today.year - years)
        except ValueError:  # 29 February
            anniversary = today.replace(year=today.year - years, day=28)
        for s in rng.sample([s for s in songs if s.album not in unplayed], 6):
            session(anniversary, (18, 22), [s], f"al:{s.albumhash}")

    plays.sort(key=lambda p: p["timestamp"])
    return plays


def seed_artist_images(api: Api, folder: Path) -> int:
    """Upload the portraits from make_library.py, matched to the artists by file name."""
    if not folder.is_dir():
        print(f"no artist pictures at {folder}, skipped")
        return 0
    by_name: dict[str, Path] = {p.stem.casefold(): p for p in folder.glob("*.jpg")}
    payload = api.must("GET", "/getall/artists?start=0&limit=100")
    done = 0
    for artist in payload.get("items", []):
        picture = by_name.get(str(artist.get("name", "")).casefold())
        if picture is None:
            continue
        status, _ = api.upload("/coverart/artist/upload", {"artisthash": artist["artisthash"]}, "image", picture)
        done += status == 200
    return done


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:19800", help="Base URL of the running server")
    parser.add_argument("--password", required=True, help="Password of the admin account")
    parser.add_argument("--music", required=True, help="Absolute path of the library from make_library.py")
    parser.add_argument(
        "--artist-images",
        default=None,
        help="Folder with the artist pictures (default: <music>-artists, as make_library.py writes it)",
    )
    parser.add_argument(
        "--today",
        default=None,
        help="Anchor date YYYY-MM-DD for the history (default: today). Fixing it makes the history identical across runs.",
    )
    args = parser.parse_args()

    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    rng = random.Random(SEED)
    api = Api(args.url)

    status, payload = api.call("POST", "/auth/login", {"username": "admin", "password": args.password})
    if status != 200:
        print(f"login failed: {status} {payload}", file=sys.stderr)
        return 1
    print("logged in as admin")

    api.must("POST", "/notsettings/add-root-dirs", {"new_dirs": [args.music], "removed": []})
    print("root dir added, waiting for the scan")
    wait_for(
        f"{ALBUM_COUNT} albums",
        lambda: (lambda n: n if n >= ALBUM_COUNT else None)(api.must("GET", "/getall/albums?limit=1")["total"]),
    )
    albums, songs = load_songs(api)
    print(f"library: {len(albums)} albums, {len(songs)} tracks")

    playlists = seed_playlists(api, albums, songs, rng)
    print(f"playlists: {len(playlists)} (folder 'Moods' holds 2), pinned 2 playlists + 1 album")
    favorites = seed_favorites(api, albums, songs)
    print(f"favourites: {len(favorites)} tracks, 3 albums, 2 artists")

    pictures = Path(args.artist_images) if args.artist_images else Path(args.music.rstrip("/") + "-artists")
    print(f"artist pictures: {seed_artist_images(api, pictures)} uploaded")

    plays = build_history(today, songs, playlists, favorites, rng)
    sent = 0
    for play in plays:
        status, _ = api.call("POST", "/logger/track/log", play)
        if status == 201:
            sent += 1
    print(f"history: {sent} of {len(plays)} plays recorded (anchor {today.isoformat()})")
    print("restart the server now so the Home rows are recomputed from this history")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
