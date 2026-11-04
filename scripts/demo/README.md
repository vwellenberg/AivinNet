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
The output is byte-identical on every run. Needs `ffmpeg` on `PATH`. The folder is replaced if it exists.

## 2. Start a throwaway server

```bash
AIVINNET_CONFIG_DIR=$HOME/aivinnet-demo/config \
AIVINNET_ADMIN_PASSWORD=demo-pass-713 \
uv run --frozen python run.py --port 19800
```

Keep this running in its own terminal. Its config and database live in `~/aivinnet-demo/config`.
Delete that folder to start from scratch. The admin user is `admin`.

## 3. Client (optional)

The API works without the web client. To see the UI in a browser, build the client and point the
server at it. This step was not verified in the demo run:

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
3 albums and 2 artists as favourites, and records about 590 plays from the last 10 weeks, plus
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
