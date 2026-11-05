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
