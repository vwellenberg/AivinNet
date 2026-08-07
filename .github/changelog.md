# AivinNet

Self-hosted music server with a Spotify-style web player for your own library.
Based on [Swing Music](https://github.com/swingmx/swingmusic) (AGPL-3.0), with a
redesigned web client and extended playlist, track-editing and multiroom features.

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

## Assets

| Asset | For |
| --- | --- |
| `aivinnet-v*-x86_64.AppImage` | Linux (Intel/AMD) — recommended |
| `aivinnet-v*-aarch64.AppImage` | Linux ARM64 (Raspberry Pi 4/5) |
| `aivinnet_linux_*`, `aivinnet_windows_*.exe`, `aivinnet_darwin_arm64` | single-file binaries |
| `swingmusic-*.whl` | pip/uv install (needs Python 3.11+, and a compiler for `bjoern` on Linux) |
| `client.zip` | built web client on its own |
| `SHA256SUMS` | checksums for every asset above |

Windows and macOS binaries are unsigned — SmartScreen/Gatekeeper will warn.

## What's new

First public build. What it adds on top of Swing Music:

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

## Notes

- Data lives in `~/.config/swingmusic/` (database, covers, playlists) — back this
  up, it is the only copy.
- `ffmpeg` is optional and only needed for transcoding.
- Reach it from outside your LAN via Tailscale or a VPN — do not port-forward it.
- Two features talk to the internet, both switchable off in Settings:
  **lyrics lookup** sends the track title and artist to Musixmatch (on by
  default), and **mixes/recommendations** send track, artist and album names to
  `smcloud.mungaist.com` (upstream's service). Nothing else leaves your machine.
