# termdeck

[![npm](https://img.shields.io/npm/v/@kiril6/termdeck?label=npm)](https://www.npmjs.com/package/@kiril6/termdeck)
[![Latest release](https://img.shields.io/github/v/release/kiril6/termdeck?label=release)](https://github.com/kiril6/termdeck/releases/latest)
[![npm downloads](https://img.shields.io/npm/dm/@kiril6/termdeck?label=downloads)](https://npm-stat.com/charts.html?package=@kiril6/termdeck)
![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)
![Platforms: macOS · Windows · Linux](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-blue)
[![smoke](https://github.com/kiril6/termdeck/actions/workflows/smoke.yml/badge.svg)](https://github.com/kiril6/termdeck/actions/workflows/smoke.yml)

**A local dashboard for running AI coding agents side by side.**

termdeck runs Claude Code, Codex, Gemini and your own shells as windows in your browser, each agent in its own git branch so they never overwrite each other. It shows at a glance which agent is working, which is waiting for you, and which needs your approval — then lets you review its changes and merge them. Everything runs on your own machine: no cloud, no account, no API keys.

![termdeck: three agents in separate git worktrees; one asks for approval, it is approved from the agent queue, its changes are reviewed and merged behind a passing test](https://raw.githubusercontent.com/kiril6/termdeck/master/docs/screenshots/hero.gif)

<sub>Three agents, each in its own worktree → one blocks on a permission prompt → approve it from the agent queue → review the diff → merge behind a passing `npm test`. Sample repo; agent events sent through termdeck's [hook API](docs/agent-hooks.md).</sub>

**[Try the live demo](https://kiril6.github.io/termdeck/app/?demo)** (UI only, no install) · [Showcase](https://kiril6.github.io/termdeck/) · [All features](FEATURES.md)

[Quick start](#quick-start) · [Agent loop](#the-agent-loop) · [Phone](#away-from-your-desk) · [Security](#security-model) · [Features](#features) · [Install](#install-and-run) · [Configuration](#configuration) · [Shortcuts](#keyboard-shortcuts)

---

## Quick start

```bash
npx @kiril6/termdeck
```

Needs **Node.js 18+**. It opens **http://localhost:3000** in your browser. Optional: install **tmux** (`brew install tmux` / `sudo apt install tmux`) so shells survive a server restart. Other ways to install are [below](#install-and-run).

---

## Why termdeck

- **Built for agents.** One git worktree per agent, a single queue showing who needs you, one-click approvals, review and merge — the whole loop in one place.
- **Private by default.** Bound to `127.0.0.1`. Your shells and their output never leave your machine: no telemetry, no cloud service.
- **Zero setup.** One command. A handful of npm packages (Express, ws, node-pty, xterm.js), installed automatically, no compiler needed. Works offline after install.
- **A real GUI.** Free-floating, resizable windows, projects, a file tree and 24 themes — not a grid of panes you drive by keyboard.

|  | termdeck | tmux / terminal tabs | Browser terminals (ttyd, wetty) |
|---|---|---|---|
| Layout | Floating windows, projects, file tree | Panes inside one terminal | One terminal per page |
| Knows which agent needs you | ✅ working / waiting / needs approval | — | — |
| Worktree per agent → review → merge | ✅ built in | By hand | — |
| Answer an agent's permission prompt from a list | ✅ Claude Code, Codex (via hooks) | — | — |

termdeck uses tmux under the hood when it's installed, so you keep tmux's durability and get the dashboard on top.

---

## The agent loop

**1. Launch.** Palette (`⌘K`) → *New agent task…*: pick a branch name, an agent and a prompt. termdeck creates a **git worktree** in a sibling `<repo>-worktrees/` folder and opens it as its own project tab with the agent running in it.

**2. Watch.** Every agent tab shows its state — green *working*, amber *waiting on you*, red *needs approval* — and the **agent queue** lists all of them across projects, most urgent first. If two agents change the same file, the **conflict radar** warns you before merge time.

![Agent queue: one agent needs approval for a command, one is waiting, one is working; two of them change the same lines of client.js](https://raw.githubusercontent.com/kiril6/termdeck/master/docs/screenshots/agent-queue.png)

**3. Unblock.** With the optional [agent hooks](docs/agent-hooks.md) (`termdeck hooks install`), the queue shows the exact command an agent wants to run with **Approve / Deny** buttons. termdeck never answers on its own — only when you click, or through an allow-rule you created yourself.

**4. Review.** *Review agent changes…* shows a read-only diff of everything the agent changed since its branch was cut — committed and uncommitted work in one view.

![Read-only diff of an agent's worktree: files added and modified, then the unified diff](https://raw.githubusercontent.com/kiril6/termdeck/master/docs/screenshots/review-changes.png)

**5. Land.** *Finish agent task…* merges the branch or opens a pull request, optionally after a check like `npm test` that must pass first. Each option says why when it isn't available. Removing the worktree is a separate opt-in, and git still refuses to delete unmerged work.

![Finish agent task dialog: merge into main, run npm test first, keep the worktree](https://raw.githubusercontent.com/kiril6/termdeck/master/docs/screenshots/finish-task.png)

**Supported agents:** Claude Code, Codex, Gemini, Copilot, Cursor Agent, OpenCode, Qwen Code, Aider — or any CLI you add as a preset. Hooks report exact state for Claude Code and Codex (Gemini CLI is supported but not yet verified); Approve / Deny works with Claude Code and Codex. Without hooks, termdeck estimates state from terminal output.

---

## Away from your desk

Agents block on approvals while you're elsewhere. Two optional pieces cover that, and both stay off unless you set them up:

1. **Reach it from your phone** over [Tailscale Serve](docs/remote-access.md) (private to your devices; the server stays on loopback) or an SSH tunnel. Remote access turns the access token on.
2. **Get pinged** when an agent needs you: set `TD_NOTIFY_URL` to an [ntfy](https://ntfy.sh) topic or any webhook. Tap the push, land on that terminal, tap **Approve**.

```bash
TD_ALLOWED_HOSTS=mybox.tail1234.ts.net TD_NOTIFY_URL=https://ntfy.sh/my-unguessable-topic npx @kiril6/termdeck
tailscale serve --bg 3000
```

Needs the [agent hooks](docs/agent-hooks.md) for Approve and the exact state. Alerts include the command unless `TD_NOTIFY_DETAIL=0`. Full steps: [remote access](docs/remote-access.md).

---

## Security model

termdeck spawns real shells, so it is locked down by default:

- **It never answers for you.** An agent's permission prompt is only answered when you click Approve, or by an allow-rule you created for that repo. Rules are off by default, and a hard deny-list (`rm -rf`, `sudo`, force-push, curl-to-shell, reading secrets…) can never be allowed automatically. The deny-list is a safety net, not a sandbox. Every decision, manual or by rule, is recorded in an audit log ([details](docs/agent-hooks.md)).
- **Loopback only.** The server binds to `127.0.0.1`; nothing else on your network can reach it. There is no login on loopback, by design: a process already running as your user can start its own shell anyway.
- **Blocks malicious web pages.** Every API call and WebSocket is rejected unless its `Origin` and `Host` headers resolve to a known localhost name (or a `TD_ALLOWED_HOSTS` entry). This blocks cross-site and DNS-rebinding attacks, so a website can't connect to your shells or read your files.
- **Token when exposed.** Bind to another address (`HOST=0.0.0.0` or a specific IP) and termdeck prints a warning and a tokenized URL (`/?t=…`). Opening it once sets a cookie for that browser; everything else gets 401. Each restart creates a new token. For several users or the internet, put real authentication in front of it.
- **Nothing phones home.** No telemetry, no CDN (xterm.js is served locally), no cloud service.

See also [Known limits](#known-limits).

---

## Features

**Terminals & layout**
- Floating, draggable, resizable windows; snap and glue windows together, tabs per window.
- **Layouts:** auto-tile, or pick a fixed grid (1×1, 2×1, 1×2, 2×2, 3×2) from the palette's *Layout* tab — extra windows are minimized, not closed. `⌥1`–`9` jumps to the Nth window.
- **Projects** group windows; each remembers its folder. A **file tree** (`⌘B`) with a built-in file and Markdown viewer.
- **Live working directory** on every window, clickable links and `file:line` paths, find in scrollback, GPU rendering.
- 24 themes (17 dark, 7 light), per terminal or for the whole dashboard.

![Four terminals tiled with the file tree open, in the GitHub Light theme](https://raw.githubusercontent.com/kiril6/termdeck/master/docs/screenshots/workspace-light.png)

**Sessions**
- **Survive a browser refresh** — the shell keeps running and its output is replayed when you reconnect.
- **Survive a server restart** with tmux installed. Agent tabs relaunch in resume mode after a reboot.
- Run a command on start, save SSH hosts, choose a shell per tab.

**Agents**
- One-click agent presets, worktree per task, agent queue, conflict radar, Approve / Deny, review, finish.
- **Send to agent** — select code in the file viewer, a diff or terminal output, and send it with its `path:line` reference to an agent's prompt (typed, never run).
- **Token totals** as reported by Claude Code and Codex, per agent and per project.

**Productivity**
- Command palette (`⌘K`), snippets, broadcast input to every shell in a project, safe multi-line paste.
- **Phone alerts:** set `TD_NOTIFY_URL` (e.g. an [ntfy](https://ntfy.sh) topic) and get a push when an agent is blocked on an approval — tap it to open that terminal. [Setup](docs/remote-access.md#phone-notifications).
- Notifications when a background command finishes or an agent needs you — in-app, and native when the window isn't focused.
- A first-run tour, and a game to play while a long command runs.

**Every feature, in detail: [FEATURES.md](FEATURES.md).**

---

## Install and run

| Way | Command | When |
|---|---|---|
| Run once | `npx @kiril6/termdeck` | Trying it out (npx may reuse a cached copy — see [Updating](#updating)) |
| Install globally | `npm i -g @kiril6/termdeck`, then `termdeck` | Daily use; needed for `termdeck autostart` |
| Latest from GitHub | `npx github:kiril6/termdeck` | Unreleased changes |
| Clone | `node install.js && npm start` | Contributing |

- **tmux (recommended):** with tmux installed, shells run inside it and survive a server restart or crash. Without it everything else works. Not available on Windows; `NO_TMUX=1` turns it off.
- **Browser:** it opens automatically. Disable with `--no-open` / `NO_OPEN=1`, pick one with `BROWSER` (e.g. `BROWSER=firefox`).
- **Port:** defaults to 3000 and moves to the next free port if that's taken. `--port 4000` / `PORT=4000` pins it.
- **No compiler needed:** `node-pty` ships prebuilt binaries for macOS, Windows and Linux (x64/arm64).

### CLI commands

```bash
termdeck [options]             # start the server (--port <n>, --host <h>, --no-open, -v, -h)
termdeck doctor                # check Node, node-pty, shell, tmux, git, ports (offline)
termdeck hooks install         # wire Claude Code, Gemini CLI and Codex hooks (also: uninstall, --dry-run, --yes)
termdeck autostart install     # start termdeck at login via launchd/systemd (also: uninstall, --dry-run)
```

- **`termdeck doctor`** checks this machine without starting anything — Node version, node-pty, shell spawning, tmux (≥ 3.2 for agent hooks), git, free ports, network exposure and invalid `TD_*` settings — and prints a fix next to each problem. Exit code 0 = all good, 1 = warnings or failures.
- **`termdeck hooks install`** sets up [agent hooks](docs/agent-hooks.md) for Claude Code, Gemini CLI and Codex: merges into your existing config, backs it up first, and `--dry-run` previews without writing.
- **`termdeck autostart install`** adds a launchd agent (macOS) or systemd user unit (Linux) so the dashboard starts at login, without root. Needs a global install or a clone. Details: [docs/autostart](docs/autostart).

### Configuration

Set via environment variable; `--port`, `--host` and `--no-open` also exist as flags (flags win). Invalid, zero or negative values for `TD_GRACE_MS` and `TD_BUFFER` fall back to the defaults.

| Variable / Flag | Default | Description |
|---|---|---|
| `PORT` / `--port <n>` | `3000` | Port to listen on. If unset, moves to the next free port. |
| `HOST` / `--host <addr>` | `127.0.0.1` | Bind address. Non-loopback generates a random access token (`/?t=…`). |
| `NO_OPEN` / `--no-open` | `0` | `1` = don't open the browser on start. |
| `BROWSER` | *(default)* | Browser to launch (e.g. `Google Chrome`, `firefox`). |
| `NO_TMUX` | `0` | `1` = plain shells even if tmux is installed. |
| `TD_GRACE_MS` | `60000` | How long a shell stays alive after the browser disconnects (ms). |
| `TD_BUFFER` | `1000000` | Output replayed on reconnect, per terminal (bytes). |
| `TD_MAX_PANELS` | `64` | Maximum live terminals on the server. Never blocks reattaching. |
| `TD_EDITOR` | `code` | Executable for the file tree's *Open in editor*. |
| `TD_CHECK_TIMEOUT` | `600` | Seconds the *Finish agent task* check may run before landing is blocked. |
| `TD_LOG_DIR` | *(none)* | Write session logs (and the approval audit log) here. Off by default. |
| `TD_ALLOWED_HOSTS` | *(none)* | Extra exact hostnames for a reverse proxy (e.g. `tailscale serve`). Enables the access token. |
| `TD_NOTIFY_URL` | *(none)* | Webhook POSTed when an agent needs you (ntfy-ready). Also `TD_NOTIFY_EVENTS` (default `permission_request`), `TD_NOTIFY_DETAIL=0`. See [remote access](docs/remote-access.md#phone-notifications). |

### Updating

The running version is shown in the app's **? Help** panel; see [Releases](https://github.com/kiril6/termdeck/releases) for what's new.

- **Global install:** `npm update -g @kiril6/termdeck`
- **npx** caches, so force a fresh copy: `npx -y @kiril6/termdeck@latest` (or `npx -y github:kiril6/termdeck@latest`)
- **Clone:** `git pull && node install.js && npm start`

### Platform notes

- **Windows:** needs Windows 10 1809+ (ConPTY). Defaults to `powershell.exe`. No tmux, so shells don't outlive the server.
- **Linux:** uses the `@homebridge/node-pty-prebuilt-multiarch` prebuilt. If none exists for your distro/arch, `node install.js` compiles it, which needs `build-essential python3`. *Reveal in file manager* uses `xdg-open` (`xdg-utils`).
- **Shells won't start?** Run `termdeck doctor`, or open **http://localhost:3000/debug** while the server runs — both try each shell and show exactly what failed.

### Running it somewhere else

termdeck is a local tool: a Node process that spawns real shells. Static hosts (GitHub Pages, Netlify) can't run it — opened that way it falls back to a UI-only demo. To use it from another device, keep the loopback bind and use a tunnel such as Tailscale Serve or SSH: see [docs/remote-access.md](docs/remote-access.md).

---

## Known limits

What termdeck does *not* do, so none of it is a surprise:

- **Reboots end shells.** tmux keeps shells alive across a server restart or crash, not a machine reboot. Layout and projects come back; the processes don't — except agent tabs, which relaunch their CLI in resume mode (Claude, Codex, Gemini, Copilot, or your own resume command).
- **Agent state is a guess unless you install the hooks.** Without [agent hooks](docs/agent-hooks.md), "waiting" and "needs approval" come from output heuristics (idle time, a prompt pattern). The hooks are checked against each CLI's documented payloads, not yet against every CLI version.
- **Approve / Deny needs the hooks.** It works with Claude Code and Codex only; without hooks termdeck can only jump you to the prompt. See the [security model](#security-model).
- **Remote access exposes a real shell.** The access token is a per-start secret, not multi-user auth. Keep the loopback bind, or use a tunnel.
- **Limits:** 12 terminals per project, 10 projects, 64 live terminals server-wide (`TD_MAX_PANELS`).
- **Windows:** works through ConPTY, but without tmux shells don't outlive the server, and the working-directory badge shows the spawn directory.
- **The hosted demo has no backend** — a fake shell, no real PTYs or files.
- **Viewer:** the Markdown viewer is not full CommonMark (no nested lists or reference links); clickable paths only link files that exist, and only in live mode.
- **Worktrees are kept until you remove them.** *Finish agent task* removes a worktree only if you opt in.

---

## Keyboard shortcuts

On Windows/Linux, `⌘` = `Ctrl` and `⌥` = `Alt`. Press `?` in the app for the full list.

<details>
<summary>Show all shortcuts</summary>

> **Why some shortcuts use `⌥` (Alt).** The browser reserves the plain combos (`⌘T` opens a browser tab, `⌘W` closes it, `⌘L` jumps to the address bar…) and a web page can't override them, so those actions use `⌘⌥…` / `Ctrl+Alt+…` instead.

**Global**

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
| Jump to the Nth window of the project | `⌥1`–`⌥9` (`⌘⌥1`–`9` also inside a terminal) |
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
| Help | `?` |

**Tabs (in the focused window)**

| Action | Shortcut |
|---|---|
| New tab | `⌘⌥A` |
| Next / previous tab | `⌘]` / `⌘[` |

**In a terminal**

| Action | Shortcut |
|---|---|
| Find in terminal | `⌘F` |
| Font size up / down / reset | `⌘+` / `⌘-` / `⌘0` |

`⌘F` searches the focused terminal; with no terminal focused it filters sessions.

</details>

---

## Architecture

Three files, no framework beyond Express, no build step.

| File | Role |
|---|---|
| **`server.js`** | Express static server + `ws` WebSocket PTY multiplexer. One WebSocket per terminal, keyed by a client-supplied `id`. On disconnect the PTY is **not** killed — a grace timer holds it so reconnecting replays the buffer. |
| **`public/index.html`** | The entire frontend in one file (HTML + CSS + JS). xterm.js is served locally from `node_modules`. State is saved to `localStorage`. |
| **`install.js`** | One-shot installer that picks the right prebuilt `node-pty` for your platform. |

**Core invariant:** *disconnect ≠ kill, reconnect replays the buffer.* Any change to the WebSocket lifecycle must preserve it.

---

## Feedback and contributing

termdeck has no telemetry, so the only way to know what works for you is if you say so. Questions, ideas, or just "I use it for X" → [Discussions](https://github.com/kiril6/termdeck/discussions). Bugs → [Issues](https://github.com/kiril6/termdeck/issues/new/choose).

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the ground rules (dependency-light backend, no build step, the reattach invariant) and the dev loop. New here? Try a [good first issue](https://github.com/kiril6/termdeck/issues?q=is%3Aopen+label%3A%22good+first+issue%22).

If termdeck is useful to you, a ⭐ helps others find it. Support development: <a href="https://ko-fi.com/K3K2X0ERJ"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="ko-fi" align="absmiddle" /></a>

## License

MIT — see [LICENSE](LICENSE).
