# AivinNet

**Self-hosted music server with a web player of its own**

AivinNet streams your own audio library to a web player with a look of its own —
bold 90s/Memphis shapes and colours, in light and dark. Point it at a folder of
music, open it in a browser, and that is the whole idea. It is a Python/Flask
backend that serves a REST API plus the dedicated
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

Everything lives in `~/.config/aivinnet/` (database, covers, playlists) — that
directory is the only copy of your data, so back it up. Service configuration
(port, host) is `~/.config/aivinnet/aivinnet.env`; edit it and restart the
service.

> The directory was called `~/.config/swingmusic/` before v2026.8.0 and is moved
> automatically on first start of a newer version. If yours still carries the old
> name, that is the one to back up.

⚠️ The database is **three** files — `aivinnet.db` plus the `-wal` and `-shm`
sidecars SQLite keeps beside it in WAL mode. Copy them as a set, or the copy is
missing the most recent transactions.

### Other install paths

- **Single-file binaries** for Linux, Windows and macOS are attached to each
  [release](https://github.com/vwellenberg/AivinNet/releases). They are unsigned,
  so SmartScreen/Gatekeeper will warn.
- **Wheel** (`pip`/`uv`): needs Python 3.11+, and on Linux a compiler plus
  `libev-dev` for `bjoern`.
- **Docker**: see below.

None of these has an installer to hand you a password, so the server generates
one on its first start and prints it once — watch that first log. Set
`AIVINNET_ADMIN_PASSWORD` beforehand to choose it yourself, or run
`aivinnet --password-reset` if you miss it.

### Docker

```sh
curl -fsSLO https://raw.githubusercontent.com/vwellenberg/AivinNet/master/docker-compose.yml
printf 'AIVINNET_MUSIC_DIR=/path/to/your/music
AIVINNET_ADMIN_PASSWORD=pick-something
' > .env
docker compose up -d
```

Or without compose:

```sh
docker run -d --name aivinnet -p 1970:1970 \
  -v /path/to/your/music:/music \
  -v "$(pwd)/config:/config" \
  -e AIVINNET_ADMIN_PASSWORD=pick-something \
  ghcr.io/vwellenberg/aivinnet:latest
```

Then open `http://localhost:1970`, log in as `admin`, and pick `/music` as your
music folder — inside the container that is where your library appears.

Worth knowing:

- **Set the admin password before the first start.** `AIVINNET_ADMIN_PASSWORD`
  is read only while the admin account is created; after that it is ignored, and
  changing it later takes the profile screen (or `--password-reset`). Leave it
  unset and the server generates one and prints it to the container log once —
  `docker compose logs aivinnet` if you missed it scrolling past.
- **Back up `config/aivinnet`.** The app creates that subdirectory inside the
  `/config` volume and it holds the only copy of your database, covers and
  playlists. The database is three files (`aivinnet.db` plus its `-wal` and
  `-shm` sidecars) — copy them as a set.
- **The music volume is writable on purpose.** Editing tags writes back into your
  files, and lyrics fetched online are saved as `.lrc` next to the track. Mount
  it `:ro` if you would rather have neither.
- **The first start needs internet.** The image does not bundle the web client;
  it downloads it from the release matching the image version (falling back to
  the newest release).
- **The container runs as root**, so files under `config/` end up owned by root.
  To run as yourself, create and `chown` `config/` first, *then* set `user:` —
  Docker creates a missing bind path as root, and a non-root container cannot
  write into it (the compose file spells this out).

Upgrading is `docker compose pull && docker compose up -d`. Your data stays in
the `config` volume.

> ⚠️ **The web interface does not upgrade with it.** It is unpacked into the
> `config` volume on first start and kept as long as it is there, so a pulled
> image runs the new backend behind the previous release's UI. Until that is
> fixed, **rename** `config/aivinnet/client` (don't delete it) before starting the
> new version: the app then fetches the matching one, and if it cannot — no
> network, rate limited — you still have the old one to move back.
> Tracked in AivinNet-Client#551.

### Access from outside your network

**Do not port-forward this to the internet.** It listens without TLS, so it
belongs on a network you trust. (Cross-origin requests can no longer carry your
session cookie, but that hardens one attack — it does not make plain HTTP on an
open port a good idea.) Use a VPN — the setup below uses
[Tailscale](https://tailscale.com), which needs no open ports, no static IP and
no certificate of your own, and works from behind CGNAT.

On the machine running AivinNet, once:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale serve --bg 1970          # use your port if you changed it
```

`serve` puts AivinNet behind HTTPS at `https://<machine>.<tailnet>.ts.net` with a
real Let's Encrypt certificate, reachable **only from your own tailnet**. Your own
phones and laptops just install Tailscale, sign in, and open that URL. Access over
the LAN is unchanged — this adds a path, it does not replace one.

`tailscale status` prints the exact hostname to use.

#### Letting other people in

Give each person **their own account** (Settings → Accounts) rather than sharing
one: favourites, playlists and listening history all hang off the account, and a
shared login mixes everybody's together.

For the network side, use Tailscale's **node sharing**: in the admin console,
share the machine with their Tailscale account. They install Tailscale, accept
the invitation, and reach that one machine — they do **not** join your tailnet and
cannot see your other devices. Each share is revocable on its own.

> ⚠️ **`serve` and `funnel` are not the same thing.** `tailscale funnel` puts the
> same URL on the **public internet**. You almost certainly do not want that here:
> it exposes your whole library behind a single login form. Node sharing covers
> friends and family; funnel is for when a foreign *server* has to reach the URL.

#### If you put it behind any reverse proxy

The app then sees the proxy's address as the client address for every request.
Nothing in AivinNet depends on the client IP today — the login rate limit
deliberately counts usernames for exactly this reason — but keep it in mind before
adding anything that does.

### Privacy note

**Out of the box, nothing about your library leaves the machine.** Statistics,
top artists, recently played and search are all computed locally from your own
files and your own listening history.

Three things can talk to the internet, and each is off until you turn it on:

| Setting | What it sends, and to whom |
|---|---|
| **Online metadata** (`enableOnlineMetadata`) | During a library scan: every artist name to **Deezer** for artist images, and to **Last.fm** for similar artists. |
| **Lyrics finder** (plugin) | When you open the lyrics page: the track title and artist to **Musixmatch**. Found lyrics are saved as an `.lrc` file next to the track. |
| **Last.fm scrobbling** (plugin) | What you play, to **Last.fm**. Export-only — nothing comes back. |

Two things happen without a setting, because you asked for them by clicking:
cover-art search (**MusicBrainz**, **Cover Art Archive**, **iTunes**) and
MusicBrainz lookups. They run only on that click.

One more, and it is not optional: the **Docker** image does not bundle the web
interface and downloads it from GitHub on first start. The other install paths
ship it inside the artifact and need no network at all.

> **If you are upgrading:** this changed in favour of privacy, and only for new
> installs. Your existing settings are left exactly as they are — including a
> lyrics plugin that earlier versions switched on for you. Worth a look in
> Settings if you would rather it were off. Turning *on* online metadata is the
> same screen.

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

## Origin and attribution

AivinNet began as a fork of [swingmx/swingmusic](https://github.com/swingmx/swingmusic)
by Mungai Njoroge, and inherits its AGPL-3.0 licence — see below.

It has been developed independently since **June 2025**: the web client was
redesigned from the ground up, and multiroom playback, track editing, playlist
folders, the lyrics finder and the installer were built here. Upstream changes
are no longer merged. The web client fork carries its own MIT licence and
attribution.

---

## License

[GNU AGPL-3.0](LICENSE), inherited from Swing Music. In short: you may use,
modify and share it, but if you distribute it — including running a modified
version as a network service for others — the source has to stay available under
the same licence.
