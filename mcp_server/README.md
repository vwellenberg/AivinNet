# AivinNet MCP server

Lets an MCP client (e.g. Claude) manage AivinNet playlists via tools.

## Tools (phase 1–3)

| Tool | What it does |
| --- | --- |
| `list_playlists` | All playlists (id, name, count, pinned) |
| `get_playlist(playlist_id)` | Playlist info + tracks |
| `sort_playlist_tracks(playlist_id, by, reverse)` | Sort tracks by `title`/`artist`/`album`/`duration` and save the order |
| `create_playlist(name)` | New empty playlist |
| `rename_playlist(playlist_id, name)` | Rename (name only) |
| `pin_playlist(playlist_id)` | Toggle pin |

Planned next: custom ordering of the playlist *list* (needs a `position`
field in the backend).

## Setup

1. Install deps (Python 3.10+):

   ```bash
   pip install -r requirements.txt      # or: uv pip install -r requirements.txt
   ```

2. Get a token. Easiest: mint one on the AivinNet server (no password):

   ```bash
   ssh <server> "cd ~/AivinNet && uv run python -c \"from swingmusic.app_builder import app, config_jwt; from swingmusic.db.userdata import UserTable; from flask_jwt_extended import create_access_token; config_jwt(app); app.app_context().push(); print(create_access_token(identity=list(UserTable.get_all())[0].todict()))\""
   ```

   (Tokens last 30 days. Alternatively set `AIVINNET_USER`/`AIVINNET_PASS`
   and the server logs in / refreshes automatically.)

3. Register with Claude Code:

   ```bash
   claude mcp add aivinnet -- python /ABS/PATH/mcp_server/server.py
   ```

   or add to your MCP config (`.mcp.json` / Claude settings):

   ```json
   {
     "mcpServers": {
       "aivinnet": {
         "command": "python",
         "args": ["/ABS/PATH/SubspaceRadio/mcp_server/server.py"],
         "env": {
           "AIVINNET_URL": "http://192.168.0.4:1970",
           "AIVINNET_TOKEN": "<jwt>"
         }
       }
     }
   }
   ```

4. Restart Claude. The `aivinnet` tools become available.

## Notes

- Auth uses the `Authorization: Bearer <jwt>` header (the API allows JWT in
  headers, `JWT_TOKEN_LOCATION=["cookies","headers"]`).
- With `AIVINNET_USER`/`AIVINNET_PASS` set, a 401 triggers an automatic
  re-login.
