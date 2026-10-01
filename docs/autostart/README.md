# Autostart termdeck

## One command

```bash
termdeck autostart install --dry-run   # preview the file and the commands, change nothing
termdeck autostart install             # asks, then writes it and starts the service   (--yes skips the question)
termdeck autostart uninstall           # stops it and removes only the file it created
```

`--port <n>` picks the port (default 3000, pinned, so the URL never moves). It fills in the real `node` and
`server.js` paths and a `PATH` that includes where `tmux` and `git` live, uses a **user-level** unit (no
root), and keeps the log file private (`~/Library/Logs/termdeck.log` on macOS, the journal on Linux). It
never writes the access token anywhere, refuses to overwrite a file it didn't create, and refuses to run
from the temporary `npx` cache (install globally or clone first). A non-loopback `--host` is only used if you
pass it, with a warning. macOS and Linux only; everything below is the manual route.

---

Run termdeck at login/boot so the dashboard is always there. Both templates need two edits:
the absolute path to `node` (`which node`) and to your termdeck checkout. `NO_OPEN=1` stops
the server opening a browser tab on every start. With tmux installed, shells survive
server restarts (see the main README).

## macOS — launchd

```bash
cp docs/autostart/com.termdeck.plist ~/Library/LaunchAgents/
# edit the paths in the copy, then:
launchctl load ~/Library/LaunchAgents/com.termdeck.plist
launchctl unload ~/Library/LaunchAgents/com.termdeck.plist   # to stop
```

Logs: `/tmp/termdeck.log`.

## Linux — systemd user unit

```bash
mkdir -p ~/.config/systemd/user
cp docs/autostart/termdeck.service ~/.config/systemd/user/
# edit the paths in the copy, then:
systemctl --user daemon-reload
systemctl --user enable --now termdeck
loginctl enable-linger "$USER"      # optional: start at boot, not just at login
journalctl --user -u termdeck -f    # logs
```

## Remote access

Keep the default loopback bind (`127.0.0.1`) and reach it through a tunnel — the shell
socket then never touches the network:

- **SSH tunnel:** `ssh -L 3000:127.0.0.1:3000 you@host`, then open `http://127.0.0.1:3000`.
- **Tailscale:** `tailscale serve` + `TD_ALLOWED_HOSTS` — see [../remote-access.md](../remote-access.md).

If you must bind a non-loopback `HOST` (e.g. `HOST=0.0.0.0`), termdeck generates a random
access token at startup and prints a `/?t=<token>` URL; only a browser holding the resulting
cookie is served. Under launchd/systemd that URL lands in the log file/journal, and the token
changes on every restart — another reason to prefer a tunnel for unattended service use.
