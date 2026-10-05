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
starts at boot, and prints the URL plus the generated admin password. If
`ffmpeg` is missing it asks whether to install it — say yes: skipping the
silence between tracks needs it.

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
echo AIVINNET_MUSIC_DIR=/path/to/your/music > .env
docker compose up -d
docker compose logs -f aivinnet   # waits for the admin password (printed once), then Ctrl+C
```

`ghcr.io/vwellenberg/aivinnet:latest` — amd64 and arm64. Pick `/music` as your
music folder once the UI is up, and back up `config/aivinnet`. The first start
unpacks the web client bundled in the image — no download needed.

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

**A new Home, colours that tell you where you are, your files by hand — and
devices that really play together.** Home picks up where you left off, every
kind of thing in the library has its own colour, an album's titles and track
numbers can be fetched and applied, files can be named after their tags,
playlists get an edit mode, and multiroom playback holds devices within a few
milliseconds of each other.

### A new Home

- **Continue listening** brings back the album or playlist you did not finish,
  with what is up next and the playlist's own collage. Wide screens show up to
  three of them side by side.
- **Rediscover** digs out albums you played often and not in the last two
  months, and **On this day** shows what you listened to on this date a year
  ago.
- **Surprise me** (next to Rediscover) opens a random album from your library.
- Everything comes from your own listening history and your own files; nothing
  new leaves the server.

### Colours that tell you where you are

- **Every kind of thing has its colour**: albums lavender, artists lime,
  folders kraft, tracks sea, favourites gold, stats orchid. Browse tiles, page
  titles and the navigation wear it.
- **Albums and Artists are in the navigation** (on the desktop). The active
  entry comes to a point and reaches out towards the page it opened.
- **Favourites** says what each row previews, always offers "See all", and
  lists tracks last.
- **Folder rows** read like the song list: colour band, folder tile, number and
  a gauge for how much is in them.

### Tidy up an album

- **Titles & file names** in the album menu opens one dialog for three repairs.
  Fetch titles and track numbers from MusicBrainz, read them from the file
  names, or go the other way and name the files after their tags. You see every
  change before it is applied.
- **The track editor renames the file too.** Queues and playlists follow the
  rename.
- **Pick an artist's picture yourself**: upload one, or remove it.

### Library

- **Check library** (Settings → MusicBrainz) lists albums that a scan misread,
  for example a soundtrack that came out as ten albums by artists named "01" to
  "10". Each finding says why, and offers Merge (pick one artist), Open or
  Ignore.
- **File names no longer invent artists**: a leading track number is not an
  artist, and titles are no longer cut off.

### Playlists

- **Edit mode**: reorder and remove songs by finger, with an undo for every
  removal.

### Device sync

- **Calibrate by microphone or by ear.** Some delays are invisible to the
  browser (Bluetooth on Windows hides ~155 ms). One device listens to the
  others' clicks and trims each one. See [privacy](https://github.com/vwellenberg/AivinNet/blob/master/docs/privacy.md) for what the
  microphone is used for: the recording never leaves the device.
- **Devices stay within a few ms** of each other. Drift is steered by gently
  resampling instead of jumping, and each device reports how far off it is.
- Track changes happen once, together, and on time. A group shuffle keeps the
  playing song out of the front row. A device that the server forgot after a
  restart registers itself again.

### Also new

- **Auto dark mode follows a time zone**, and its schedule is adjustable.
- **Long-press opens every tile's menu**, which also works on iPhones and iPads.
- **The keyboard reaches everything**: the context menu, the settings, the
  profile menu and a dozen more controls.
- The quiet dark theme is now called **Boring**.
- **Removed:** the one-shot "shuffle the queue once". The shuffle button covers
  it.

### Fixed

- **Safari could not load the app**: JavaScript and styles broke off halfway.
- **Firefox could not play FLAC files** that a tagger had given an ID3 tag in
  front. The server now skips that tag while streaming; the file on disk stays
  as it is.
- **Album pages failed** on files tagged "track 1/12", and **m4a** files would
  not play in Firefox from the Docker image.
- **The Docker image ships its own web client**, built from the same version,
  instead of downloading one on first start.
- **A quick skip could silence the next song**: the fade of the previous one
  unloaded the player it was handed back.
- Editing a track that shares its tags with another file edits the right file,
  and a busy database can no longer drop a track from the library.
- Switching between Albums and Artists builds the page anew instead of showing
  the other one's list.
- **`install.sh --music` did nothing**: the folder went into a file the app
  never reads, and the app never scanned it on its own. A new install now comes
  up with its music, and any library that has folders but no tracks yet is
  scanned once at startup.
- **Two or more music folders**: no track would play. Every file was refused as
  "not inside the root directories".
- Search in an empty library answers "no results" instead of an error. The top
  result is a tile like every other one.
- The "Unknown" artist no longer shows a stranger's picture.
- Settings: dead options are gone, hidden ones are reachable, and turning on
  silence skip no longer stops the app.
- Play under shuffle avoids the song that is playing. A replaced queue starts a
  clean shuffle history. A queue full of missing files stops instead of racing
  through it.
- Navigation buttons that stopped working after a dropped connection reload the
  page instead.
- Phone: the UI is no longer stuck in the top half, the landscape bar fits, and
  list and menu rows are the right size.
- Long lists no longer flicker while scrolling, the next page loads when you get
  there, and the "Recently played" row is no longer one tile short.
- About shows the release version, not the client's build number.

### Safer

A full review before this release found these, and they are fixed:

- **Pairing codes** now work once, for 5 minutes, one per account, and guessing
  them is throttled. Before, a code that was never scanned stayed valid for ever.
- **No account can take another account's name** (it locked the other person
  out of their login).
- **The login screen no longer shows strangers who the admin is.**
- **Lyrics are read only from the song's own files**, never from a path the
  request names.
- **Last.fm** is spoken to over HTTPS; the session key no longer travels in the
  clear.
- **Covers and pictures** can no longer exhaust the server's memory (an animated
  GIF or a huge image), and charts and lists have sane page limits, so no
  account can freeze the server with one request.
- **The settings file is written safely**: a power cut while saving no longer
  leaves it broken. A failed tag edit's backup is never overwritten.

### Installer

- **A download cut short runs nothing** instead of half an update.
- **Updating keeps what you set up**: a system-wide service stays system-wide,
  and the "wait for the music drive" guard survives the update.
- A slow first start (big library, small machine) is no longer reported as a
  failed install; the address and password are always shown.

### Under the hood

- Dependencies are updated on both sides (server, and axios plus the build
  tools in the web client), and two unused ones (a load-testing tool and a
  memory profiler) are gone, which makes installs smaller.
- Every request the client makes is checked against the server's contract in
  CI. Last.fm scrobbles have a deadline.

### Upgrading

Nothing to do. If you used "shuffle once", press the shuffle button instead.
A pairing code that was open before the update is no longer valid; open the
pairing page again for a new one.

<details>
<summary>What v2026.9.0 brought</summary>


**A second look for the app, and a stack of fixes underneath it.** The design so
far — grid paper, ink frames, hard shadows — is called **Memphis** and stays the
default. Next to it there is now **Stream**: flat, dark, quiet. Same app, same
features, different language.

### Two themes, and light/dark is a separate question

Settings → Appearance holds **two** settings now, because they are two different
decisions:

> **Theme** — Memphis · Stream
> **Mode** — Light · Dark, plus Auto by time of day

**Stream** is dark only, and it leaves your Mode and Auto settings alone: switch
back to Memphis and you get exactly the brightness you had. It drops the frames,
shadows and textures for flat surfaces, states read from the text instead of a
fill, and the album/playlist/artist pages let the **colour of the cover** carry
the head instead of a panel. It brings its own typeface.

Memphis is untouched — not "should be", but measured: every element's computed
appearance was compared before and after, light and dark, desktop and phone,
including hover and press. 30,756 comparisons, zero differences.

### Fixed

- **Docker containers were killed, never stopped.** `docker stop` always ended in
  SIGKILL after the grace period, which can leave the database mid-write. The
  server now shuts down on the stop signal, drains open connections and closes
  the database.
- **The pages started at different heights on a phone.** Home, Playlists,
  Favorites, Albums and Stats each began somewhere between 24px and 80px below
  the top. Now they all start in the same place.
- **Settings changed during the very first run were forgotten** on restart.
- **A failed pairing spun forever** instead of showing what went wrong.
- **The installer asks about ffmpeg**, and the server says so at startup when it
  is missing — without it, skipping the silence between tracks does not work.
- **Logs live in `<config>/aivinnet/logs`** and old logs move there by themselves.
- **The startup banner** names AivinNet and lists only addresses you can actually
  open (`0.0.0.0` is not one of them).
- **Docker:** the image reports its real version, ships the placeholder artwork,
  resets the right account's password, and refuses a music path that does not
  exist instead of starting with an empty library.
- **The Windows binary** carries the AivinNet icon.
- Reduced-motion no longer flashes on the first paint; Home has a title like
  every other page; the password field asks for a password instead of showing a
  row of symbols.

### Under the hood

- **No third-party typefaces are shipped any more.** Two Apple fonts were bundled
  as webfonts, which their licence does not allow. Monospace text now uses the
  fonts your machine already has, so it looks the same and downloads nothing.
- The running-light animation pauses while nothing is playing.
- The dead transcoding path is gone — AivinNet streams your files as they are
  (see the README for the formats that play).

### Upgrading

Nothing to do. Docker users get the clean stop on the next `docker compose up -d`.

**From v2026.8.2 or older:** stop the server once, delete the `client` folder in
your data directory, start it again — older versions left no marker behind, so
that one generation has to be cleared by hand.

</details>

<details>
<summary>What v2026.8.5 brought</summary>


One change, and it is the first thing you see.

### The navigation is ordered by what you actually use

**Playlists moved from fifth place to second.** The sidebar — and the row of
buttons at the bottom on a phone — now reads:

> **Home · Playlists · Favorites** — *Search · Folders · Stats*

Destinations on top, tools underneath. Before this, Playlists sat behind Folders
and Search, which are the things you reach for when you are *looking* for
something rather than going somewhere. On a phone the difference is bigger than
it sounds: only five entries fit there, and Playlists used to be the last one.

That is the whole release. It is small on purpose — the screenshots and the
demo in the README show this order, and an install that shows a different one
is worse than no screenshots at all.

#### Upgrading

Nothing to do coming from v2026.8.3 or newer. **From v2026.8.2 or older:** stop
the server once, delete the `client` folder in your data directory, start it
again — older versions left no marker behind, so that one generation has to be
cleared by hand.

</details>

<details>
<summary>What v2026.8.4 brought</summary>


The biggest release since the security round: five fixes, a new sense of
movement throughout the app, and a tidier player on phones.

### Fixed

- **Hovering a track row drew the heart over the album title.** The last column
  held 152px of content in a 120px slot, so the overflow spilled left — 40px, at
  every window size. Every track list in the app was affected.
- **Restoring a backup left every playlist with the placeholder cover.** The
  pictures were in the backup the whole time; nothing ever copied them back.
  Restoring is additive, so a cover already on disk is kept, never overwritten.
- **The browser tab kept naming the playlist you looked at before.** The title
  was read once during setup, when the name had not arrived yet.
- **The third line of a card's name plate was cut off** — the plate was pinned
  to a height that fits two.
- **"Join group" and "Leave" looked like nothing had happened.** Both are round
  trips, and the panel shows the device list the server sends, which the next
  poll brings up to five seconds later. The buttons now say what they are doing.

### The app moves now

Things **arrive** instead of appearing: track rows step in, captions land like
stickers, cards and tab plates build with the page, and the playing row's band
drops in on the leading edge. Everything stays inside a quarter second — the
point is that it should not be noticeable the tenth time you see it.

Two deliberate exceptions, because you trigger them rarely and on purpose: a
small burst of confetti when you favourite something, and the shuffle glyph
turning a somersault when you switch it on.

⚠️ **`prefers-reduced-motion` is now respected everywhere.** If your system asks
for less movement, the app stops moving — one rule, the whole app. Before this,
four files answered that question and the rest ignored it.

### Better on a phone

The played and total time now flank the progress bar they label instead of
standing among the buttons; the repeat/shuffle/lyrics/devices controls read as
one cluster; and the devices button sits in the transport's row at the same
spacing as its neighbours.

### Upgrading

Nothing to do coming from v2026.8.3. **From v2026.8.2 or older:** stop the
server once, delete the `client` folder in your data directory, start it again —
older versions left no marker behind, so that one generation has to be cleared
by hand.

</details>

<details>
<summary>What v2026.8.3 fixed</summary>


Five fixes on top of v2026.8.2. One of them needs a single manual step if you
are upgrading — see the first point.

- **An upgrade now really replaces the web interface.** The interface is
  unpacked into your config directory, which survives every upgrade (in Docker
  it is a volume), so a newer server kept serving the older interface — quietly,
  for good. From this release on an upgrade refreshes it. **Upgrading from an
  older version, do this once:** stop the server, delete the `client` folder in
  your data directory, start it again. Fresh installs need nothing.
- **Downloads are named after the tags** — `Artist - Album - 07 Title.mp3`
  instead of whatever the file happens to be called on disk.
- **Albums and playlists can be downloaded as separate files**, not only as a
  ZIP. On a phone the ZIP is the wrong shape: it lands in Downloads and needs an
  unzip app, while single files arrive playable and keep their names.
- **Three settings did not do what they said.** Folders in `excludeDirs` were
  scanned anyway — the setting was stored and never read. A connectivity check
  set a three-second timeout on every socket in the process, permanently, and
  leaked one handle each time it ran. And `--password-reset` on a config
  directory that did not exist yet wrote an account that could never log in.
- **The interface no longer loads its font from Google.** It ships with the app,
  so nothing is fetched from outside when you open the player.

</details>

<details>
<summary>What v2026.8.2 fixed</summary>


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

</details>

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

- **Where your data lives** (database, covers, playlists) depends on how you
  started it: `~/.config/aivinnet/` with the one-line installer,
  `config/aivinnet/` next to the compose file with Docker, and `~/.aivinnet/`
  if you run the AppImage or a binary by hand. Back it up — it is the only
  copy, and it is three files for the database alone (`aivinnet.db` plus its
  `-wal` and `-shm` sidecars); copy them as a set.
- **Audio formats:** MP3, FLAC, M4A/ALAC, OGG, Opus, WAV, AIFF and WMA are
  scanned. Files are streamed **as they are** — there is no transcoding — so
  what plays is whatever your browser decodes. MP3, FLAC, M4A/AAC, OGG, Opus
  and WAV are safe everywhere; ALAC and WMA usually are not.
- Reach it from outside your LAN via Tailscale or a VPN — do not port-forward it.
- **Out of the box, nothing about your library leaves the machine.** Three
  things can talk to the internet and each is off until you switch it on:
  *online metadata* (artist images from Deezer, similar artists from Last.fm,
  during a scan), the *lyrics plugin* (title and artist to Musixmatch), and
  *Last.fm scrobbling* (export only). Cover-art and MusicBrainz lookups run when
  you click them. The Docker image is the one exception: it does not bundle the
  web interface and downloads it from GitHub on first start.
