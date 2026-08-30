# Docker

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

