# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Terminal Dashboard — a browser cockpit of floating xterm.js terminal windows, each backed by a real PTY on the host. Served on localhost.

## Commands

```bash
node install.js   # first-time setup — picks the right node-pty prebuilt per OS (no C++ compiler)
npm start         # run server → http://localhost:3000
```

- No build step, no linter, no tests.
- Debug page for shell-spawn failures: `http://localhost:3000/debug` (dumps env + tries each shell candidate).
- Override port: `PORT=xxxx npm start`.

## Architecture

Three files. Backend + frontend, no framework beyond Express.

**`server.js`** — Express static server + `ws` WebSocket PTY multiplexer.
- Loads node-pty by trying `node-pty` then `@homebridge/node-pty-prebuilt-multiarch` (Linux fork). If neither loads, tells user to run `install.js`.
- One WS per terminal. Session keyed by client-supplied `id` (query param), tracked in the module-level `live` Map: `{ term, buffer, ws, killTimer, cwd, shellName, isLog }`.
- **Reattach model**: on WS disconnect the PTY is NOT killed — a `GRACE_MS` (60s) `killTimer` starts. Reconnecting with the same `id` cancels the timer, rebinds the socket, and replays the last `BUFFER` (200KB) of output. This is what lets the browser refresh / drop connection without losing shells.
- **Durable sessions (tmux)**: when `tmux` is on the host, the PTY is delegated to `tmux new-session -A` (attach-or-create, session name `td_<id>`) so shells survive the **server** dying, not just a browser refresh. Auto-off where tmux is missing (incl. Windows) or `NO_TMUX=1` → falls back to a raw shell. Session close does `tmux kill-session` (killing the pty alone would only detach).
- Shell picked from `shellCandidates()`: `$SHELL`, then powershell (Windows), then zsh/bash/sh.
- `log=1` query param = read-only terminal (input from client is ignored — `isLog` gate in `bindWsEvents`).
- `cwd` validated by `safeDir()` before spawn, falls back to `$HOME`.

**`public/index.html`** — entire frontend in one ~190KB file (HTML + CSS + JS, no bundler).
- xterm.js + addons served locally from `node_modules` at `/vendor` (see `server.js`) — no CDN, runs fully offline after `npm install`.
- Floating draggable/resizable window panes, tiling, projects sidebar, theme picker, command palette (⌘K), search.
- Each pane opens its own WebSocket to the backend, passing `id`, `cols`, `rows`, `cwd`, optional `log`.
- State (windows, projects, themes) persisted in `localStorage`.

**`install.js`** — one-shot dependency installer. Picks node-pty variant by platform, installs base deps `--ignore-scripts` first, falls back to plain `npm install` on failure.

## Feature log — keep it current

[`FEATURES.md`](FEATURES.md) is the single source of truth for user-facing behavior.
**Any change that adds, removes, or alters a feature MUST update `FEATURES.md` in the same
change.** Read it first when you need to know what already exists.

## Conventions

- Backend is deliberately dependency-light (express, ws, node-pty only). Keep it that way.
- The reattach/grace-timer + ring-buffer is the core invariant — changes to WS lifecycle in `bindWsEvents`/`connection` must preserve "disconnect ≠ kill, reconnect replays buffer".
