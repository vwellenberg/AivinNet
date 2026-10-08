"""
Every main page of a running server answers, after a real scan of the e2e library.

Asks what the client asks when someone clicks through the app: Home, the album
and artist lists, every album and artist page, every folder, search, a
playlist, favourites, the charts, a stream. Each call must answer 200 (206 for
a ranged stream). The unit and API tests run against hand-made stores; this
runs against the built server and a scanned library — the layer where Home
broke in 2026.10.2 (#388) and dated pages broke on a host with a bad timezone,
with every other test green.

⚠️ It WRITES: a playlist, favourites, a play. Run it against a throwaway
instance (CI, the release test containers), never against a live library.

Usage: python3 e2e/check_pages.py <base url> <admin password> <music root as the server sees it>
Exit code 1 lists every failure.
"""

import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE, PASSWORD, ROOT = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3].rstrip("/")
MIN_ALBUMS = 10  # make_library.py writes 11; the untagged file may or may not make one

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
failures: list[str] = []
checked = 0


def call(method: str, path: str, body=None, headers=None, ok=(200,)):
    """One request; a failure is recorded, not raised, so one run lists them all."""
    global checked
    checked += 1
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})}
    )
    try:
        with opener.open(req, timeout=60) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    except Exception as e:
        failures.append(f"{method} {path}: {e.__class__.__name__}: {e}")
        return None

    if status not in ok:
        failures.append(f"{method} {path}: HTTP {status} {raw[:160]!r}")
        return None
    try:
        return json.loads(raw) if raw[:1] in (b"{", b"[") else raw
    except ValueError:
        failures.append(f"{method} {path}: not JSON {raw[:120]!r}")
        return None


def q(value: str) -> str:
    return urllib.parse.quote(value, safe="")


# ---------------------------------------------------------------- scan
if call("POST", "/auth/login", {"username": "admin", "password": PASSWORD}) is None:
    sys.exit("login failed: " + "; ".join(failures))

call("POST", "/notsettings/add-root-dirs", {"new_dirs": [ROOT], "removed": []})
call("GET", "/notsettings/trigger-scan")

total, stable = 0, 0
for _ in range(90):
    page = call("GET", "/getall/albums?start=0&limit=100&sortby=created_date&reverse=1") or {}
    now = page.get("total", 0) if isinstance(page, dict) else 0
    stable = stable + 1 if now == total and now >= MIN_ALBUMS else 0
    total = now
    if stable >= 2:
        break
    time.sleep(2)
print(f"scanned: {total} albums")
if total < MIN_ALBUMS:
    failures.append(f"scan found {total} albums, expected at least {MIN_ALBUMS}")

# ---------------------------------------------------------------- lists
albums = (call("GET", "/getall/albums?start=0&limit=100&sortby=created_date&reverse=1") or {}).get("items", [])
for key in ("title", "albumartists", "date", "trackcount", "playcount", "duration", "lastplayed"):
    call("GET", f"/getall/albums?start=0&limit=50&sortby={key}&reverse=")
artists = (call("GET", "/getall/artists?start=0&limit=100&sortby=name&reverse=") or {}).get("items", [])
for key in ("created_date", "albumcount", "trackcount", "playcount"):
    call("GET", f"/getall/artists?start=0&limit=50&sortby={key}&reverse=1")

# ---------------------------------------------------------------- album and artist pages
tracks = []
for a in albums:
    h = a["albumhash"]
    info = call("POST", "/album", {"albumhash": h, "albumlimit": 7}) or {}
    tracks.extend(info.get("tracks", []) if isinstance(info, dict) else [])
    call("GET", f"/album/{h}/tracks")
for ar in artists:
    h = ar["artisthash"]
    call("GET", f"/artist/{h}?tracklimit=5&albumlimit=7")
    call("GET", f"/artist/{h}/albums?albumlimit=0&all=true")
    call("GET", f"/artist/{h}/tracks")
print(f"{len(albums)} album pages, {len(artists)} artist pages, {len(tracks)} tracks")


# ---------------------------------------------------------------- folders
def walk(folder: str, depth: int = 0):
    page = call("POST", "/folder", {"folder": folder, "start": 0, "limit": 50, "tracks_only": False}) or {}
    if depth < 8 and isinstance(page, dict):
        for sub in page.get("folders", []):
            walk(sub["path"], depth + 1)


walk("$home")
walk(ROOT)
mixed = call("GET", f"/folder/tracks/all?path={q(ROOT + '/Mixed')}") or {}
if isinstance(mixed, dict) and len(mixed.get("tracks", [])) != 3:
    failures.append(f"/folder/tracks/all for Mixed: {len(mixed.get('tracks', []))} tracks, expected 3")

# ---------------------------------------------------------------- search
for term in ("dawn", "Hoppípolla", "夜", "various", "weather", "feat", "echo", "zzzz"):
    call("GET", f"/search/top?q={q(term)}&limit=6")
    for kind in ("tracks", "albums", "artists", "folders"):
        call("GET", f"/search/?q={q(term)}&itemtype={kind}&start=0&limit=20")

# ---------------------------------------------------------------- writes: playlist, favourites, a play
if albums and tracks:
    first = tracks[0]
    created = call("POST", "/playlists/new", {"name": "E2E"}, ok=(200, 201)) or {}
    pid = (created.get("playlist") or {}).get("id") if isinstance(created, dict) else None
    if pid is not None:
        call(
            "POST",
            f"/playlists/{pid}/add",
            {"itemtype": "album", "itemhash": albums[0]["albumhash"], "sortoptions": {}},
        )
        call("GET", f"/playlists/{pid}?start=0&limit=50")
        call("GET", f"/playlists/{pid}?start=0&limit=-1")
    call("GET", "/playlists")
    # Home's "On repeat" served as a playlist; empty on a fresh library, still 200.
    call("GET", "/playlists/onrepeat?start=0&limit=50")
    call("POST", "/favorites/add", {"hash": first["trackhash"], "type": "track"})
    call("POST", "/favorites/add", {"hash": albums[0]["albumhash"], "type": "album"})
    call("GET", "/favorites?track_limit=6&album_limit=6&artist_limit=6")
    for kind in ("tracks", "albums", "artists"):
        call("GET", f"/favorites/{kind}?start=0&limit=-1" if kind == "tracks" else f"/favorites/{kind}?start=0&limit=6")
    call(
        "POST",
        "/logger/track/log",
        {
            "trackhash": first["trackhash"],
            "timestamp": int(time.time()),
            "duration": 5,
            "source": f"al:{first['albumhash']}",
        },
        ok=(200, 201),
    )
    call(
        "GET",
        f"/file/{first['trackhash']}/legacy?filepath={q(first['filepath'])}",
        headers={"Range": "bytes=0-1023"},
        ok=(200, 206),
    )

# ---------------------------------------------------------------- Home, recents, charts (after the play)
home = call("GET", "/nothome/?limit=9")
if isinstance(home, list) and not home:
    failures.append("Home has no rows after a scan and a play")
call("GET", "/nothome/recents/added?limit=9")
call("GET", "/nothome/recents/played?limit=9")
for chart in ("top-tracks", "top-artists", "top-albums", "top-playlists"):
    for duration in ("week", "alltime"):
        call("GET", f"/logger/{chart}?duration={duration}&limit=10")
call("GET", "/logger/stats")

# ---------------------------------------------------------------- verdict
print(f"{checked} requests, {len(failures)} failed")
for f in failures:
    print("FAIL", f)
sys.exit(1 if failures else 0)
