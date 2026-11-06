# Demo instance for screenshots (#713)

A throwaway AivinNet server with a fictional library, playlists and listening history.
Every artist, album, title and cover is invented; no real music or personal data is involved.
Run everything from the repository root.

## 1. Generate the library

```bash
uv run --frozen python scripts/demo/make_library.py ~/aivinnet-demo/music
```

Writes 15 albums (14 albums and one "Various Artists" compilation), 113 tracks of 20-40 s MP3,
and one 800x800 cover per album. "Small Hours Folk" (Ondine Sky) has no cover, on purpose.
"Chrome Coastline" and "Pocket Weather" get synced lyrics (`.lrc` beside each track), and a
picture per artist lands next to the library in `~/aivinnet-demo/music-artists` (outside it, so
the scanner does not see them; `seed.py` uploads them).
The output is byte-identical on every run. Needs `ffmpeg` on `PATH`. The folder is replaced if it exists.

## 2. Start a throwaway server

```bash
AIVINNET_CONFIG_DIR=$HOME/aivinnet-demo/config \
AIVINNET_ADMIN_PASSWORD=demo-pass-713 \
uv run --frozen python run.py --port 19800
```

Keep this running in its own terminal. Its config and database live in `~/aivinnet-demo/config`.
Delete that folder to start from scratch. The admin user is `admin`.

## 3. Client

The API works without the web client. For the UI (and the screenshots), build the client and point
the server at it:

```bash
cd client && yarn install --frozen-lockfile --ignore-engines && npx vite build --outDir ~/aivinnet-demo/client
```

Then add `--client ~/aivinnet-demo/client` to the `run.py` command in step 2.

## 4. Seed

With the server from step 2 running, in a second terminal:

```bash
uv run --frozen python scripts/demo/seed.py \
  --url http://127.0.0.1:19800 \
  --password demo-pass-713 \
  --music ~/aivinnet-demo/music \
  --today 2026-11-04
```

The script adds the music folder as a root dir and waits for the scan. It then creates
5 playlists (two of them in the folder "Moods"), pins 2 playlists and 1 album, marks 10 tracks,
3 albums and 2 artists as favourites, uploads the artist pictures, and records about 590 plays from the last 10 weeks, plus
a few plays on this date one and two years back.

`--today` anchors the history. Leave it out to anchor on the current date. A fixed date gives the
same history on every run.

**Then restart the server** (Ctrl-C, and run step 2 again). Home rows and the radio are computed
at start-up and by the hourly and six-hourly jobs. The restart makes them reflect the new history.

## Check

```bash
curl -s -c /tmp/demo-cookies -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"demo-pass-713"}' http://127.0.0.1:19800/auth/login > /dev/null
curl -s -b /tmp/demo-cookies http://127.0.0.1:19800/nothome/ | head -c 300
```

The home response is a list of rows, each keyed by its row name, for example `on_this_day`.
Some rows depend on the history and can be empty for a different `--today`.

## Screenshots and the demo clip

With the seeded server (and the client from step 3) running, and Playwright available:

```bash
node scripts/demo/screenshots.js ~/aivinnet-demo/shots
node scripts/demo/demo-video.js ~/aivinnet-demo/video
```

The pictures are 2880x1800 (phone 780x1688) PNGs. The README takes them as WebP, plus `home.png`
at 1440x900 for the AppStream metadata (`appimage/aivinnet.appdata.xml` wants PNG or JPEG):

```bash
uv run --frozen python - <<'PY'
from pathlib import Path
from PIL import Image
src, dst = Path.home() / "aivinnet-demo/shots", Path("client/docs/screenshots")
for name in ["home", "home-dark", "album-dark", "lyrics", "stats",
             "phone-home", "phone-nowplaying", "phone-lyrics", "christmas"]:
    Image.open(src / f"{name}.png").convert("RGB").save(dst / f"{name}.webp", "WEBP", quality=82, method=6)
home = Image.open(src / "home.png").convert("RGB").resize((1440, 900), Image.LANCZOS)
home.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(dst / "home.png", optimize=True)
PY
```

The clip becomes the README GIF (800 px wide, 10 fps, about 4 MB):

```bash
ffmpeg -ss 0.8 -i ~/aivinnet-demo/video/*.webm \
  -vf "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  client/docs/screenshots/demo.gif
```

The page clock is fixed to 12 November (no season), the Christmas shot to 15 December. The server
keeps its real clock, so "x days ago" depends on when you seed and shoot.

## Season rehearsal

The seasons (Halloween, the Advent calendar, Christmas, New Year's Eve) only show on their
days, and half of what they show comes from the **server's** clock (the Advent door, the
Christmas and Countdown stations, which Rewind years are open), the other half from the
**browser's** (palette, effects, the countdown pill, the confetti). A rehearsal moves both to
the same moment. Moving only the browser hides exactly the bugs that live between the two: in
the December 2026 rehearsal, "Your year in music" never showed on 31 December, because the
server opened a year's Rewind only on 1 January (#729). Every client test was green.

Needs `faketime` (`apt-get install faketime`) and the seeded demo from steps 1-4 (with the
client built into `~/aivinnet-demo/client`). One call per day; each starts from a fresh copy of
the seeded config and stops its server again:

```bash
scripts/demo/rehearsal.sh dec01 "2026-12-01 10:00:00"
scripts/demo/rehearsal.sh dec10 "2026-12-10 19:00:00" --dark
scripts/demo/rehearsal.sh dec24 "2026-12-24 18:00:00" --dark
scripts/demo/rehearsal.sh dec31 "2026-12-31 17:59:50" --wait 3000 --after 9000
scripts/demo/rehearsal.sh nye "2026-12-31 23:59:50" --wait 3000 --after 9000
scripts/demo/rehearsal.sh jan01 "2027-01-01 15:00:00"
scripts/demo/rehearsal.sh jan02 "2027-01-02 12:00:00" --desk-only
```

Pick the days at the edges: the day before a season, its first and last day, the day after,
and the hours where something switches (18:00 and midnight on 31 December). `--after` takes a
second shot that much later, across the switch. Results land in `~/aivinnet-demo/rehearsal`:
a desktop and a phone shot per day (`--dark` adds a dark one), a JSON with the browser's clock,
the season classes and the Home headings, and `<day>-problems.txt` with console errors, page
errors and HTTP errors. The aim is an empty problems file and a server log without traceback.

Seed with `--today` close to the rehearsed days (e.g. the end of November), or the history is
months old by then and the history-based rows look emptier than they will.

⚠️ Two traps the script handles, both met while building it:

- **`uv` must not run under `faketime`.** A `uv` that has to sync reaches PyPI, and with the
  clock in the future every certificate reads as expired. The script syncs first and runs the
  environment's python under `faketime` directly.
- **Stop the whole process group.** `uv run` starts python as a child; killing `uv` leaves the
  server listening, and the next day's run then talks to the old server (same port), at the old
  date, without any error. The script starts the server with `setsid` and stops the group, and
  refuses to start while the port is taken. Do not stop it with `pkill -f "run.py --port …"`
  from a shell whose own command line contains that pattern: it matches the shell too.
