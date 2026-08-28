# AivinNet

Self-hosted music server for your own library, with a web player of its own —
bold 90s/Memphis shapes and colours, in light and dark.

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

**Security — please update.** This release closes four ways an ordinary account
could take over the server. If you have given anyone else an account, or ever
plan to, update before you do.

- The settings endpoint handed out the server's `serverId` to **every logged-in
  account**. That value signs the login tokens *and* salts the passwords, so
  anyone holding it could mint themselves an admin token — which made every
  permission check in the app decorative. It never leaves the server now.
- `PUT /auth/profile/update` took the target account id straight from the
  request without checking whose it was, so any account could set the admin's
  password. Non-admins can only update themselves now.
- The login had **no rate limit at all**. An account now locks for 60 seconds
  after 8 wrong attempts, refusing immediately rather than delaying (a delay
  would stall the whole server for everyone else).
- The routes that change the shared library — scan trigger, cover writes, the
  MusicBrainz fetches, tag editing, and the one that opens a file manager on the
  server — are admin-only, and the client no longer offers them to anyone else.

Also: deleting a user by a name that does not exist answered "deleted" without
deleting anything, and the Last.fm credentials went to every account.

**New: a Docker image.** `ghcr.io/vwellenberg/aivinnet:latest`, amd64 and arm64,
with a `docker-compose.yml` in the repo root. The one-line installer is
unchanged — this is an additional way in, not a replacement.

<details>
<summary>What this fork adds on top of Swing Music (from the first release)</summary>

**Player and library**

- Redesigned web client — a bold 90s/Memphis look with light and dark themes
  that follow your system, and a layout built for touch as much as for desktop.
- **Lyrics** for anything in your library: local `.lrc` files and embedded tags
  are used first, and anything missing is fetched online automatically and saved
  next to the track. Synced lyrics scroll along and are clickable to seek.
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
- Two features talk to the internet, both switchable off in Settings:
  **lyrics lookup** sends the track title and artist to Musixmatch (on by
  default), and **mixes/recommendations** send track, artist and album names to
  `smcloud.mungaist.com` (upstream's service). Nothing else leaves your machine.
