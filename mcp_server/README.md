# AivinNet MCP server

Lets an MCP client (e.g. Claude) manage an AivinNet library via tools: playlists
and track tags.

## Tools

### Playlists

| Tool | What it does |
| --- | --- |
| `list_playlists` | All playlists (id, name, count, pinned) |
| `get_playlist(playlist_id)` | Playlist info + tracks (incl. trackhashes) |
| `move_playlist_track(playlist_id, trackhash, before_trackhash)` | Move one track before another (`None` = to the end) — same operation as the UI's drag-and-drop |
| `sort_playlist_tracks(playlist_id, by, reverse)` | Sort tracks by `title`/`artist`/`album`/`duration` and save the order |
| `prune_orphan_tracks(playlist_id)` | Drop entries whose track no longer exists in the library |
| `create_playlist(name)` | New empty playlist |
| `rename_playlist(playlist_id, name)` | Rename (name only) |
| `pin_playlist(playlist_id)` | Toggle pin |

`sort_playlist_tracks` **refuses** to run when a playlist stores more tracks
than resolve. `/reorder` replaces the whole stored hash list, and the API only
hands back tracks that still resolve — sorting such a playlist would silently
delete the orphans. Run `prune_orphan_tracks` first if that is what you want.

### Track tags

| Tool | What it does |
| --- | --- |
| `set_track_tags(trackhash, artists, albumartists, title, album, track)` | Write tags to the file and reindex |

Only the fields you pass are changed. Backed by `PUT /track/<trackhash>/tags`,
which is **admin only** — it rewrites files on disk.

The trackhash is derived from title/album/artist, so editing any of those gives
the track a **new** trackhash and the old one stops resolving. The backend
repoints playlist, favorite and history references; the tool returns both
`old_trackhash` and the new `trackhash`.

Planned next: custom ordering of the playlist *list* (needs a `position` field
in the backend).

## How it runs here

The server talks to the AivinNet API over HTTP, so it runs **on the machine that
hosts AivinNet** and the MCP client reaches it over SSH stdio.

`run_mcp.sh` (not in git — it holds the token) sets the environment and execs a
fixed venv:

```bash
#!/usr/bin/env bash
# Launcher for the AivinNet MCP server (stdio). Fixed venv = fast, no uv resolve.
export AIVINNET_URL=http://localhost:1970
export AIVINNET_TOKEN=<jwt>
exec "$HOME/AivinNet/mcp_server/.venv/bin/python" "$HOME/AivinNet/mcp_server/server.py"
```

Create that venv once:

```bash
cd ~/AivinNet/mcp_server
uv venv .venv && uv pip install --python .venv/bin/python mcp requests
chmod +x run_mcp.sh
```

⚠️ Do **not** go back to `uv run --with mcp --with requests python server.py`.
That re-resolves the dependencies on every start, which is slow enough to blow
the MCP client's init timeout.

## Client config

```json
{
  "mcpServers": {
    "aivinnet": {
      "command": "C:\Windows\System32\OpenSSH\ssh.exe",
      "args": [
        "-i", "C:\Users\<you>\.ssh\id_ed25519",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "<user>@<host>",
        "~/AivinNet/mcp_server/run_mcp.sh"
      ]
    }
  }
}
```

⚠️ **Windows: use the full path to `ssh.exe`.** Claude Code and Claude Desktop
spawn the command through `cmd.exe`, which does not resolve a bare `ssh` — the
symptom is `MCP error -32000: Connection closed`, with
`'ssh' is not recognized…` in the log.

On Linux/macOS a plain `"command": "ssh"` is fine. Running against a local
AivinNet works too — point `command` at the venv's Python and set
`AIVINNET_URL` / `AIVINNET_TOKEN` in `env`.

## Auth

Auth uses `Authorization: Bearer <jwt>` (the API allows JWT in headers,
`JWT_TOKEN_LOCATION=["cookies","headers"]`). `set_track_tags` needs the token to
belong to an **admin** user.

Mint a token on the server without a password. Default expiry is 30 days, so
pass `expires_delta` for a long-lived one:

```bash
cd ~/AivinNet && ~/.local/bin/uv run python -c "
import datetime as dt
from aivinnet.app_builder import app, config_jwt
from aivinnet.db.userdata import UserTable
from flask_jwt_extended import create_access_token
config_jwt(app)
app.app_context().push()
user = list(UserTable.get_all())[0]
print(create_access_token(identity=user.todict(), expires_delta=dt.timedelta(days=365)))
"
```

Alternatively set `AIVINNET_USER`/`AIVINNET_PASS` — a 401 then triggers an
automatic re-login.

## Env

| Variable | Meaning |
| --- | --- |
| `AIVINNET_URL` | Base URL (default `http://localhost:1970`) |
| `AIVINNET_TOKEN` | Pre-minted JWT (preferred) |
| `AIVINNET_USER` / `AIVINNET_PASS` | Used to (re)login if no/expired token |

## Testing without a client

Pipe a JSON-RPC handshake into the launcher:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | ~/AivinNet/mcp_server/run_mcp.sh
```
