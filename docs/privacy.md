# Privacy

**Out of the box, nothing about your library leaves the machine.** Statistics,
top artists, recently played and search are all computed locally from your own
files and your own listening history.

Two things can talk to the internet, and each is off until you turn it on:

| Setting | What it sends, and to whom |
|---|---|
| **Online metadata** (Settings → Library → Artists) | During a library scan: every artist name to **Deezer** for artist images, and to **Last.fm** for similar artists. |
| **Lyrics finder** (Settings → Plugins) | When you open the lyrics page: the track title and artist to **Musixmatch**. Found lyrics are saved as an `.lrc` file next to the track. |

Some things happen without a setting, because you asked for them by clicking,
and they run only on that click:

- **Cover-art search** sends the album title and artist to **MusicBrainz**,
  **Cover Art Archive**, **iTunes** and **Deezer**.
- **Titles & file names** (album menu) sends the album title and artist to
  **MusicBrainz** when you pick the online lookup. The two file-name sources
  work on your own files and send nothing.
- **MusicBrainz lookups** of a single track or album.

**Sync calibration by microphone** (device sync) uses the microphone of the
device you calibrate from, and only while the calibration runs. The recording
is analysed in the browser and never leaves the device. What goes to *your own*
server is the timing numbers of each click, and only a few recent runs are kept,
in memory, for diagnosis. The browser asks for microphone permission first.
Calibration by ear needs no microphone at all.

One more, and it is not optional: the **Docker** image does not bundle the web
interface and downloads it from GitHub on first start. The other install paths
ship it inside the artifact and need no network at all.

> **If you are upgrading:** this changed in favour of privacy, and only for new
> installs. Your existing settings are left exactly as they are — including a
> lyrics plugin that earlier versions switched on for you. Worth a look in
> Settings → Plugins if you would rather it were off.

---

