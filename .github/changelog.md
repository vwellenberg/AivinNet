# AivinNet

Self-hosted music server with a Spotify-style web player for your own library.
Based on [Swing Music](https://github.com/swingmx/swingmusic) (AGPL-3.0), with a
redesigned web client and extended playlist, track-editing and multiroom features.

> [!NOTE]
> This body is the release-notes template used by the release workflow.
> Edit `.github/changelog.md` before cutting a release.

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

- _fill in per release_

## Notes

- Data lives in `~/.config/swingmusic/` (database, covers, playlists) — back this
  up, it is the only copy.
- `ffmpeg` is optional and only needed for transcoding.
- Reach it from outside your LAN via Tailscale or a VPN — do not port-forward it.
- Mix/recommendation features send track, artist and album names to
  `smcloud.mungaist.com` (upstream's service) to look up similar music.
