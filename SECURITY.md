# Security policy

termdeck runs real shells as you, so security reports are welcome and taken seriously.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/kiril6/termdeck/security/advisories/new).

Include what you found, how to reproduce it, and the version (`termdeck --version`). termdeck is maintained by one
person, so responses are best effort; you'll get an acknowledgement, and a fix ships in a normal release with credit
to you unless you prefer otherwise. Only the latest release gets fixes.

## What termdeck protects against

- **Web pages.** Every API call and WebSocket is rejected unless its `Origin` and `Host` resolve to a localhost name
  (or a `TD_ALLOWED_HOSTS` entry), and cross-site browser requests are refused. A website you visit can't reach your
  shells or files, including through DNS rebinding.
- **Other programs on your computer.** The server listens on loopback (`127.0.0.1`), which other local programs can
  also reach (another OS user, or an agent running inside termdeck). So the browser signs in once with a secret
  kept in `~/.termdeck/token` (readable only by you) and holds it as an HttpOnly cookie. Terminals never see it:
  each gets its own `TD_HOOK_AUTH`, which can only report that terminal's agent events.
- **Agents approving themselves.** A permission prompt is only answered by your click, or by an allow-rule you
  created for that repo (rules are off by default). A hard deny-list keeps the riskiest commands (recursive `rm`,
  `sudo`, force-push, piping downloads to a shell, reading secrets…) from ever being allowed automatically.
- **Your network.** Nothing listens beyond loopback unless you set `HOST`; then termdeck warns and requires a
  per-start token. No telemetry, no CDN, no cloud service.

## What it does not protect against

- **Code that already runs as you.** An agent or script running in your account can read your files, including
  `~/.termdeck/token`. Approvals and allow-rules guard against mistakes; they are **not a sandbox**. Use your
  agent CLI's own sandbox for untrusted work.
- **Exposing it beyond your machine.** The token mode is for your own devices over a private network
  (e.g. Tailscale, see [remote access](docs/remote-access.md)). For several users or the internet, put real
  authentication in front of it.
- **Third-party services you configure.** A phone-alert webhook (`TD_NOTIFY_URL`) sends the event, project name, tool
  name, session id and a link back to termdeck to that service (the command too, only with `TD_NOTIFY_DETAIL=1`). ntfy.sh topics are public by name.

## What termdeck stores

| Where | What | Kept |
|---|---|---|
| Browser storage (this site only) | Window layout and folders, projects, snippets, SSH targets, AI CLI presets, token usage, preferences | Until you clear site data (usage: 7 days) |
| `~/.termdeck/token` | The sign-in secret (0600) | Until deleted; deleting it signs every browser out |
| `~/.termdeck/server.json` | The running server's URL, no secret (0600) | Removed when the server exits |
| `~/.termdeck/layouts.json`, `approval-rules.json` | Saved layouts (max 50), allow-rules (max 100), 0600 | Until deleted |
| `~/.termdeck-tmux-optout` | Remembers that you declined installing tmux | Until deleted |
| `TD_LOG_DIR` (off by default) | Session output on exit and the approval audit log (`approvals.jsonl`, 0600) | Until deleted |
| Agent settings backups (`*.termdeck-bak-<time>`) | A copy of e.g. `~/.claude/settings.json` taken before `termdeck hooks install` / `uninstall` changes it; may hold API keys from that file | Until deleted |
| Server memory / tmux | The last `TD_BUFFER` (1 MB) of each shell's output, tmux scrollback | While the session lives |

To remove everything: `termdeck hooks uninstall`, `termdeck autostart uninstall`, then delete `~/.termdeck`,
`~/.termdeck-tmux-optout`, any `*.termdeck-bak-*` files next to your agent settings, and termdeck's site data in
your browser.
