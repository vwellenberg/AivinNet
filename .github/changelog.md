# AivinNet

Self-hosted music server for your own library, with a web player of its own —
bold 80s/Memphis shapes and colours, in light and dark.

Originally forked from [Swing Music](https://github.com/swingmx/swingmusic) and
licensed AGPL-3.0; developed independently since June 2025.

<!--
  This file IS the release body (`bodyFile` in .github/workflows/build.yml), so
  everything here is read by whoever downloads the release. Keep maintainer
  notes inside HTML comments like this one — a normal blockquote telling people
  to "edit this template" shipped as the first thing in the release text.
  Update "What's new" before cutting a release.
-->

## Install (Linux)

```sh
curl -fsSL https://raw.githubusercontent.com/vwellenberg/AivinNet/master/install.sh | bash
```

Installs the AppImage to `~/.local/bin/aivinnet`, sets up a systemd service that
starts at boot, and prints the URL plus the generated admin password.

Options: `| bash -s -- --system` (system-wide service), `--port 1971`,
`--music /mnt/nas/music`, `--no-autostart`, `--update`, `--uninstall`.

Manual instead — download the AppImage for your architecture from the assets
below, then:

```sh
chmod +x aivinnet-*.AppImage
./aivinnet-*.AppImage
```

Then open `http://localhost:1970`, log in, and pick your music folder.

## Install (Docker)

```sh
curl -fsSLO https://raw.githubusercontent.com/vwellenberg/AivinNet/master/docker-compose.yml
# point the music volume at your library, set the admin password
docker compose up -d
```

`ghcr.io/vwellenberg/aivinnet:latest` — amd64 and arm64. Pick `/music` as your
music folder once the UI is up, and back up `config/aivinnet`. The first start
downloads the web client, so it needs internet.

## Assets

| Asset | For |
| --- | --- |
| `aivinnet-v*-x86_64.AppImage` | Linux (Intel/AMD) — recommended |
| `aivinnet-v*-aarch64.AppImage` | Linux ARM64 (Raspberry Pi 4/5) |
| `aivinnet_linux_*`, `aivinnet_windows_*.exe`, `aivinnet_darwin_arm64` | single-file binaries |
| `aivinnet-*.whl` | pip/uv install (needs Python 3.11+, and a compiler for `bjoern` on Linux) |
| `client.zip` | built web client on its own |
| `SHA256SUMS` | checksums for every asset above |

The Docker image is not an asset here — it lives in the container registry:
`ghcr.io/vwellenberg/aivinnet:latest` (and `:v<version>`).

Windows and macOS binaries are unsigned — SmartScreen/Gatekeeper will warn.

## What's new in this release

A follow-up to v2026.8.1 with four fixes that landed after it was cut. Two of
them can stop the server, so this is worth taking.

- **The lyrics finder could freeze the whole server.** When Musixmatch
  rate-limited us it answered 401, and the code met that with a 13-second sleep
  and a call to itself — with no depth limit. Since 401 is exactly what
  rate-limiting looks like, the retry kept re-triggering itself: everyone's
  playback stopped, 13 seconds at a time, for hours. It no longer retries; while
  we are rate-limited there are simply no lyrics.
- **Downloading a big album could exhaust memory.** The ZIP was assembled in RAM
  before anything was sent, so a 2 GB album asked for 2 GB (measured: 1921 MB
  peak, now 35 MB). It is built on disk now, and there is a new
  `maxDownloadSizeMB` setting — 1 GB by default, `0` to disable — that refuses an
  oversized archive up front instead of trying and failing.
- **Logging out now actually ends the session.** Tokens last 30 days and renew
  themselves, so before this, logging out only cleared the browser's cookie and
  changing your password left every older token working. Both now end every
  session that account has open. Changing your own password keeps you signed in.
- **The installer told you a password that did not work** if you used
  `--no-autostart`: without a service there is no environment file, so the
  server generated its own and printed it to a log you were not watching. It now
  prints the two lines that start it properly.

Upgrading is safe and needs nothing from you: existing logins keep working, and
the database gains its new column on the first start.

<details>
<summary>What v2026.8.1 fixed (the security release before this one)</summary>

**Security — if you skipped v2026.8.1, read this.** Two reviews, the second a
full audit of the server and the web client. Two of the defects affected every
install, not just multi-user ones.

- Every install except the one-line installer came up with the password `admin`.
  A fresh install now generates one and prints it once, at first start.
- Any website you visited while logged in could drive the API as you. It cannot
  any more, and the session cookie is `SameSite=Strict`.
- Appending a file extension to a URL could switch authentication off. Access is
  decided per route now.
- Cover art, profile pictures and the API documentation page were readable by
  anyone who could reach the port. All three need a login.
- Any account could delete other people's playlists, and two endpoints took a
  filesystem path straight from the request.
- The database, its sidecars and the settings file were world readable — every
  password hash, and the key that signs login tokens. Owner-only now.
- Request size is capped, images have a decode limit, and the browser security
  headers that were missing entirely are there.
- **Nothing phones home by default any more.** Scanning used to send every
  artist name to Deezer and Last.fm, and the lyrics page sent title and artist to
  Musixmatch. Both are off unless you turn them on.

</details>

**Docker** — `ghcr.io/vwellenberg/aivinnet`, amd64 and arm64. See
[docs/docker.md](https://github.com/vwellenberg/AivinNet/blob/master/docs/docker.md);
note that `docker compose pull` does not replace the bundled web interface.

<details>
<summary>What this fork adds on top of Swing Music (from the first release)</summary>

**Player and library**

- Redesigned web client — a bold 80s/Memphis look with light and dark themes
  that follow your system, and a layout built for touch as much as for desktop.
- **Lyrics** for anything in your library: local `.lrc` files and embedded tags
  are used first, and anything missing can be fetched online and saved next to
  the track — switch the lyrics plugin on for that. Synced lyrics scroll along
  and are clickable to seek.
- **Track editing** — fix titles, artists, albums and covers from inside the app,
  written straight back into the file tags.
- **Playlists** with folders, drag-and-drop reordering that cannot lose tracks,
  pinning, and covers generated from the tracks inside.
- Favourites, a full search with recent searches, and listening stats with charts
  for your top tracks, artists, albums and playlists.

**Multiroom (device sync)**

- Devices on the same account play **in sync** — start something on your phone
  and let it come out of the speakers in another room. Every device can control
  playback; volume and mute stay per device. Pair a new one by scanning a QR code.

**Running it**

- One-line installer with a systemd service that survives reboots, an AppImage
  that needs no FUSE, and builds for x86_64 and ARM64 (Raspberry Pi 4/5).
- If your music sits on an external or network mount, `--music` makes the service
  wait for that mount — a scan against an unmounted folder would otherwise drop
  those tracks from the library.

</details>

## Notes

- Data lives in `~/.config/aivinnet/` (database, covers, playlists) — back this
  up, it is the only copy. It is three files for the database alone
  (`aivinnet.db` plus its `-wal` and `-shm` sidecars); copy them as a set.
- `ffmpeg` is optional and only needed for transcoding.
- Reach it from outside your LAN via Tailscale or a VPN — do not port-forward it.
- **Out of the box, nothing about your library leaves the machine.** Three
  things can talk to the internet and each is off until you switch it on:
  *online metadata* (artist images from Deezer, similar artists from Last.fm,
  during a scan), the *lyrics plugin* (title and artist to Musixmatch), and
  *Last.fm scrobbling* (export only). Cover-art and MusicBrainz lookups run when
  you click them. The Docker image is the one exception: it does not bundle the
  web interface and downloads it from GitHub on first start.
