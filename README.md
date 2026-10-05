# Terminal Dashboard

[![npm](https://img.shields.io/npm/v/@kiril6/termdeck?label=npm)](https://www.npmjs.com/package/@kiril6/termdeck)
[![Latest release](https://img.shields.io/github/v/release/kiril6/termdeck?label=release)](https://github.com/kiril6/termdeck/releases/latest)
[![npm downloads total](https://img.shields.io/npm/dt/@kiril6/termdeck?label=downloads)](https://npm-stat.com/charts.html?package=@kiril6/termdeck)
[![npm downloads per month](https://img.shields.io/npm/dm/@kiril6/termdeck?label=downloads)](https://npm-stat.com/charts.html?package=@kiril6/termdeck)
![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)
![Platforms: macOS · Windows · Linux](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-blue)
[![smoke](https://github.com/kiril6/termdeck/actions/workflows/smoke.yml/badge.svg)](https://github.com/kiril6/termdeck/actions/workflows/smoke.yml)

**A local-first cockpit for your AI coding agents — private, and running in 30 seconds.** Run Claude Code, Codex, Gemini and plain shells side by side as floating windows in your browser: a git worktree per agent, alerts when one needs your approval, and sessions that survive restarts. No cloud, no accounts, no API keys, no build step.

**[▶ See it in action](https://kiril6.github.io/termdeck/)** — showcase page with a live demo GIF.

[Features](#-features) · [Quick start](#-quick-start) · [CLI commands](#cli-commands) · [Configuration](#configuration) · [Keyboard shortcuts](#-keyboard-shortcuts)

Every window is backed by a **real shell (PTY)** on your machine — open a dozen, tile them into a grid, group them into projects, theme each one, and reconnect after a refresh without losing a session. It's an Express server, a WebSocket PTY bridge, and one HTML file. That's it.

Three things set it apart:

- 🔒 **Private by default** — runs entirely on `127.0.0.1`. Your shells and their output **never leave your machine**: no telemetry, no cloud service, no third-party embeddings of your command history.
- ⚡ **Zero setup** — `node install.js && npm start`. No database, no accounts, no keys. Works fully offline (xterm is vendored, no CDN).
- 🪟 **Actually a GUI** — free-floating draggable/resizable windows, not just fixed grid panes. A real cockpit you arrange the way you think.

![termdeck running three AI coding agents in separate git worktrees, with approval and waiting alerts](https://raw.githubusercontent.com/kiril6/termdeck/master/docs/demo.gif)

<sub>Floating shells → tile into a grid → theme picker → real filesystem tree → command palette (`⌘K`) → play a game while a command runs.</sub>

**Why not just tmux or iTerm?** You get tmux's session persistence *plus* a point-and-click GUI you don't have to learn — floating windows, projects, and themes in the browser you already have open, on macOS, Windows, and Linux alike.

---

## ✨ Features

**Windows & layout**
- **Floating windows** — drag, resize, minimize, maximize, tile into a grid.
- **Glue two windows (🔒)** — drag a window against another to snap, and click the lock icon on the shared edge to glue the pair together: they move together and dragging the shared edge expands one while shrinking the other.
- **Tabs per window** — multiple shells in one pane, scrollable tab strip. Double-click any tab to rename it.
- **Projects** — group windows into project tabs; switch context instantly. Each project remembers its own last path, so a fresh project's tree starts at home instead of inheriting another's. The 📁 Dir popover can **Spawn here** (naming the tab after the folder if it's the project's first terminal) or open a path as a **New project** (tab named after the folder, tree rooted there).
- **Directory tree** (`⌘B`) — a real filesystem sidebar rooted at the active project, dirs lazy-expanding on click. Header breadcrumbs let you navigate up ancestors or pin a new root. **＋** on a folder opens a shell there; **⤢** on a file reveals it in Finder/Explorer. Right-click any row for the full menu (new terminal, open as project, set as root, copy path, open in editor, reveal); header buttons refresh the tree (keeping folders open) and toggle hidden files. The Dir popover (📁) has path autocomplete and rejects non-existent paths.
- **Dock** — bottom session bar with activity/attention indicators; overflow scrolls with edge hints.

**Sessions & persistence**
- **Session reattach** — refresh the browser or drop your connection and the shell keeps running. A 60s grace timer holds the PTY; reconnecting replays the last 1 MB of output. Waking from sleep reconnects instantly instead of waiting on backoff.
- **Durable sessions (tmux)** — with `tmux` installed, shells run *inside* tmux, so they **survive a server restart or crash** (not just a browser refresh): restart `npm start` and reconnecting reattaches the still-living session. Auto-off where tmux is missing (incl. Windows). *(Nothing survives a full reboot — process memory is gone.)*
- **Run command on start / SSH** — spawn a shell that immediately runs a command (Dir popover → *Run command on start*, e.g. `npm run dev`). Save `ssh` targets (palette → *Add SSH host…*) and reconnect to a host in one click.
- **Shell picker** — with more than one shell on the host, the Dir popover lets you choose which to spawn (only shells the server allows, never an arbitrary executable). The footer shell badge is clickable: open a **new tab in the same folder** with any shell, or **restart the tab as** another one in place — blocked while an agent is running in it, since that would kill the agent.
- **Live working directory** — each window's cwd badge follows the shell as it `cd`s. The backend polls each shell's real working dir from the OS (~1.5s), so it needs no shell config or `OSC 7`.
- **Persistent layout** — windows, projects, and themes saved to `localStorage`; a single-instance guard keeps two dashboard tabs from clobbering each other's state.

**AI agents**
- **AI CLI presets** — launch Claude Code, Codex, Gemini, Copilot, Cursor Agent, OpenCode, Qwen Code or Aider (most-used first) in a fresh shell in one click from the palette, or save your own (label + command). On agent exit you drop back to the local shell.
- **Agent worktrees** — palette → *New agent task…*: pick a branch, an agent CLI and a prompt, and termdeck cuts a **git worktree** off your repo and opens it as its own project tab, rooted at that checkout. *(Needs `git` on the host — it's the only feature that does, and everything else works without it.)* Three agents can work at once without overwriting each other. Worktrees live in a sibling `<repo>-worktrees/<branch>` folder; nothing is ever deleted for you.
- **Review agent changes** — palette → *Review agent changes…*: a read-only diff of a worktree against the commit it was cut from, so **committed and uncommitted work both show in one view**, with a file summary and untracked files listed. View-only by design — you already have a shell in that worktree.
- **Conflict radar** — when two agent worktrees of the same repo change the **same file**, the project tabs get an orange dot and the agent queue shows `⚠ overlaps with <agent>: <files>` — *(same lines)* if the edits actually collide. Informational only; checked every 10 s, read-only, idle with a single worktree.
- **"Waiting on you" watch** — an agent tab that goes quiet flips to an amber pulse plus a notification, so a row of agents reads as a who-needs-me queue.
- **Approval-prompt routing** — when an agent blocks on *"Allow this tool? (y/n)"* it jumps straight to a louder red alert, no idle wait. termdeck **never auto-answers** — it only surfaces and jumps to the prompt. Optional [agent hooks](docs/agent-hooks.md) (Claude Code, Gemini CLI, Codex) make this exact: real working / waiting / approval state plus the current tool and file, instead of guessing from output.
- **Cross-project agent queue** — a toolbar button opens one popover listing **every agent tab across all projects**, ranked *needs approval → waiting → working*; clicking a row jumps straight to that tab. The state also shows as a dot on each project tab, so the escalation reads tab pulse → project dot → one queue for the whole fleet.

**Productivity**
- **Command palette** — `⌘K` for fuzzy actions, sessions, and snippets. Category chips (Terminals, Agents, Workspace, Saved, Sessions) narrow the list; `Tab` cycles them.
- **First-run tour** — a 5-step walkthrough on your first visit; replay it from the palette (*Take the tour*) or the Help sheet.
- **Markdown viewer** — click any `.md` file in the tree, or palette → *Open file…*, to read it rendered (headings, code, lists, tables, links) with a one-click Raw toggle. No extra dependencies; other text files open as plain text.
- **Command snippets** — save reusable commands (`⌘⌥S` or palette → *Save snippet…*) and run them from the palette or the 🔖 footer icon; a snippet is *typed* into the focused shell (not auto-run) so you can review before pressing Enter.
- **Broadcast input** — 📢 Cast (`⌘⌥B`) mirrors your keystrokes to **every live shell in the active project** at once (not other projects); a pulsing red state makes it obvious when it's on, and it auto-disarms when you switch projects.
- **Find in terminal** — `⌘F` inside a shell searches its scrollback with match highlighting and a result counter.
- **Safe paste** — paste goes through bracketed-paste (newlines don't auto-run at a shell prompt); multi-line pastes ask first.
- **Configurable scrollback** — palette → *Set scrollback…* sets the lines of history each terminal keeps (default 8000).
- **Save output** — right-click a terminal → *Save output…* to download its scrollback as a `.log`.
- **Read-only log panels** — mirror a shell's output with input disabled (`⌘L`).
- **Keyboard-first** — see the full shortcut list below or press `?` in the app.

**Look & feel**
- **Themes** — per-terminal or dashboard-wide, with a searchable picker (Dracula, Nord, Gruvbox, Tokyo Night, Catppuccin, and more).
- **Font zoom** — `⌘+` / `⌘-` / `⌘0` resize a single terminal's font (the PTY re-fits to match).
- **Clickable links & file paths** — URLs in output are detected and open in a new tab. File paths (`path/file.ext:line[:col]`) in output are detected and open in the built-in file viewer scrolled directly to that line.
- **GPU rendering** — WebGL terminal renderer for smooth scrollback, with automatic fallback.
- **Ambient pixel pets** — low-key pixel critters wander the desktop's bottom edge while you're idle or away, and vanish the moment you're back (`⌘⌥P` to toggle; off under reduced-motion).

**While you wait**
- **Play a game** — palette → *Play game* or `⌘⌥G` opens 🦖 Dino or 🐍 Snake; it watches a chosen shell and pops a banner when the command finishes.
- **Long-run nudge** — a command running past 20s offers a game to pass the time, then reports how long the run took when it's done.

**Notifications**
- **Command-done alerts** — when a shell you're not watching finishes (prompt returns, bell, or OSC 133 shell-integration mark), a toast/desktop notification fires.
- **OS notifications** — in-app toasts mirror to native desktop notifications **only when the browser window is unfocused** (opt-in via the browser permission prompt).
- **Search & filter** sessions, with a visible "filter is on" indicator.

> **Limits:** up to 12 terminals per project and 10 project tabs, to keep a single browser tab responsive.

Cross-platform: **macOS, Windows, Linux** — uses prebuilt `node-pty` binaries, so no C++ compiler is required.

---

## 🚀 Quick start

Requires **Node.js 18+**.

**No-install run** — one command, nothing to clone:

```bash
npx @kiril6/termdeck         # from npm → http://localhost:3000
```

`npx` runs it once and leaves nothing installed (npx may reuse a cached copy — see [Updating](#updating)). To **keep** it —
`termdeck` on your PATH, for daily use — install it globally:

```bash
npm i -g @kiril6/termdeck    # then just:  termdeck   (also: termdeck doctor, termdeck hooks install, …)
```

Or straight from GitHub (latest, no npm release needed):

```bash
npx github:kiril6/termdeck   # fetch + run → http://localhost:3000
```

**Or clone it:**

```bash
node install.js   # first-time setup — picks the right node-pty prebuilt for your OS
npm start         # runs the server → http://localhost:3000
```

**Optional but recommended (either way above):** install **tmux** so shells survive a server restart/crash
(macOS `brew install tmux`, Debian/Ubuntu `sudo apt install tmux`). Without it the app still
runs — shells just don't outlive the server. Not available on Windows; set `NO_TMUX=1` to force it off.

It **opens in your browser automatically**. If it didn't (or you're on a headless box), go to **http://localhost:3000**. Default port is 3000. If port 3000 is occupied and `PORT` was not set, termdeck automatically increments to the next free port (3001, 3002…) and opens that. To disable auto-open, set `NO_OPEN=1` or pass `--no-open`. To pick a browser, set `BROWSER` — e.g. `BROWSER="Google Chrome" npm start` (macOS) or `BROWSER=firefox npm start` (Linux).

Override the port:

```bash
PORT=4000 npm start        # or:  npx @kiril6/termdeck --port 4000
```

### CLI commands

termdeck includes built-in diagnostic, hook setup, and system management tools (flags win over env vars):

```bash
termdeck [options]             # start the server (--port <n>, --host <h>, --no-open, -v, -h)
termdeck doctor                # check Node, node-pty, shell, tmux, git, ports (offline)
termdeck hooks install         # wire Claude Code, Gemini CLI, and Codex hooks (also: uninstall, --dry-run, --yes)
termdeck autostart install     # start termdeck at login via launchd/systemd (also: uninstall, --dry-run)
```

- **`termdeck doctor`** checks this machine and exits without starting anything — Node version, node-pty, shell spawning, tmux (≥ 3.2 for agent hooks), git, free ports, network exposure, and any invalid `TD_*` configuration — providing actionable fixes next to each problem. Exit code 0 means all good, 1 means warnings or failures.
- **`termdeck hooks install`** wires up [agent hooks](https://github.com/kiril6/termdeck/blob/master/docs/agent-hooks.md) for Claude Code, Gemini CLI, and Codex in one command — merges cleanly into existing config files, backs them up first, and `--dry-run` previews changes without writing.
- **`termdeck autostart install`** sets up a launchd agent (macOS) or systemd user unit (Linux) so the dashboard starts automatically at login without root. `termdeck autostart uninstall` removes it cleanly. Needs a **global install** (`npm i -g @kiril6/termdeck`) or a clone. Templates and details: [docs/autostart](https://github.com/kiril6/termdeck/tree/master/docs/autostart).

### Configuration

Options are set via environment variable; `--port`, `--host` and `--no-open` also exist as flags (flags win). Invalid, zero or negative numeric values for `TD_GRACE_MS` and `TD_BUFFER` fall back to their defaults; `TD_MAX_PANELS` never blocks reattaching to an existing session.

| Variable / Flag | Default | Description |
|---|---|---|
| `PORT` / `--port <n>` | `3000` | Port to listen on. If unset, automatically increments to a free port. |
| `HOST` / `--host <addr>` | `127.0.0.1` | Bind address. Non-loopback generates a random access token (`/?t=…`). |
| `NO_OPEN` / `--no-open` | `0` | Set `1` or pass `--no-open` to prevent opening the browser on startup. |
| `BROWSER` | *(default)* | Specific browser binary/name to launch (e.g. `Google Chrome`, `firefox`). |
| `NO_TMUX` | `0` | Set `1` to force raw shell spawn even if tmux is installed on the host. |
| `TD_GRACE_MS` | `60000` | Milliseconds to keep PTY alive after WebSocket disconnect (60s). Positive number. |
| `TD_BUFFER` | `1000000` | Per-terminal replay buffer in bytes on reconnect (1 MB). Positive number. |
| `TD_MAX_PANELS` | `64` | Maximum live terminals server-side; refuses excess to prevent resource exhaustion. |
| `TD_EDITOR` | `code` | Single executable name for the file tree's *Open in editor* action. |
| `TD_LOG_DIR` | *(none)* | Directory to write clean session logs when shells terminate (off by default). |
| `TD_ALLOWED_HOSTS` | *(none)* | Comma-separated exact hostnames for reverse proxies (e.g. `tailscale serve`). Enables access token. |

### Updating

The current version shows in the app's **? Help** panel. Check [Releases](https://github.com/kiril6/termdeck/releases) for what's new, then:

- **Installed with `npm i -g`?** `npm update -g @kiril6/termdeck`
- **Ran with `npx`?** Re-run, forcing a fresh fetch (npx caches):
  ```bash
  npx -y @kiril6/termdeck@latest        # npm
  npx -y github:kiril6/termdeck@latest  # or straight from GitHub
  ```
- **Cloned it?** Pull and reinstall:
  ```bash
  git pull && node install.js && npm start
  ```

### Hosting (and why not GitHub Pages)

This is a **local-first tool**, not a static site. Its core is a Node process (`server.js`) that opens a WebSocket and spawns real PTYs on the host — so:

- **GitHub Pages / Netlify / any static host won't work.** They serve files, not a Node server. Opened static, the app falls back to *demo* mode (UI only, **zero shells**). *(The [showcase page](https://kiril6.github.io/termdeck/) on GitHub Pages is just a landing page — the real app runs locally.)*
- To run it anywhere but your own machine you need a host that runs **Node + a persistent process + WebSockets** (a VPS, Fly.io, Render, Railway…). Before you do, read **[Security](#security)** — exposing it puts an unauthenticated shell on the network.

The intended deployment is: clone, `npm start`, use it on `localhost`.

### Windows notes

- Needs **Windows 10 1809+** (node-pty uses ConPTY).
- Defaults to `powershell.exe`. Make sure it's on your `PATH` (it is by default).

### Linux notes

- Installs the `@homebridge/node-pty-prebuilt-multiarch` prebuilt automatically — no compiler needed. If a prebuilt isn't available for your distro/arch, `node install.js` falls back to compiling, which needs `build-essential python3` (`sudo apt install build-essential python3`).
- The **⤢** "reveal in file manager" action uses `xdg-open` — install `xdg-utils` if it's missing (headless/minimal setups).

### Shells won't start?

Run **`termdeck doctor`** (offline; also works as `npx @kiril6/termdeck doctor`), or open **http://localhost:3000/debug** while the server runs — both try each shell candidate and tell you exactly what failed.

### Known limits

What termdeck does *not* do, so none of it is a surprise:

- **Reboots end shells.** tmux keeps shells alive across a server restart or crash, not across a machine reboot. Layout and projects come back; the processes don't.
- **Agent state is a guess unless you install the hooks.** Without [agent hooks](docs/agent-hooks.md) "waiting" and "needs approval" come from output heuristics (idle time, a prompt regex). The hooks are checked against each CLI's documented payloads, not yet against every real CLI version.
- **It never answers a prompt for you.** Approval prompts are surfaced and jumped to, never approved.
- **Remote access exposes a real shell.** The access token is a per-start secret, not multi-user auth. Keep the loopback bind, or use a tunnel — see [docs/remote-access.md](docs/remote-access.md).
- **Limits:** 12 terminals per project, 10 projects, 64 live terminals server-wide (`TD_MAX_PANELS`).
- **Windows:** works through ConPTY, but there is no tmux, so shells don't outlive the server, and the live working-directory badge falls back to the spawn directory.
- **The hosted demo has no backend** — a fake shell, no real PTYs or files.
- **Viewer:** the Markdown viewer is not full CommonMark (no nested lists or reference links); clickable paths only link files that exist on disk, and only in live mode.
- **Worktrees are never cleaned up for you.** A finished agent task leaves its worktree and branch to merge or delete yourself.

---

## ⌨️ Keyboard shortcuts

On Windows/Linux, `⌘` = `Ctrl` and `⌥` = `Alt`.

> **Why some shortcuts use `⌥` (Alt).** The browser/OS reserves the plain combos (`⌘T` opens a
> browser tab, `⌘W` closes it, `⌘L` jumps to the address bar, `⌘⇧B`/`⌘⇧T`/`⌘⇧N` are bookmarks/
> reopen-tab/incognito) — a web page can't override those. Actions that would collide use `⌘⌥…`
> (mac) / `Ctrl+Alt+…` (Windows) instead, which the browser leaves for the page.

### Global
| Action | Shortcut |
|---|---|
| Command palette | `⌘K` |
| New terminal | `⌘⌥T` |
| New log panel | `⌘⌥L` |
| New project | `⌘⇧M` |
| Next / previous project | `⌘⇧]` / `⌘⇧[` |
| Search sessions | `⌘F` |
| Toggle directory tree | `⌘B` |
| Tile all windows | `⌘⌥⇧T` |
| Broadcast input to all shells | `⌘⌥B` |
| Play game (Dino / Snake) | `⌘⌥G` |
| Open directory | `⌘⇧O` |
| Open file | `⌘⌥O` |
| New agent task | `⌘⌥R` |
| Review agent changes | `⌘⌥D` |
| Save snippet | `⌘⌥S` |
| Theme picker | `⌘⇧P` |
| Toggle pixel pets | `⌘⌥P` |
| Close focused window | `⌘⌥W` |
| Minimize focused | `⌘⌥M` |
| Maximize / restore focused | `⌘⌥⇧M` |
| Toggle fullscreen | `F11` |
| This help screen | `?` |

### Tabs (in the focused window)
| Action | Shortcut |
|---|---|
| New tab | `⌘⌥A` |
| Next tab | `⌘]` |
| Previous tab | `⌘[` |

### In a terminal
| Action | Shortcut |
|---|---|
| Find in terminal | `⌘F` |
| Font size up / down | `⌘+` / `⌘-` |
| Reset font size | `⌘0` |

> `⌘F` finds within the focused terminal; with no terminal focused it filters sessions.

---

## 🏗️ Architecture

Three files. Backend + frontend, no framework beyond Express.

| File | Role |
|---|---|
| **`server.js`** | Express static server + `ws` WebSocket PTY multiplexer. One WebSocket per terminal, keyed by a client-supplied `id`. On disconnect the PTY is **not** killed — a 60s timer holds it so reconnecting replays the buffer. Shell chosen from `$SHELL` → PowerShell (Windows) → zsh/bash/sh, or per terminal from the allowlist (`GET /api/shells`). |
| **`public/index.html`** | The entire frontend in one file (HTML + CSS + JS, no bundler). xterm.js + addons served locally from `node_modules` at `/vendor` (no CDN — works offline). Floating panes, tiling, projects, themes, command palette, search. State persisted to `localStorage`. |
| **`install.js`** | One-shot dependency installer. Picks the `node-pty` variant for your platform and installs prebuilt binaries. |

**Core invariant:** *disconnect ≠ kill, reconnect replays buffer.* Any change to the WebSocket lifecycle in `bindWsEvents` / `connection` must preserve it.

### Security

This server spawns **real shells**, so access is locked down by default:

- **Loopback only** — binds `127.0.0.1`, so nothing on your network can reach it. To expose it deliberately (e.g. a trusted LAN), set `HOST=0.0.0.0` (or a specific IP); the server prints a warning and generates a random access token: open the tokenized URL it prints (`/?t=…`) once and a cookie authorizes the browser; everything else gets 401.
- **Origin + Host validation** — the WebSocket upgrade is rejected unless both headers resolve to a known localhost name. This blocks a malicious web page from opening a socket to your shells (cross-site / DNS-rebind), the main browser attack for a localhost service.

On the loopback bind there is intentionally **no login/token**: a non-browser process already running as your user can spawn its own shell anyway, so a token would only be theater. If you ever expose this multi-user or over a tunnel, add real authentication in front of it.

### Demo vs. live mode

Served over `http://`/`https://` the app is **live** (real shells). Opened directly from the filesystem (`file://`) it falls back to **demo** mode with no backend — handy for previewing the UI.

---

## 💬 Feedback

termdeck has no telemetry, so the only way to know what works for you is if you say so. Questions, ideas, or just "I use it for X" → [Discussions](https://github.com/kiril6/termdeck/discussions). Bugs → [Issues](https://github.com/kiril6/termdeck/issues/new/choose). The same links are in the app's Help sheet (`?`) and in `termdeck --help`.

---

## 🤝 Contributing

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the ground rules (dependency-light backend, no build step, the reattach invariant) and the dev loop. Found a bug or have an idea? [Open an issue](https://github.com/kiril6/termdeck/issues/new/choose) — the guided form walks you through it. New here? The [good first issues](https://github.com/kiril6/termdeck/issues?q=is%3Aopen+label%3A%22good+first+issue%22) are a friendly start.

---

## 💛 Supporting the Project

If termdeck is useful to you, consider giving it a ⭐ — it helps others find it.

Support development: <a href="https://ko-fi.com/K3K2X0ERJ"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="ko-fi" align="absmiddle" /></a>

---

## 📄 License

MIT — see [`LICENSE`](LICENSE).
