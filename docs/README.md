# Documentation

Pages the README links to, plus the internals.

## Running it

- **[docker.md](docker.md)** — the container image, compose file, and the two
  things that surprise people (where the data lives, and that the web interface
  is not replaced by a `pull`).
- **[remote-access.md](remote-access.md)** — reaching your server from outside
  the LAN without opening a port, using Tailscale.
- **[privacy.md](privacy.md)** — exactly what can leave the machine, to whom,
  and which setting controls it. Nothing is on by default.

## Internals

- **[architecture.md](architecture.md)** — layers, data flow, and the two
  constraints everything else follows from: the library lives in RAM, and the
  server handles one request at a time.
