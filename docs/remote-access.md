# Remote access

termdeck spawns real shells, so it binds loopback (`127.0.0.1`) by default and never
exposes a shell without a credential. Three ways to reach it from another device, safest first.

## 1. Tailscale Serve (recommended)

The server stays on loopback; Tailscale terminates TLS and only devices on your tailnet can reach it.

```bash
TD_ALLOWED_HOSTS=mybox.tail1234.ts.net npm start     # your machine's MagicDNS name
tailscale serve --bg 3000                            # https://mybox.tail1234.ts.net → 127.0.0.1:3000
```

- `TD_ALLOWED_HOSTS` is a comma-separated list of **exact** hostnames added to the Origin + Host
  check (DNS-rebind / cross-site protection). No wildcards (they're ignored with a warning);
  unset = localhost only.
- Setting it also turns on the access token (same as a non-loopback `HOST`): open the
  `/?t=<token>` URL printed at startup once per device; a cookie authorizes that browser.
  Anyone else on the tailnet gets 401 without it.
- Use `tailscale serve`, **never** `tailscale funnel` — funnel publishes it to the public internet.

## 2. SSH tunnel

```bash
ssh -L 3000:127.0.0.1:3000 you@host     # then open http://127.0.0.1:3000
```

Nothing to configure: from the server's point of view it's a local connection.

## 3. Bind to the network (trusted LAN only)

`HOST=0.0.0.0 npm start` — shells are reachable by anyone who can reach the port. termdeck
generates a random per-start token and prints a `/?t=<token>` URL; requests and WebSocket
upgrades without the resulting cookie get 401. There is no TLS, so prefer options 1–2.
