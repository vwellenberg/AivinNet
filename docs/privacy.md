# Privacy

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

