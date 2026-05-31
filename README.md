# AivinNet

**Self-hosted music player backend — fork of [SwingMusic](https://github.com/swingmx/swingmusic)**

AivinNet is a Python/Flask backend that powers a personal, self-hosted music streaming experience inspired by Spotify. It serves a local audio library over a REST API and pairs with the dedicated AivinNet web client.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Python 3 |
| Web Framework | Flask |
| ORM / Database | SQLAlchemy |
| Audio Processing | FFmpeg |

---

## Related Repositories

- **Frontend (Web Client):** [vwellenberg/AivinNet-Client](https://github.com/vwellenberg/AivinNet-Client)

---

## Server Deployment

The backend runs as a **systemd service** on a home server at `192.168.0.4`.

```
Server path: ~/SubspaceRadio   (legacy folder name — rename pending)
Service:     subspaceradio     (legacy service name — rename pending)
```

Useful commands:

```sh
# Start / stop / restart
sudo systemctl start subspaceradio
sudo systemctl stop subspaceradio
sudo systemctl restart subspaceradio

# View logs
journalctl -u subspaceradio -f
```

---

## Upstream

This project is a fork of [swingmx/swingmusic](https://github.com/swingmx/swingmusic). Upstream features and fixes may be merged selectively to keep the AivinNet branding and customizations intact.

---

## License

[MIT](LICENSE)
