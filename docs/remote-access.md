# Access from outside your network

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

## Letting other people in

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

## If you put it behind any reverse proxy

The app then sees the proxy's address as the client address for every request.
Nothing in AivinNet depends on the client IP today — the login rate limit
deliberately counts usernames for exactly this reason — but keep it in mind before
adding anything that does.

