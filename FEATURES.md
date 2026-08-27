# Features

Single source of truth for what the Terminal Dashboard does. **Keep this current:**
any change that adds, removes, or alters user-facing behavior must update this file in
the same change (see the rule in `CLAUDE.md`).

Legend: 🖥️ frontend (`public/index.html`) · 🔌 backend (`server.js`)

---

## Terminals & windows
- 🖥️ Floating, draggable, resizable terminal windows; minimize, maximize, tile into a grid.
- 🖥️ Multiple tabs (shells) per window with a scrollable tab strip. **Double-click a tab name to rename it**; the tab count and custom names persist across reloads (`localStorage`).
- 🖥️ Read-only **log panels** (`⌘⌥L`) — mirror output with input disabled.
- 🖥️ Per-terminal **font zoom** — `⌘+` / `⌘-` / `⌘0`; PTY re-fits to the new size.
- 🖥️ **Configurable scrollback** — palette → *Set scrollback…* sets how many lines of history each
  terminal keeps (default 8000, clamped 500–200000). Applies to new terminals and live to open ones;
  saved to `localStorage` (`td.scrollback.v1`). Bigger = long build/test logs survive; smaller = less
  RAM across many terminals.
- 🖥️ Custom right-click menu on terminals: Copy, Paste, Find…, Select all, Clear, Save output…
  (native browser menu preserved on chrome/inputs; Paste hidden on read-only log panels).
- 🖥️ **Find in terminal** (`⌘F` when focused) — scrollback search with match highlighting and a
  result counter (xterm search addon). `⌘F` with no terminal focused filters sessions instead.
- 🖥️ **Clickable links** — URLs in output open in a new tab (xterm web-links addon).
- 🖥️ **Save output** — right-click → *Save output…* downloads the scrollback as a `.log`
  (xterm serialize addon).
- 🖥️ **GPU rendering** — WebGL renderer with automatic fallback on context loss.
- 🔌 **Live working directory** — each window's cwd badge follows the shell as it `cd`s. The backend
  polls each shell's real working dir from the OS (~1.5s) and pushes it on change — no shell config
  or OSC 7 needed. Linux reads `/proc/<pid>/cwd`; macOS runs one batched `lsof` for all shells;
  other platforms fall back to the spawn dir. The tree stays project-anchored (this answers
  "where is this shell?" on the shell itself, not by moving the sidebar).

## Projects
- 🖥️ Group windows into project tabs; switch context instantly. Cycle projects with `⌘⇧]` / `⌘⇧[`.
- 🖥️ **Limits:** 12 terminals per project, 10 project tabs (keeps one browser tab responsive).
- 🖥️ Directory sidebar / tree (`⌘B`) — **real filesystem** listing via `/api/ls` (dirs first, dotfiles
  hidden by default), rooted at the **active project's** root and lazy-expanding dirs on click. Per-row actions:
  a dir's **＋** opens a new terminal there (`createSession` at that path); clicking a file's name opens
  the **in-app file viewer** (`/api/read` → overlay showing the text; binary files and >2 MB files are
  handled gracefully), and its **⤢** reveals it in the OS file manager (`/api/reveal`). Falls back to a
  static demo tree in `file://` demo mode.
- 🖥️ **Right-click context menu** — right-click a tree row for the full action set: on a folder —
  *New terminal here · Open as new project · Set as project root · Copy path · Reveal in file manager*;
  on a file — *Open file · Copy path · Reveal*. The tree is the primary picker, no path-typing needed.
- 🖥️ **Header tools** — **↻ Refresh** re-reads the tree (new files/dirs appear) while **keeping expanded
  folders open** (open state tracked by path, restored after any refresh/project-switch), and **👁 Show
  hidden** toggles dotfiles (`/api/ls?all=1`, persisted in `localStorage`).
- 🖥️ **Breadcrumb navigation** — the sidebar header is a clickable path breadcrumb; click any ancestor
  segment to re-root the tree there (step back / up), **⌂** resets to the project root, and **📌** pins the
  current location as the project's persistent root. Deep paths scroll to keep the current folder in view.
  Switching projects clears the override.
- 🖥️ **Empty / error state** — a genuinely empty or unreadable root shows a centered placeholder
  (📂 *Empty folder* / ⚠️ *Can't read folder*) instead of a bare word, so an empty sidebar reads as
  intentional, not broken. (Nested empty dirs still show a compact inline note.)
- 🖥️ **Project root** — each project anchors to the path of its first shell (the Dir/"New project" path),
  persisted in `localStorage`; the tree follows the project tab, not the focused terminal. The
  last-used cwd is remembered **per project**, so a fresh project starts at `$HOME` (tree reset) and
  never inherits another project's path — unless you type one in the Dir popover.
- 🖥️ **Dir popover** (📁) — type a path with **live autocomplete** (subdirectories of the deepest existing
  ancestor, filtered by what you've typed; ↑/↓ to move, Tab/Enter to accept) and a **validity indicator**
  (green border when the typed path is a real dir, red when its parent doesn't exist), all from `/api/ls`.
  Then **Spawn here** (shell in the active project; if it's the project's first terminal and the tab still
  has its default `project N` name, the tab is renamed to the folder's basename) or **New project** (new
  project tab named after the folder's basename + a shell there). A non-existent path is **rejected with an
  inline "No such folder"** instead of silently spawning in `$HOME`. Inline ✕ clears the input.

## Sessions & reattach
- 🔌 **Durable sessions (tmux)** — when `tmux` is on the host, each shell is spawned inside
  `tmux new-session -A` (attach-or-create) instead of a raw PTY, so the shell **survives a server
  restart or crash**: after `npm start` comes back, reconnecting with the same `id` reattaches the
  still-living tmux session. Same pattern ttyd/wetty use. Auto-off where tmux is missing (incl.
  Windows) or when `NO_TMUX=1` — falls back to raw-shell spawn. **Explicit kill** ends the tmux
  session (`kill-session`); disconnect/grace only detaches the client, so the session lives on for
  later reattach. cwd tracking uses `tmux display-message #{pane_current_path}` for tmux sessions.
  **Ceiling:** nothing survives a machine **reboot** (process memory is gone) — tmux only survives
  the server dying, not the OS. Across a restart, xterm's native scrollback replay is skipped (tmux
  repaints the current screen; history stays reachable via tmux copy-mode). Startup banner reports
  whether durable sessions are on.
- 🔌 **Reattach model:** on WS disconnect the PTY is NOT killed — a 60s grace timer holds it;
  reconnecting with the same `id` replays the last 1 MB of output. Survives browser refresh.
- 🖥️ **Wake reconnect** — on tab refocus (`visibilitychange`), reconnecting shells retry
  immediately instead of waiting out the backoff (localhost drops on sleep aren't network events).
- 🖥️ WS auto-reconnect with exponential backoff (caps at 5s).
- 🖥️ **Coalesced exit toasts** — a shell exiting shows a *"Shell exited"* toast with a red status dot
  (matching the *Restored* toast's dot), but a **burst** of exits within ~700ms (e.g. many dead PTYs on
  mass reattach after a long absence) collapses into a single *"N shells exited while you were away"*
  toast instead of one per terminal.
- 🔌 Shell picked from `$SHELL` → PowerShell (Windows) → zsh/bash/sh; `cwd` validated before spawn.
- 🔌 **`cmd` query param** — a fresh shell can be handed a startup command (typed in after ~300ms).
  Runs once, only on a genuinely new shell (raw: always fresh here; tmux: gated by `has-session`).

## Input & productivity
- 🖥️ **Safe paste** — pasting into a terminal goes through xterm's **bracketed-paste** (a shell at its
  prompt treats the whole paste as literal input, so newlines don't auto-run), and routes like real
  input (broadcast + long-run timer apply). A **multi-line paste** (more than one command) asks for
  confirmation first — belt-and-suspenders for shells/TUIs that don't enable bracketed paste. Applies
  to the right-click *Paste*; native `⌘V` uses xterm's own bracketed paste.
- 🖥️ **Run command on start** — spawn a shell that immediately runs a command. The Dir popover (📁) has
  an optional *Run command on start* field (e.g. `npm run dev`, `ssh user@host`); the command is typed
  into the fresh shell so you see it run and the interactive shell stays afterwards. Backend runs it
  **only on a fresh shell** — never re-fired on a reattach/restart (tmux `has-session` guard). Not
  persisted, so it won't re-run on page reload.
- 🖥️ **SSH hosts** — save `ssh` targets (palette → *Add SSH host…*); each appears in the palette's **SSH**
  group with per-row edit ✎ / delete 🗑. Connecting opens a new window running `ssh <target>` (via the
  run-command-on-start path), so on disconnect you drop back to the local shell rather than losing the
  window. Targets accept full args (`-p 2222 user@host`). Stored per-browser in `localStorage`
  (`td.ssh.v1`), not synced across devices.
- 🖥️ **Broadcast input** — 📢 Cast toolbar toggle / `⌘⌥B`: keystrokes **and inserted snippets** mirror to
  every live shell **in the active project** (not other projects — a cast can't hit shells you can't see).
  Pulsing red state signals ON (destructive — one command hits all of the project's shells).
  **Auto-disarms on project switch** so an armed cast never carries into another context.
  Button is **disabled unless the active project has ≥2 live shells** (a lone shell has nothing to
  cast to); an armed cast auto-disarms if the live-shell count drops below 2.
  Works in **demo mode** too — demo shells count and echo mirrored input, so the showcase can demonstrate Cast.
- 🖥️ **Command snippets** — save reusable commands (palette → *Save snippet…* or `⌘⌥S`, in-app input modal),
  run from the palette's Snippets group **or the 🔖 icon in each terminal's footer**. Both surfaces expose
  per-row **edit ✎ / delete 🗑** (palette rows show the buttons on hover). The footer menu is
  an anchored dropdown: row-click inserts, the list scrolls when long (thin scrollbar matching the terminal),
  and *＋ New snippet…* stays pinned at the bottom.
  A snippet is *typed* into that shell without a trailing newline, so you review before pressing Enter.
  Stored per-browser in `localStorage` (`td.snippets.v1`) — survives reloads, not synced across devices.
  The footer icon is hidden on read-only log terminals.
- 🖥️ **Command palette** (`⌘K`) — fuzzy search over commands, sessions, and snippets. Command
  rows use monochrome stroke icons throughout — session rows show a filled disc for the active
  project, a hollow ring for other projects.
- 🖥️ **Search & filter** sessions by window name, tab name, or directory, with a visible "filter is on" indicator (`⌘F` when unfocused).
- 🖥️ **Mini-game while you wait** — palette → *Play game* or `⌘⌥G` opens a game overlay.
  Header dropdowns pick the game — **🦖 Dino** (Space/↑/click to jump) or **🐍 Snake**
  (arrows/WASD to steer) — and the **watch scope**: *just this tab* (default), *all tabs in
  this window*, or *every shell in this project*. `P` pauses, `Esc` closes; click/tap fires on
  press (no lag). Arms on the focused terminal; when a matching shell's command finishes (same
  done-heuristic as command-done alerts) a green in-game banner names it — the game never
  auto-closes, you decide when to leave. Plays solo if no terminal is focused.
- 🖥️ **Long-run nudge** — when any command runs past 20s, a ⏳ *"Still working…"* toast (+ OS
  notification) offers to play a game while you wait; click it to open the game armed on that tab.
  Fires **even while you're watching** the terminal (waiting is the point) — only suppressed if a
  game is already open. Once it finishes, the ✅ done toast reports the run duration (*"finished in Xs"*).
  A 🎮 icon in each window footer opens the game directly.

## Notifications
- 🖥️ In-app toasts, mirrored to native desktop notifications **only when the window is unfocused**
  (opt-in via browser permission). Hovering a toast **pauses its auto-hide** (so you can read or
  click it, e.g. the game offer); moving the pointer away re-arms the countdown. ✕ dismisses now.
- 🖥️ **Command-done alerts** — a shell you're not watching finishing (prompt returns `$ # % >`,
  bell, or OSC 133;D shell-integration mark) fires a toast/notification. 3s per-tab cooldown.
- 🖥️ Attention indicators on tabs/dock chips for background output.

## Appearance & layout
- 🖥️ Themes — per-terminal or dashboard-wide, searchable picker (`⌘⇧P`). 24 built-in: 17 dark + 7 light (GitHub Light, Paper, Solarized Light, One Light, Catppuccin Latte, Rose Pine Dawn, Gruvbox Light).
- 🖥️ Dock — bottom session bar with activity/attention indicators and overflow edge hints.
- 🖥️ Tiling (`⌘⌥⇧T`), fullscreen (`F11`).
- 🖥️ **Responsive toolbar** — below ~1200px the secondary toolbar buttons (Tree, Search, Tile, Cast,
  Dir, Theme, Fullscreen, Help) collapse into a single **⋯** overflow menu; the brand, connection
  status, `⌘K`, and **New terminal** stay on the bar. Prevents the toolbar overflowing off narrow windows.
- 🖥️ Muted `© 2026 kiril6 · MIT` credit, bottom-right of the empty desktop only (hides with the
  "No sessions yet" hint once a shell is open).
- 🖥️ **Ambient pixel pets (idle/away screensaver)** — low-opacity pixel critters (a cat, a
  slime, and a bird) walk a *floor strip* along the desktop bottom edge, each with its own wander/pause/groom
  AI. They are **not shown while you're working**: they appear only when the browser tab loses
  focus/visibility **or** the mouse sits idle ~45s, and vanish the moment you return or move the
  mouse. Pure CSS box-shadow sprites tinted from the active theme's `--accent`/`--muted`, so they
  recolor with the theme. Decorative only — `pointer-events:none`; they ride above window bodies
  but stay pinned to the bottom band so they never cover terminal text, and sit below the
  toolbar/sidebar/overlays. Toggle the whole feature with **`⌘⌥P`** or palette → *Toggle pixel
  pets* (paw icon); enabled by default, state saved to `localStorage` (`td.pets.v1`). Fully hidden
  under `prefers-reduced-motion`.
- 🖥️ **Help / About** — the **? Help** button (and `?`) opens an overlay: a one-paragraph "what is
  this" intro at the top, then the full keyboard-shortcut reference. The empty desktop also shows a
  *What is this?* link that opens the same overlay, so a first-timer has an entry point. The intro
  line shows the running **app version** (`v1.0.0 · …`), fetched from `GET /api/version` which the
  backend reads from `package.json` — one source of truth, no hardcoded string. Silent in demo/no-backend.
- 🖥️ **Shortcut labels are OS-aware everywhere** — `navigator.platform` picks mac (`⌘`/`⌥`) vs
  Windows/Linux (`Ctrl`/`Alt`). Dynamic labels use the `kbd()` helper; command-palette key hints
  use `osKeys()` (glyph combo → per-OS `<kbd>` tokens); static help-panel/top-bar/hint labels **and
  all `title` tooltips** are rewritten at load for non-mac. `<html>` gets an `is-mac` class (mac-only
  inner letter-spacing so `⌘K` reads as `⌘ K`). Handlers accept `metaKey || ctrlKey`.
- 🖥️ **Browser-reserved combos avoided** — actions the browser/OS hard-owns (`⌘T` new-tab, `⌘W`
  close-tab, `⌘L` omnibox, `⌘⇧B`/`⌘⇧T`/`⌘⇧N` bookmarks/reopen/incognito, `⌘M` mac-minimize) are
  bound to `⌘⌥…` / `Ctrl+Alt+…` instead, matched by `e.code` so mac's Alt-mangled `e.key` (`⌥T`→`†`)
  doesn't break them. Known gap: tab/project cycle (`⌘[` `⌘]` `⌘⇧[` `⌘⇧]`) still collides with mac
  Chrome history/tab-nav — works on Windows/Linux.

## Persistence & safety
- 🖥️ Layout (windows, projects, themes) saved to `localStorage` (`td.state.v5`, `td.theme.v2`),
  debounced 300ms.
- 🖥️ **Single-instance guard** — a timestamped `localStorage` lock + heartbeat elects one active
  tab; extra dashboard tabs go passive behind an overlay so they can't clobber shared state.
- 🖥️ **Confirm before losing shells** — `beforeunload` native prompt on browser close/refresh when
  any shell is live; in-app modal for app-controlled closes (`⌘⌥W`, window ✕, dock chip, delete project).
  The in-app modal only fires when a command is actively running — closing an idle shell (sitting at its
  prompt, nothing running) skips the confirm.

## Backend / security
- 🔌 Express static server + `ws` WebSocket PTY multiplexer; node-pty (standard or Linux prebuilt fork).
- 🔌 **Fully offline** — xterm.js + addons are served locally from `node_modules` at `/vendor` (no CDN); after `npm install` the app needs no internet.
- 🔌 **Loopback bind** by default (`127.0.0.1`); `HOST=0.0.0.0` (or an IP) to expose, with a warning.
- 🔌 **WS Origin + Host validation** — rejects the upgrade unless both resolve to a known localhost
  name (blocks cross-site / DNS-rebind attacks on the shell socket). No token by design.
- 🔌 **`/api/ls` + `/api/reveal` + `/api/read`** — sidebar-tree filesystem read, OS-file-manager reveal,
  and file-text read for the in-app viewer (2 MB cap, NUL-byte binary detection), all behind the
  **same** Origin+Host guard as the WS (`apiGuard`) so a cross-site page can't read the disk.
- 🔌 **Auto-open browser** on `npm start` — launches the dashboard in the default browser
  (OS opener: `open`/`start`/`xdg-open`). `NO_OPEN=1` skips it; `BROWSER=<name|path>` picks a
  specific browser (e.g. `BROWSER="Google Chrome"` on macOS, `BROWSER=firefox` on Linux).
- 🔌 `/debug` page — dumps env and tries each shell candidate when shells won't start.
- 🔌 **`npx` runnable** — `npx github:kiril6/termdeck` fetches deps and launches the server with no clone (`bin: termdeck`, shebang on `server.js`). All paths are `__dirname`-relative so it runs from any install dir. tmux/durable-session support only if `tmux` is on the host.

## Modes
- 🖥️ **Live** over `http(s)://` (real shells). **Demo** over `file://`, with `?demo` in the URL, or on a `github.io` host (no backend, UI preview with a fake shell).
- 🌐 **Hosted demo** — `npm run build:demo` produces a static, backend-free copy under `docs/app/` (vendored xterm, relative paths) for GitHub Pages. Served at [kiril6.github.io/termdeck/app](https://kiril6.github.io/termdeck/app/?demo).
