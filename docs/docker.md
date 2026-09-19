# Docker

```sh
curl -fsSLO https://raw.githubusercontent.com/vwellenberg/AivinNet/master/docker-compose.yml
echo AIVINNET_MUSIC_DIR=/path/to/your/music > .env
docker compose up -d
docker compose logs -f aivinnet   # waits for the admin password (printed once), then Ctrl+C
```

Or without compose:

```sh
docker run -d --name aivinnet -p 1970:1970 \
  -v /path/to/your/music:/music \
  -v "$(pwd)/config:/config" \
  ghcr.io/vwellenberg/aivinnet:latest
docker logs -f aivinnet   # waits for the admin password (printed once), then Ctrl+C
```

Then open `http://localhost:1970`, log in as `admin`, and pick `/music` as your
music folder — inside the container that is where your library appears.

Worth knowing:

- **The admin password is generated and printed once.** On the very first start
  the server creates the `admin` account with a random password and prints it to
  the container log — there is no default to fall back to, and it is stored
  nowhere else. ⚠️ The log goes away when the container is recreated (every
  `docker compose pull && docker compose up -d`), so note it down straight away
  and change it in the profile screen if you want your own. Lost it anyway:
  `docker exec -it aivinnet python -m aivinnet --config /config --password-reset`.
  To choose it yourself, put `AIVINNET_ADMIN_PASSWORD=…` into the `.env`
  *before* the first start; it is ignored once the account exists.
- **Back up `config/aivinnet`.** The app creates that subdirectory inside the
  `/config` volume and it holds the only copy of your database, covers and
  playlists. The database is three files (`aivinnet.db` plus its `-wal` and
  `-shm` sidecars) — copy them as a set.
- **The music volume is writable on purpose.** Editing tags writes back into your
  files, and lyrics fetched online are saved as `.lrc` next to the track. Add
  `read_only: true` to it (`:ro` with `docker run`) if you would rather have
  neither.
- **The music folder has to exist.** compose refuses to start on a path that
  isn't there (`bind source path does not exist`) instead of creating an empty
  one — that is what a typo in `.env` would otherwise give you.
- **The first start needs internet.** The image does not bundle the web client;
  it downloads it from the release matching the image version (falling back to
  the newest release).
- **The container runs as root**, so files under `config/` end up owned by root.
  To run as yourself, create and `chown` `config/` first, *then* set `user:` —
  Docker creates a missing bind path as root, and a non-root container cannot
  write into it (the compose file spells this out).

Upgrading is `docker compose pull && docker compose up -d`. Your data stays in
the `config` volume.

The web interface is refreshed along with it: the server notices that the
client in `config/` was installed by an older version and fetches the matching
one. Only an install that started out on **v2026.8.2 or older** has to help
once — those left no version marker behind, so stop the container, delete
`config/aivinnet/client`, and start it again.

