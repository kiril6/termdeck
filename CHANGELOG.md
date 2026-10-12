# Changelog

User-facing changes per release, newest first. Shown in the app under Help → What's new.

## 1.26.0
- **Clearer Live overview (Sessions → Grid)** — the grid now sits on a themed panel, so its buttons and labels are readable on light themes (they were almost invisible there), toggle buttons show a clear hover, tiles show their state as a coloured pill and an *Open ↵* hint on hover, keyboard focus is visible, and a click outside the panel closes it.
- **Start an agent from the empty Sessions list** — when no agents are running, the Sessions popover has a *Start an agent…* button that opens the command palette on its Agents tab (AI CLI presets and *New agent task…*).
- **Export / import settings** — palette → *Export settings…* saves your theme, terminal font, scrollback, snippets, SSH hosts, AI CLI presets and toggles to one file; *Import settings…* loads it in another browser (or after clearing site data). The window layout stays separate (*Save layout as…*).
- **Fixed: a blank page when the browser denies site storage** — with storage blocked for the site, termdeck stopped while starting and showed no windows. It now starts normally (nothing is remembered between visits).
- **Lighter when idle** — the window clocks no longer redraw every window every second: 10 idle windows went from ~3 % to under 1 % of the browser's main thread, and nothing ticks while the tab is in the background.
- **Works on a phone** — on a narrow screen (e.g. over Tailscale) termdeck now fits the screen: one window at a time, full size, switched from the dock, with a compact header. Before, the page was wider than the phone and the window and toolbar were cut off. Small buttons (window controls, tab +, project ×, dock move) are now at least 24 px, easier to hit by touch.
- **Easier to read, on every theme** — secondary text (descriptions, hints, counters) was too faint on 22 of the 24 themes (Nord the worst). Every theme now meets the WCAG AA contrast minimum for UI text, keeping its colours; light themes also get a readable accent where it colours text. Themes can be picked with the keyboard, the command palette works with screen readers, and keyboard focus is always visible. Dialogs keep keyboard focus inside while open and give it back when closed. **Move or resize a window with the keyboard**: ⌘K → *Move or resize window*, then arrows / Shift+arrows, Enter to keep, Esc to undo. Screen readers now hear notifications and can jump between the page's regions.
- **Fixed: Enter on *Cancel* confirmed** — in a confirmation (e.g. *Delete this project?*), tabbing to *Cancel* and pressing Enter ran the action anyway. Enter now does what the focused button says.
- **Fixed: the "could not start a shell" help** — when no shell could start, termdeck failed while writing the setup help, so the window showed a generic error instead. It now shows the errors and the `/debug` link.
- **Terminal library updated to xterm.js 6** — scrolling, the thin scrollbar and window snapping work as before; the scrollbar now fades out when idle and never covers the last text column. **Option/Alt+←/→ still jumps a word** (xterm.js 6 stopped doing this itself, so termdeck now does). In find, the current match shows in the selection colour.
- **Fixed: keystrokes jumping back into a terminal** — opening the command palette (or a dialog) right as a window took focus could close it again and send what you typed, including Enter, to the shell. A late focus no longer takes over when focus has moved elsewhere.
- **`localhost` and `127.0.0.1` are one address** — opening termdeck as `localhost` now takes you to `127.0.0.1`, so you sign in once for both and the "already open in another tab" check works across them.
- **Content Security Policy** — the app page now tells the browser to run scripts only from termdeck itself (plus its own small startup script, by hash), connect only back to termdeck, and never load plugins. If a bug ever let text be injected into the page as HTML, it could not run code from it.
- **Sturdier server** — a malformed message from a browser tab could stop the whole server, and without tmux every shell with it. Bad messages are now ignored and logged, a failing request answers with a plain error (no stack trace or server paths), and the shells keep running.
- **Needs Node.js 20 or newer** — on Linux it already did (the terminal library termdeck installs there requires Node 20); the stated minimum now says so, and CI tests Node 20, 22 and 24 on Linux, plus macOS and (best-effort) Windows. Firefox and Safari's engine (WebKit) are now tested alongside Chrome.
- **`termdeck uninstall`** — removes agent hooks, start-at-login, termdeck's tmux sessions and `~/.termdeck` in one step, after showing exactly what it will do (`--dry-run` to preview). Your settings backups and logs are kept and listed.
- **Fewer settings backups** — `termdeck hooks install/uninstall` keeps the newest 3 backups per settings file instead of all of them (they are full copies and may hold API keys).
- **Bounded audit log** — `TD_LOG_DIR/approvals.jsonl` rotates at 10 MB, keeping one previous file. The tmux "don't ask again" flag now lives in `~/.termdeck` (moved automatically).
- **Two servers starting together sign you in the same way** — servers started at the same moment on a fresh home folder could end up with different access secrets, so one of them rejected your browser. They now always agree on one.
- **Clear warning when the layout can't be saved** — if the browser refuses to store it (storage full, or blocked in a private window), a toast says so once instead of losing the layout silently on reload. Toggling *Follow*, *Show hidden files* or pixel pets no longer fails there.
- **Git calls time out** — local git commands behind the agent-worktree features give up after 60 s with a clear error instead of hanging on a held lock.
- **Smaller npm package** — ships only the files termdeck runs (19 instead of 56; no tests or fixtures). Install with `npx @kiril6/termdeck` or `npm i -g @kiril6/termdeck`; the docs no longer suggest `npx github:…`, which runs unreleased code.
- **Emoji and wide characters line up** — terminals now use Unicode 11 character widths, so emoji and CJK take two cells as shells and terminal apps expect (lines with emoji no longer drift). Under the hood xterm.js moved from the deprecated `xterm` packages to `@xterm/*` 5.5.
- **Restarts wait for the port** — with a fixed port (as `termdeck autostart` uses), a new server waits up to 5 s for the old one to let go of it instead of exiting with *Port in use*. Starting a second server while another one is running now says so on start.
- **Two servers, one home folder** — saved layouts and *Always allow* rules no longer get lost when two termdeck servers run at once (for example on two ports); each sees the other's changes without a restart. A `layouts.json` or `approval-rules.json` that can't be read is now kept as `<file>.corrupt-<time>` instead of being silently replaced with an empty one.
- **One live screen per terminal** — opening a terminal on another device (or browser) now moves it there; the old screen says *opened on another device* and stops sending keystrokes, instead of freezing while still typing into the shell. Click ⟳ on it to take it back.
- **Phone alerts leave out the command by default** — `TD_NOTIFY_URL` messages no longer include the command or file path unless you set `TD_NOTIFY_DETAIL=1`, since the message goes to a third-party service and commands can hold secrets. `TD_NOTIFY_DETAIL=0` still works and is now the default.
- **Clearer about agent trust** — *Send to agent* now labels the excerpt as quoted content (data, not instructions), since a file or terminal output can hold text written to steer an agent. *Finish agent task* says that landing runs code from the branch (the check command, and git hooks on merge or push).
- **Lighter with many tmux sessions** — following each terminal's folder used to start one `tmux` process per session every 1.5 s (about 40 a second at 64 terminals), even with no browser open. It is now one call for all of them: 20 idle sessions went from 13 tmux calls a second to under 1.
- **Fixed: closing a terminal could end a different one** — tmux finds a session by the start of its name when the exact name is gone, so ending a shell that had already exited could, rarely, end another terminal's shell. termdeck now always names its sessions exactly, and refuses malformed terminal ids instead of rewriting them.
- **Remote access over https** — behind an https proxy on an allowed host (e.g. `tailscale serve`), the sign-in cookie is now marked *Secure*, so the browser never sends it over plain http.
- **Fixed: terminals stuck on the slow renderer with many windows open** — browsers allow about 16 WebGL contexts per page, and every terminal took one, so past 16 the oldest terminals fell back to the slower DOM renderer for good, even when they were the only ones on screen. Now only terminals on screen use WebGL (up to 12), hidden ones hand theirs over, and a terminal that loses its context (e.g. after sleep) gets it back. Closed tabs are also freed from memory sooner.
- **Steadier under heavy output** — output is sent in small batches (about a third of the server CPU when a command prints a lot), and a browser tab that can't keep up — asleep, stalled or slow — no longer makes the server's memory grow without limit; when it catches up, its screen is refreshed from the replay buffer.
- **Hardened API** — one cross-site check covers every API route; *Reveal*, *Open in default app* and *Open in editor* now use POST; responses forbid framing by other sites and send no referrer.
- **Stricter "Always allow" rules** — a *starting with* rule now covers the command's first two words followed by plain words only (for example `npm test src/a.test.js`). Options, `name=value` and paths outside the project need a click or an exact rule, because many tools take options that run or write arbitrary things. Existing rules keep working with the stricter match. The deny-list also catches any command that touches shell startup files (`.bashrc`, `.zshrc`, `.profile`…).
- **Sign in once per browser** — termdeck now only answers browsers that hold its access cookie, so other programs on your computer (another user account, or an agent running inside termdeck) can no longer type into your terminals or click Approve for you. Nothing changes in the normal flow: the tab termdeck opens on start is already signed in, and the cookie survives restarts. A different browser shows a short page — run `termdeck open` once.
- **`termdeck open`** — opens the running dashboard in your browser, signed in (`--no-open` prints the link).
- **Agent hooks** use a per-terminal credential (`TD_HOOK_AUTH`) instead of the access token, which no longer appears in any terminal's environment or in `~/.termdeck/server.json`. Shells started before this update still show agent state; open a new terminal to get Approve / Deny from the queue there.
- **Safer rendering** — rendered Markdown in the file viewer and command-palette labels now escape every character that could be read as markup.
- **Faster with heavy output** — the server keeps each shell's replay buffer far more cheaply, so a command printing a lot (builds, logs, `cat` of a big file) no longer slows the other terminals. Reload still replays the last `TD_BUFFER` of output, as before.

### Upgrade notes
- **Node.js 20 or newer** is required.
- Nothing to do by hand: the tmux "don't ask again" flag moves into `~/.termdeck`, and five browser-storage keys get their new names (`td-tour-done` → `td.tourDone.v1`, and the same for the tree, palette-recent and overview settings) the first time 1.26 loads.
- `~/.termdeck/layouts.json` and `approval-rules.json` now carry a format version. A file written by a newer termdeck is still read, but this version will not change it — update termdeck instead of losing what the newer one saved.

## 1.25.1
- **Sessions button** — back to the robot icon (the grid icon clashed with *Tile*); the palette's *Live overview* entry gets its own monitor icon.
- **Live overview is sorted by urgency** — needs approval, waiting, working, running, idle, exited — with a teal border for working / running tiles, and a new **All | Active** filter that hides idle sessions. It defaults to Active while anything is running and to All otherwise; your pick is remembered.

## 1.25.0
- **Port globe** — a detected dev-server port now shows as a globe icon in the window footer, left of the snippet icon (it replaces the `:PORT` badge). Click opens `http://localhost:PORT` in a new tab; right-click offers *Open*, *Copy URL* and *Stop server*, which sends SIGTERM to the listener, only if it belongs to that terminal (macOS / Linux).
- **Palette search ranks by relevance** — word-start matches come first, and presets sort after real commands.
- **Sessions overview** — the active *Queue / Grid* toggle is now clearly visible, and the backdrop is blurred so the windows behind it no longer show through.
- Styled the *Restore layout* picker rows and delete button (they were unstyled).

## 1.24.0
- **Named layouts** — palette → *Save layout as…* names the whole workspace (projects, windows, tabs, folders) and *Restore layout…* brings it back, with a **×** to delete. Saved in `~/.termdeck/layouts.json` (browser storage in the demo). Restoring asks first, starts new shells in the saved folders and never relaunches agents.

## 1.23.1
- **Palette categories regrouped** — *Settings* now holds only real preferences (theme, terminal font, scrollback); keyboard shortcuts and the tour moved to a new *Help* chip, the game and pixel pets to *Fun*, the usage / agent-order resets to *Agents* and the directory-tree toggle to *Layout*.
- The "Take the tour" hints no longer claim a fixed number of steps.

## 1.23.0
- **Media & CSV preview** — the file viewer now shows images (png, jpg, gif, webp, avif, bmp, ico, svg), PDF, audio and video in place, and CSV / TSV as a table with a Raw toggle. Nothing to install. Binaries it can't preview offer *Reveal* and *Open in default app* (never for executables).
- **Terminal font** — palette → *Terminal font…* sets the family and size for every terminal, live; the dialog explains using a Nerd Font for prompt glyphs.
- The first-run tour gains a *Directory tree* step (⋯ menu: Follow, hidden files, project root, resize).
- The dock chip's *Move to project* button is disabled while there is only one project; icon buttons such as **+** now show their tooltip.

## 1.22.0
- **Follow focused terminal** (tree ⋯ menu) — focusing a window reveals its live working directory in the tree: ancestors expand, the folder is centered and pulses. It re-roots to your home folder when the terminal is outside the project root, and turning it off collapses what it opened.
- **Tree header** — slim header with an always-visible ↑ up-one-level button, ↻ refresh (spins once as feedback) and a ⋯ menu for Follow, Show hidden files, Back to project root and Pin as project root.
- **Resizable tree** — drag its right edge (double-click resets); the width resets each time it opens. Long breadcrumbs fade on the left and show the full path on hover.
- Refreshing or re-clicking a window no longer flashes the tree; loading / empty / error states use monochrome icons; the tree "+" now has a tooltip.
- The product header now reads **TermDeck**.

## 1.21.0
- **Antigravity** (`agy`, Google's successor to Gemini CLI for personal accounts) is now a built-in agent under *More agents*, with prompt pre-fill and resume.
- Docs spell out exactly which Gemini CLI hook events are verified (settings format and session events on 0.62.0).

## 1.20.0
- **GitHub Copilot CLI hooks** — `termdeck hooks install --agent copilot` gives Copilot tabs exact working / waiting / needs-approval state, Approve / Deny from the queue and phone alerts. Verified against Copilot CLI 1.0.93.

## 1.19.0
- **Live overview** — palette or toolbar button: a read-only tile per session across all projects with its latest output and state; click a tile to jump to it.
- **What's new and updates** — the version shows in the footer and Help, Help lists this changelog offline, a one-time toast appears after an upgrade, and *Check for updates* asks npm only when you click.
- The toolbar collapses into the ⋯ menu below 1260px (was 1200px) to fit the new button.

## 1.18.0
- **Phone notifications** — set `TD_NOTIFY_URL` (ntfy-ready) to get a push when an agent needs approval.
- **Layout presets** — 1×1, 2×1, 1×2, 2×2 and 3×2 in the palette; `Alt+1–9` jumps to the Nth window.
- **Footer badges** — each window shows its last command and any detected localhost port.

## 1.17.0
- **Pre-merge check and task cycle time** when finishing an agent task.
- **Fix** — zsh/bash prompts are detected, so finished commands stop the long-run timer.

## 1.16.0
- **Approve / Deny** agent permission prompts from the queue, with opt-in allow-rules and a hard deny-list.
- **Resume** agent sessions after a reboot or dead shell.
- **Token totals** per tab and project; **send a selection** to an agent terminal; desktop right-click menu.

## 1.15.0
- **Finish agent task** — merge or open a PR, then clean up the worktree.
- **Fix** — a restarted tab keeps its slot.

## 1.14.0
- Clickable shell badge: open a new tab or restart (guarded).

## 1.13.0
- Per-terminal shell selection; new shortcuts listed in Help.

## 1.12.0
- **First-run tour**; more built-in agents behind a *More* row, ranked by use.

## 1.11.0
- Open in editor, palette categories and a clear button, longer actionable toasts.

## 1.10.0
- **Conflict radar** — warns when two agents' worktrees change the same file.
- Agent hooks survive a server restart on another port.

Older releases: https://github.com/kiril6/termdeck/releases
