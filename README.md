# AivinNet

**Self-hosted music server — fork of [Swing Music](https://github.com/swingmx/swingmusic)**

AivinNet streams your own audio library to a Spotify-style web player. Point it at
a folder of music, open it in a browser, and that is the whole idea. It is a
Python/Flask backend that serves a REST API plus the dedicated
[AivinNet web client](https://github.com/vwellenberg/AivinNet-Client).

---

## Install (Linux)

```sh
curl -fsSL https://raw.githubusercontent.com/vwellenberg/AivinNet/master/install.sh | bash
```

That downloads the release AppImage for your architecture (x86_64 or aarch64),
verifies its checksum, installs it to `~/.local/bin/aivinnet`, and sets up a
systemd service that comes back after a reboot. It prints the URL and the
generated admin password when it is done.

Requirements: a glibc Linux with systemd. **No** Python, compiler, FUSE or
Docker needed — the AppImage is unpacked at install time, so `libfuse2` never
comes up. `ffmpeg` is optional and only used for transcoding.

### Options

```sh
curl -fsSL .../install.sh | bash -s -- --system --music /mnt/nas/music
```

| Option | Effect |
| --- | --- |
| `--system` | System-wide service (uses `sudo` for the unit file only). Starts before anyone logs in — pick this for an always-on server. |
| `--port <n>` | HTTP port, default `1970`. |
| `--host <addr>` | Bind address, default `0.0.0.0`. |
| `--music <path>` | Pre-selects the library folder **and** makes the service wait for that mount. |
| `--no-autostart` | Install the program without a service. |
| `--version <tag>` | Install a specific release instead of the latest. |
| `--update` | Same as re-running it: fetch the newest release, keep your data. |
| `--uninstall` | Remove service + program files, keep the library data. |

Default is a **user service** (`systemctl --user`, no root) with lingering
enabled so it survives logout and starts at boot. If lingering cannot be enabled
automatically, the installer tells you the one command to run.

> [!IMPORTANT]
> **`--music` matters if your library is on a NAS or external disk.** Without it,
> the service can start before that mount is ready; the library scan then finds
> no files and removes the missing tracks from the database, which leaves your
> playlists full of orphaned entries. `--music` adds `RequiresMountsFor=` to the
> unit so systemd waits.

### After installing

1. Open the printed URL, log in as `admin` with the generated password.
2. Pick your music folder (skipped if you passed `--music`).
3. Wait for the first scan — minutes to an hour, depending on library size.

Everything lives in `~/.config/swingmusic/` (database, covers, playlists) — that
directory is the only copy of your data, so back it up. Service configuration
(port, host) is `~/.config/aivinnet/aivinnet.env`; edit it and restart the
service.

### Other install paths

- **Single-file binaries** for Linux, Windows and macOS are attached to each
  [release](https://github.com/vwellenberg/AivinNet/releases). They are unsigned,
  so SmartScreen/Gatekeeper will warn.
- **Wheel** (`pip`/`uv`): needs Python 3.11+, and on Linux a compiler plus
  `libev-dev` for `bjoern`.
- **Docker**: `ghcr.io/vwellenberg/aivinnet` is built per release, but the
  AppImage is the maintained path right now.

### Access from outside your network

Use Tailscale or a VPN. Do not port-forward this to the internet: it listens
without TLS and allows any origin, so it belongs on a trusted network.

### Privacy note

Mix and recommendation features send track, artist and album **names** to
`smcloud.mungaist.com` (a service run by the upstream author) to look up similar
music. Everything else — statistics, top artists, recently played — is computed
locally from your own listening history. The Last.fm plugin is optional and
export-only.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Python 3.11+ |
| Web Framework | Flask |
| ORM / Database | SQLAlchemy (SQLite) |
| WSGI server | bjoern (Linux), waitress (Windows) |
| Audio Processing | FFmpeg |

---

## Development

See [CLAUDE.md](CLAUDE.md) for the working agreements (branch workflow, test
lanes, known gotchas).

```sh
uv sync                       # dependencies
uvx ruff check src/ tests/    # lint
```

The web client is a separate repository:
[vwellenberg/AivinNet-Client](https://github.com/vwellenberg/AivinNet-Client).

### Releasing

The `Release` workflow (`.github/workflows/build.yml`) is triggered manually. It
builds the client from `AivinNet-Client`, produces wheels, AppImages (x86_64 +
aarch64), single-file binaries and `SHA256SUMS`, and attaches everything to a
GitHub release. Edit `.github/changelog.md` first — it becomes the release body.

---

## Maintainer's own deployment

The author's instance runs as a systemd service named `aivinnet` from
`~/AivinNet` on a home server (this is not what the installer above sets up):

```sh
sudo systemctl restart aivinnet
journalctl -u aivinnet -f
```

---

## Upstream

This project is a fork of [swingmx/swingmusic](https://github.com/swingmx/swingmusic)
by Mungai Njoroge. Upstream features and fixes are merged selectively, keeping
the AivinNet branding and customisations intact. The web client fork carries its
own MIT licence and attribution.

---

## License

[GNU AGPL-3.0](LICENSE), inherited from Swing Music. In short: you may use,
modify and share it, but if you distribute it — including running a modified
version as a network service for others — the source has to stay available under
the same licence.
