# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TermDeck — a browser cockpit of floating xterm.js terminal windows, each backed by a real PTY on the host. Served on localhost.

## Commands

```bash
node install.js   # first-time setup — picks the right node-pty prebuilt per OS (no C++ compiler)
npm start         # run server → http://localhost:3000
```

- No build step. Lint: `npm run lint` (ESLint, `eslint.config.js` — bug-catching rules only, no style rules; CI runs it). Browser tests: `npm test` (Playwright, `tests/e2e.spec.js`; needs `npx playwright install chromium` once — or `PW_CHROMIUM=/path/to/chrome`). They start their own server on port 4783 with a throwaway `HOME`. Playwright is a devDependency only.
- Debug page for shell-spawn failures: `http://localhost:3000/debug` (dumps env + tries each shell candidate).
- Override port: `PORT=xxxx npm start`.
- README GIF + screenshots (`docs/screenshots/`): re-record with the scripts in `tools/capture/` after UI changes (see its README). Not shipped to npm.
- Perf soak (`tools/soak/`, see its README): `node tools/soak/backend.js` (output speed, backpressure, PTY churn, tmux polling) and `node tools/soak/browser.js` (WebGL renderers, fps, idle cost). Run before/after changes to the output path, WS lifecycle, polling or terminal rendering, and compare on the same machine. Not in CI, not shipped.
- Landing-page ad video: `docs/termdeck-ad.mp4` (58s, committed) is played by the click-to-play cover in `docs/index.html` (`#ad`, cover image `docs/screenshots/ad-cover.jpg`). Its **source lives only locally, git-ignored, in `tools/commercial/`** (`timeline.js` scene lengths, `index.html` visuals, `audio.js` synth soundtrack (`VO=1` mixes in the optional voice-over lines from `vo.js`, off because the macOS voices sound robotic), `render.js` frame-by-frame render → mp4, `shots.js` extra stills — palette, live overview, desk, themes — taken with the `tools/capture` rig). It may be absent on a fresh clone — don't expect it in git or recreate it unasked. To change the ad: edit there, run `FFMPEG=<ffmpeg with libx264+aac> PW_CHROMIUM=<chrome> node tools/commercial/render.js`, re-encode a small copy (`-crf 26`, ~7 MB) to `docs/termdeck-ad.mp4`, and commit only the `docs/` files. The ad uses screenshots from `docs/screenshots/`, so re-record those first after UI changes.

## Architecture

Backend + frontend, no framework beyond Express. The backend's runtime modules live in `scripts/` next to the CLI
helpers, each listed one by one in `package.json` `files` (`scripts/check-pack.js` fails CI if one is missing).

**`server.js`** — entry point and wiring only: CLI args, loading node-pty, Express middleware order, `/debug`, the WebSocket server, port selection and the startup banner.
- Loads node-pty by trying `node-pty` then `@homebridge/node-pty-prebuilt-multiarch` (Linux fork). If neither loads, tells user to run `install.js`.
- Owns the `live` Map (id → `{ term, buffer, ws, killTimer, cwd, shellName, isLog, tmuxName }`) and passes it to `sessions.js` and `agent-api.js`.

**`scripts/sessions.js`** — the `ws` PTY multiplexer.
- One WS per terminal, keyed by the client-supplied `id` (query param, checked against `VALID_ID`).
- **Reattach model**: on WS disconnect the PTY is NOT killed — a `GRACE_MS` (60s, `TD_GRACE_MS`) `killTimer` starts. Reconnecting with the same `id` cancels the timer, rebinds the socket, and replays the last `BUFFER` (1 MB, `TD_BUFFER`) of output. This is what lets the browser refresh / drop connection without losing shells.
- **Durable sessions (tmux)**: when `tmux` is on the host, the PTY is delegated to `tmux new-session -A` (attach-or-create, session name `td_<id>`) so shells survive the **server** dying, not just a browser refresh. Auto-off where tmux is missing (incl. Windows) or `NO_TMUX=1` → falls back to a raw shell. Session close does `tmux kill-session` (killing the pty alone would only detach). Target sessions with `tmuxTarget()` (`=name`): plain `-t name` prefix-matches.
- Shell picked from `shellCandidates()`: `$SHELL`, then powershell (Windows), then zsh/bash/sh.
- `log=1` query param = read-only terminal (input from client is ignored — `isLog` gate in `onMessage`).
- `cwd` validated by `safeDir()` before spawn, falls back to `$HOME`.

**`scripts/http-security.js`** — CSP and baseline headers, the sign-in token/cookie, `apiGuard` (Origin + Host + Sec-Fetch-Site) and the WS `verifyClient`. Every `/api` route takes `apiGuard`.

**`scripts/*-api.js`** — the HTTP routes by area, each an Express router built from the helpers `server.js` passes in: `fs-api.js` (tree, viewer, open/reveal), `layouts-api.js`, `git-api.js` (worktrees, review, Finish, conflict radar), `agent-api.js` (agent events, approvals, allow-rules, stop-port).

**`public/index.html`** + **`public/app.js`** + **`public/app.css`** — the frontend: markup in `index.html`, all JS in `app.js` (~280KB, one classic script wrapped in an IIFE — not an ES module, so the `file://` demo keeps working), styles in `app.css`. No bundler.
- xterm.js + addons served locally from `node_modules` at `/vendor` (see `server.js`) — no CDN, runs fully offline after `npm install`.
- Floating draggable/resizable window panes, tiling, projects sidebar, theme picker, command palette (⌘K), search.
- Each pane opens its own WebSocket to the backend, passing `id`, `cols`, `rows`, `cwd`, optional `log`.
- State (windows, projects, themes) persisted in `localStorage`.
- Demo mode (no backend): forced on `file://`, `?demo`, or a `github.io` host (`FORCE_DEMO`). Static hosts get the UI + a fake shell, no PTYs.

**`docs/`** — GitHub Pages showcase (served at `kiril6.github.io/termdeck/`). `docs/index.html` is the landing page; `docs/app/` is a backend-free copy of the frontend for the live "Try the demo" link.
- ⚠️ **`docs/app/index.html`, `app.js` and `app.css` are generated copies of `public/`.** After ANY edit to `public/index.html`, `public/app.js` or `public/app.css`, run `npm run build:demo` (→ `scripts/build-demo.js`) and commit the result, or the hosted demo drifts from the real app. The script copies the HTML with `/vendor/` rewritten to relative paths, copies `app.js` and `app.css`, and re-copies the xterm assets.

**`install.js`** — one-shot dependency installer. Picks node-pty variant by platform, installs base deps `--ignore-scripts` first, falls back to plain `npm install` on failure.

## Feature log — keep it current

[`FEATURES.md`](FEATURES.md) is the single source of truth for user-facing behavior.
**Any change that adds, removes, or alters a feature MUST update `FEATURES.md` in the same
change.** Read it first when you need to know what already exists.

## Conventions

- Backend is deliberately dependency-light (express, ws, node-pty only). Keep it that way.
- The reattach/grace-timer + ring-buffer is the core invariant — changes to WS lifecycle in `bindWsEvents`/`connection` must preserve "disconnect ≠ kill, reconnect replays buffer".
- UI icons are **monochrome inline SVGs** from the `ICON` map in `public/app.js` (`currentColor`, same style as the header buttons) — including toast icons. No emoji or text glyphs as icons; add a new `ICON` entry if none fits. Exceptions: status LED dots (`.led`, tab dots, `DEAD_DOT`) stay as coloured dots, and the "Needs approval" toast keeps its red tint.
- **Never commit or push directly to `master`.** Before any commit run `git branch --show-current`; if it is `master` (or an already-merged branch), create a fresh feature branch first, push that, and open a PR.
