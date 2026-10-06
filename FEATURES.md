# Features

Single source of truth for what the Terminal Dashboard does. **Keep this current:**
any change that adds, removes, or alters user-facing behavior must update this file in
the same change (see the rule in `CLAUDE.md`).

Legend: 🖥️ frontend (`public/index.html`) · 🔌 backend (`server.js`)

---

## Terminals & windows
- 🖥️ Floating, draggable, resizable terminal windows; minimize, maximize, tile into a grid. Resize from any of the four edges or four corners (dragging the top/left edge keeps the opposite edge anchored); the dragged edge snaps to neighbouring windows' edges (with an alignment guide) and stays within the desktop bounds. Move and resize work with touch as well as mouse (pointer events).
- 🖥️ **Glue two windows (🔒)** — drag a window against another (the edge-snap already lines them up) and a
  small lock appears on the shared edge when you hover it. Click to **lock the pair**: they then move together
  and dragging the shared edge grows one window while shrinking the other; click again to unlock. Pairs only
  (locking a window re-pairs it), and touching means facing edges within 10px overlapping ≥40px. Glued pairs
  get an accent outline and don't screen-snap. Glue is remembered while a window is minimized/maximized but only
  acts when both are visible, unmaximized, in the same project and still touching; resizing another edge until
  they part unlocks. Saved with the layout (`glue` = partner id in `td.state.v5`). On touch (no hover) the lock
  appears for 4s when a drag/resize ends against another window, or when you tap on a shared edge; it is
  larger on coarse pointers.
- 🖥️ Multiple tabs (shells) per window with a scrollable tab strip. **Double-click a tab name to rename it**; the tab count and custom names persist across reloads (`localStorage`).
- 🖥️ Read-only **log panels** (`⌘⌥L`) — mirror output with input disabled.
- 🖥️ Per-terminal **font zoom** — `⌘+` / `⌘-` / `⌘0`; PTY re-fits to the new size.
- 🖥️ **Configurable scrollback** — palette → *Set scrollback…* sets how many lines of history each
  terminal keeps (default 8000, clamped 500–200000). Applies to new terminals and live to open ones;
  saved to `localStorage` (`td.scrollback.v1`). Bigger = long build/test logs survive; smaller = less
  RAM across many terminals.
- 🖥️ Custom right-click menu on terminals: Copy, Paste, Find…, Select all, Clear, Save output…
  (native browser menu preserved on chrome/inputs; Paste hidden on read-only log panels).
- 🖥️ **Desktop right-click menu** — right-click the empty desktop (not a window, the tree or a control) for a launcher
  of the frequent actions instead of the browser's native menu: *New terminal · New agent task… · Open file… · Open
  directory…*, then only what can work right now — *Tile windows* (something to tile), *Restore minimized (N)*,
  *Broadcast input* (≥2 live shells), *Review agent changes… / Finish agent task…* (an agent-worktree project, live
  mode) — then *Toggle directory tree · Change theme… · Fullscreen · Command palette…*. Same actions and shortcut
  hints as the palette, nothing destructive, no submenus; snippets, SSH hosts and AI CLI presets stay in the palette.
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
  handled gracefully; **`.md` files render as formatted Markdown** with a *Raw / Rendered* toggle), and its **⤢** reveals it in the OS file manager (`/api/reveal`). Falls back to a
  static demo tree in `file://` demo mode.
- 🖥️ **Markdown viewer** — `.md` / `.markdown` files open **rendered** (headings, bold/italic, inline + fenced
  code, lists, blockquotes, tables, rules, `http(s)`/`mailto` links) in the file-viewer overlay; the header
  button flips to the raw source and back. Reach it by clicking a file in the tree **or** palette → *Open
  file…* (path relative to the project root, absolute, or `~/…`; works for any text file). Zero dependencies:
  a ~40-line renderer inline in `public/index.html`. Input is HTML-escaped first and images are shown as
  their alt text, so a file can't inject markup or trigger requests. Not full CommonMark (no nested lists /
  reference links). In the hosted demo the tree's `README.md` and the palette command open a sample document.
- 🧭 **First-run tour** — a 5-step spotlight walkthrough (⌘K palette → New agent task → agent queue → projects & dock → Help) that auto-shows once on a first visit (not on narrow/touch screens) and never again once closed (`td-tour-done` in `localStorage`). Replay: palette → *Take the tour*, the Help sheet, or the empty-desktop link. Esc closes, ←/→ step, focus stays in the card; no layout shift, no network, animation off under `prefers-reduced-motion`. Works in the hosted demo.
- 🗂️ **Palette categories** — a chip row under the ⌘K input (*All · Terminals · Agents · Workspace · Saved · Sessions*) narrows the list; click a chip or press **Tab / Shift+Tab** to cycle, and the search text still applies inside the chosen category. Resets to *All* each time the palette opens. A **×** in the input (or **Ctrl+U**) clears the typed text.
- ⌨️ **Palette shortcut hints** — every palette command that has a shortcut shows it, matching the real binding.
  Frequent actions get one (*Open file* `⌘⌥O`, *New agent task* `⌘⌥R`, *Review agent changes* `⌘⌥D`); one-off setup
  dialogs (*Add SSH host*, *Add AI CLI preset*, *Set scrollback*) deliberately stay palette-only. *Maximize / restore*
  moved to `⌘⌥⇧M` — `⌘⇧M` (New project) was shadowing it.
- 🖥️ **Right-click context menu** — right-click a tree row for the full action set: on a folder —
  *New terminal here · Open as new project · Set as project root · Copy path · Open in editor · Reveal in file manager*;
  on a file — *Open file · Copy path · Open in editor · Reveal*. *Open in editor* (`/api/open-editor`) spawns `TD_EDITOR` (default `code`) on the path with no shell; a missing editor shows a toast. The tree is the primary picker, no path-typing needed.
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
  **Shell picker** — when the host has more than one shell (zsh/bash/sh, plus fish/pwsh if on `$PATH`), the
  popover shows a *Shell* dropdown (default = `$SHELL`). The choice is sent as `?shell=` and the server honours
  it only if it is in `shellCandidates()` (same list as `GET /api/shells`) — never an arbitrary executable.
  Applies to new shells only (also under tmux); it is remembered per tab across reloads. Hidden in demo mode.
  **Footer shell badge is clickable** (live, non-log terminals, host has >1 shell) — opens a menu above it:
  *New tab in this folder* with any shell (current one ticked; non-destructive, safe with a running agent) and
  *Restart this tab as…* (swaps the shell: a new tab with the same name/cwd takes the old tab's slot and the old one
  is closed, confirm first). Restart is **disabled while an agent is running in the tab** (`tab.agent`) since it would kill it.

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
  whether durable sessions are on. When tmux is **absent** and the server is started from a real
  terminal (npx / `npm start` by hand), it offers once to install tmux via the OS package manager
  (brew/apt/dnf/pacman/zypper/apk), explaining the trade-off; declining writes `~/.termdeck-tmux-optout`
  so it never asks again. Skipped entirely on Windows, with `NO_TMUX=1`, or when stdin isn't a TTY
  (CI / piped / detached), so scripted runs never block.
- 🔌 **Reattach model:** on WS disconnect the PTY is NOT killed — a 60s grace timer holds it;
  reconnecting with the same `id` replays the last 1 MB of output. Survives browser refresh.
  The WS id is `<sessionId>-<tabId>`, so **both** ids are persisted with the layout — a reload that
  minted fresh tab ids would connect under a new id and silently get a *brand new shell* (and, with
  tmux, leak the old `td_*` session) instead of reattaching.
  `TD_GRACE_MS` and `TD_BUFFER` override those defaults with positive numeric values;
  invalid, zero, and negative values safely fall back to the defaults.
- 🔌 **Backend terminal cap** — once `TD_MAX_PANELS` (default 64) live shells exist, the server spawns no
  more, so a client bypassing the UI's per-project limit can't exhaust the host. Only brand-new sessions
  count; reattaching to an existing `id` is never blocked. Invalid/zero/negative values fall back to 64.
  The refusal carries a reason: the server sends `{type:'error', code:'panel_cap_reached', limit, current}`
  and closes, and the window **stops reconnecting**, parks as dead with *"terminal limit reached (N) — close a
  window or raise TD_MAX_PANELS, then click ⟳ to retry"* in the terminal, and one toast per burst. ⟳ retries.
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
- 🖥️ **AI CLI presets** — one-click launch of an AI coding CLI in a fresh terminal, from the palette's
  **AI CLI** group. Built-ins: Claude Code, Codex, Gemini, Copilot, plus Cursor Agent, OpenCode, Qwen Code and Aider. Only the top 4 built-ins show; the rest sit behind a **More agents (N)** row (always expanded while you search). Agents are **ranked by use** (decayed launch count in `localStorage` `td.aicli.use.v1`, half-life 14 days; order only changes after 3 launches; palette → *Reset agent order* clears it) and your own presets always show. Each CLI gets its prompt the way it expects (`--prompt` for OpenCode, `-i` for Qwen Code, first argument for the rest; Aider can't pre-fill one, so *New agent task…* launches it bare and tells you). Add your own (palette → *Add AI CLI
  preset…*) — label + command, stored per-browser in `localStorage` (`td.aicli.v1`), with per-row edit ✎
  / delete 🗑 (built-ins are fixed). Launches via the run-command-on-start path (same as SSH), spawning in
  the active project root; on agent exit you drop back to the local shell. Tabs launched this way are
  tagged as *agent* tabs (persisted across page reloads), which arms the waiting watch below.
- 🖥️ **Resume agents after a reboot / dead shell** — agent tabs remember a *resume command*, persisted with
  the tab and sent as its startup command on reload. The backend runs a startup command **only on a fresh
  shell**, so a live reattach (reload, server restart under tmux) never re-fires it; after a machine reboot
  (tmux gone) or on a host without tmux, the agent comes back instead of a bare shell. The launch command is
  left exactly as the preset says (**no extra flags** — a shell function wrapping the CLI can choke on them), and
  resume runs the real binary via `command <cli>` for the same reason (aliases / functions that mangle
  arguments are skipped). Built-ins: **Claude** `command claude --continue`, upgraded to the **exact**
  `command claude --resume <session id>` as soon as a hook event reports the CLI's own session id (hooks
  installed → correct even with several agents in one folder; without hooks `--continue` resumes the folder's
  latest conversation); **Codex** `codex resume --last`, **Gemini** `gemini --resume latest`, **Copilot**
  `copilot --continue` ("last" forms are per-folder, so worktree tasks stay unambiguous). Resume is
  `<resume> || <cli>`: if there is nothing to resume it starts the CLI clean — the original task prompt is never
  re-sent. *Add/Edit AI CLI preset…* has an optional **Resume command** field (`{id}` is not substituted for
  custom presets). If you exited the agent but left its shell open, a reboot will resume it again.
  **Verified with real Claude Code 2.1.195:** a conversation survived a killed tmux session + reload and
  remembered its context, `--resume <id>` restored an interactive session, a plain reload did not re-run it.
  *Not verified:* Codex / Gemini / Copilot resume flows. A Claude that opens its agent dashboard on bare
  `claude` can't `--resume` a running background agent (falls back to a clean start).
- 🖥️ **Agent worktrees — one isolated checkout per task** (palette → *New agent task…*). Three agents
  loose in one repo overwrite each other, so a task gets its own `git worktree`: pick a **branch name**,
  an **AI CLI preset**, and an optional **prompt**, and the backend cuts a worktree off the project's repo
  at its current HEAD (`POST /api/git/worktree`). The worktree opens as its **own project tab**, rooted at
  the new checkout — so the tree, the cwd and every shell in it are scoped to that branch — and the agent
  CLI launches there with the prompt as its first argument (shell-quoted, so apostrophes and shell
  metacharacters are passed literally, never executed). Worktrees live in a sibling
  `<main-repo>-worktrees/<branch>` folder, keeping the repo itself clean — always cut from the **main**
  working tree, even when started from another agent's worktree tab (never nested). **Nothing is removed
  automatically:** a finished task stays on disk until you run *Finish agent task…* (below) and opt in to cleanup.
  Requires the project root to be inside a git repo. Failures name their **real** cause rather than
  a plausible-sounding wrong one: a non-repo says so, a host without git installed says *that*, and in
  backend-free demo mode both commands say so — three different messages, never one catch-all.
- 🖥️ **Review agent changes — read-only diff** (palette → *Review agent changes…*). Reviewing what an
  agent did is the real bottleneck, not launching it. Diffs the project's worktree against the commit it
  was cut from (`GET /api/git/diff`), so **committed and uncommitted work both show in one view**, with a
  file summary (modified / added / deleted / new) above the unified diff and untracked files listed.
  Deliberately **view-only** — no accept, discard or reset buttons; landing is a separate, explicit step
  (*Finish agent task…*). The base commit is persisted with the project, so the baseline survives reloads.
- 🖥️ **Send to agent (#27)** — turn a selection into a prompt for another terminal, no copy-paste. **Three
  sources, one target picker:** a selection in the **file viewer** (a floating *Send to agent…* button appears
  next to it), a selection in the **Review agent changes** diff, or **any terminal's output** (right-click →
  *Send selection to agent…*). The picker lists live terminals — **agent tabs first, then the same project, then most
  recently focused** (shells are listed too, so any CLI you started by hand works; with no live terminal at all it
  says so). The message is a reference plus the excerpt in a code fence: `path/to/file.ts:40-52` (path relative to
  the target's folder when it is inside it), or per file `src/a.ts:12-15` + a `diff` fence for the diff (line numbers
  are the **new** file's; removed-only selections say `removed lines a-b`), or `Output from "<window>":` for terminal
  output. A rendered-markdown selection has no line map, so it sends the path only. It is **typed, never executed
  — no trailing newline** — so you add your instruction and press Enter; the target is revealed and focused.
  **Safety:** text is wrapped in a bracketed paste (a TUI sees one paste — real Claude Code shows
  `[Pasted text #1 +3 lines]`), but if the target did not turn bracketed paste on and the text has line breaks it
  asks first, because the breaks could run as commands. Control characters (an embedded `ESC[201~` could end a
  paste early) and bidi overrides are stripped, the fence is longer than any backtick run in the text, and a selection
  over 64 KB is refused. It deliberately does **not** go through Cast broadcast (that would copy a file excerpt into
  every shell). Works in demo mode too. Checked in a real browser against zsh and real Claude Code.
- 🖥️ **Finish agent task — merge or PR, then clean up** (palette → *Finish agent task…*, #83). The "land"
  step of launch → watch → unblock → review → land. Shows the branch, its base and commits ahead, then
  you pick: **Merge** into the branch the worktree was cut from (`git merge --no-ff`, run in the main tree),
  **Push and open a pull request** (`git push -u origin` + `gh pr create --fill --base <base>`), or **Keep as
  is** (just closes the tab). Each option is offered only when it can work and otherwise **states why**:
  uncommitted work in the worktree (termdeck never commits for you), main tree dirty or on a different branch
  than the base, a merge that would conflict (dry run with `git merge-tree`, main tree untouched), no commits to
  land, `gh` missing / not signed in, no `origin`. **Cleanup is a separate opt-in, off by default**, and asks a
  confirm that names the exact path and branch: `git worktree remove` then `git branch -d` — **never
  `--force`, never `-D`**, so git itself refuses a dirty tree or an unmerged branch (the reason is shown, and
  if only the branch is refused the worktree-removed/branch-kept state is reported). Only worktrees listed by
  `git worktree list` that sit directly in `<main-repo>-worktrees/` are ever touched. The base *branch* is
  recorded when the worktree is cut (older projects fall back to the main tree's current branch, and the
  dialog says so). Afterwards the worktree's project tab and shells are closed (same confirm as any project
  delete). `GET/POST /api/git/finish`, behind `apiGuard`; the POST re-runs the preview and refuses anything
  the preview disallowed; one finish per repo at a time. Not available in demo mode.
  **Pre-merge check (#119):** an optional *Check before landing* command (e.g. `npm test`), remembered per repo
  (`td.checks.v1`, keyed by the main tree), runs **in the worktree** before Merge or PR, with `CI=1` so test runners
  skip watch mode. A non-zero exit or a timeout (`TD_CHECK_TIMEOUT`, default 600 s; the whole process tree is
  killed) **blocks landing** and shows the last 15 lines of output; *Land anyway* is a separate explicit click.
  Empty = no check, as before. The command is only ever what you typed — never read from the repo.
  **Cycle time:** a task launched with *New agent task…* records `launchedAt`; landing shows *"landed in 2h14m"*.
  Projects from before this change show none (no guessing from git dates).
- ⚠️ **Conflict radar** — warns when two agents' worktrees of the same repo change the **same file**, before
  you hit it at merge time. While ≥2 worktree projects have a live agent, the browser asks
  `POST /api/git/overlaps` every 10 s (paused while the tab is hidden); the server diffs each worktree against its
  base (committed + uncommitted + untracked), intersects per repo and, for shared files with the same base,
  compares the changed **line ranges** (`git diff -U0`) — *"(same lines)"* means real hunk collision, no suffix
  means same file, different regions. Shown as an **orange dot** on the affected project tabs (hover for the
  list) and a `⚠ overlaps with <project>: <files>` line in the agent queue. Informational only — nothing is
  ever merged, blocked or changed. Bounded: ≤16 worktrees, ≤500 files each, ≤50 shared files, 4 git
  processes at a time, read-only `git` via `execFile`, behind `apiGuard`; idle with a single worktree.
- 🔌 **"Waiting on you" agent watch** — an agent tab that streams output and then goes quiet (idle ~8s)
  flips to a **waiting** state: an amber pulse on its tab + dock chip so the dock reads as a who-needs-me
  queue, plus a toast + OS notification (naming the session, click to jump) **only when you're not already
  watching that tab**. New output ends the waiting state (agent resumed); viewing the tab clears it. Armed
  **only on agent tabs** (launched from an AI CLI preset), so normal shells never trip it — zero false
  positives. Heuristic by design (idle-timer, CLI-agnostic); no per-CLI parsing. The one-shot
  startup `cmd` is deliberately *not* persisted, so it can never re-fire on reload. The waiting/approval
  states themselves are never persisted either: they're re-derived from the live output stream (a tmux
  reattach repaints the current screen, so a still-pending approval prompt re-flags itself).
- 💚 **Working pulse** (#28) — a green pulsing dot (with a static ring, so it still reads under reduced-motion) on a window tab and its dock chip while a tab is *working*: a live agent tab that is neither waiting nor blocked, or a shell whose tracked command (Enter → prompt) has been streaming output for >1s (keystroke echo ignored; 3s of silence → idle). Amber *waiting* / red *approval* always take over. *Idle* = the plain dot; *done* = the existing finish toast + attention flash. Heuristic, no backend or per-CLI parsing.
- ⛔ **Approval-prompt routing** — when an agent tab hits a tool-approval prompt (*"Allow this tool?"*,
  *"Do you want to proceed?"*, `(y/n)`…), it jumps **straight** to a louder **red** pulse (tab + dock chip)
  and a **sticky** toast/OS notification ("Needs approval — blocked on a permission prompt") — no 8s idle
  wait, since an approval halts *all* progress. Stays flagged through prompt repaints until you look at it.
  **Never answers on its own** — without hooks it only surfaces + jumps, never sends `y` (Approve / Deny needs the hook channel, below). Cross-CLI regex heuristic.
  On **reattach** only the tail of the replayed ring buffer (last 2 KB — the current screen) is scanned:
  matching the whole buffer would re-fire a red flag for a prompt you already answered earlier in the
  session. A prompt that is still on screen is still caught; history is not re-litigated.
- 🖥️ **Project attention dots** — the waiting/approval state also bubbles up to the **project tab** in the
  sidebar as a small dot, so a project you're not currently viewing still signals a queued agent: **amber**
  when any of its tabs is waiting, **red** when any is blocked on an approval (red wins). Recomputed as tab
  state changes, on session close, and when a session moves between projects; cleared when the last flagged
  tab/session goes away.
- 🧭 **Cross-project agent queue** — a toolbar button (⋯ overflow menu below 1200px) opens a popover
  listing **every agent tab across all projects** in one who-needs-me queue, ranked
  **needs approval → waiting → working**, ties broken alphabetically by project, session, then tab.
  Clicking a row jumps straight to it: switches project, reveals the window, focuses the tab, closes the
  popover. The button's badge mirrors the highest-priority state in the queue (**red** approval beats
  **amber** waiting beats working), and its tooltip carries the count, so the whole fleet collapses to one
  glanceable control. Empty state reads *"No active agents / All quiet"*.
- ✅ **Approve / Deny from the queue (#44, phase 1)** — with agent hooks installed, an approval row in the
  agent queue shows the **exact request** (tool + command or file) and **Approve / Deny** buttons. Not
  keystroke injection: the CLI's `PermissionRequest` hook is held open by `scripts/td-hook.js` until you click,
  then prints the CLI's own allow/deny JSON, so it is exact for any prompt style and nothing is typed into a PTY.
  **Checked against real Claude Code 2.1.195** (allow → "Allowed by PermissionRequest hook", deny →
  "Denied by …"; the normal dialog still shows while the hook is held, and answering it in the terminal
  releases the hold). Codex uses the same JSON per its docs but blocks on the hook *before* its prompt, so typing
  in that terminal releases the hold — not yet verified against a real Codex. **No click = no decision**: after
  120s (`TD_APPROVAL_HOLD_MS`), when you type in the terminal, when no browser is attached, or on any other agent
  event, the helper prints nothing and the CLI asks as usual. Only that terminal's own socket can answer
  (same guards as input); the command is shown via `textContent`. **Audit log:** every held request is
  recorded with time, terminal, tool/command, decision and **who decided** (*you* / *in terminal* / *timed out* /
  *replaced*) — listed under the queue (*Recent approvals*), served at `GET /api/approvals`, and appended to
  `TD_LOG_DIR/approvals.jsonl` (0600) when set. Without hooks, or on Gemini (no decision channel), rows stay
  jump-only.
- 🔢 **Token totals (#85)** — what the agent itself reported, never estimated, labelled *as reported by the agent*.
  On `stop` the hook helper reads the CLI's transcript (**Claude Code, Codex**; Gemini shows nothing) and sends the
  conversation total; the browser keeps it **per tab** and shows it on the **queue row** (`361k tok`), the **queue
  header** (`1 active · 361k tok`, all projects) and the **project tab tooltip** (`2 agents · …`). A tab's report
  *replaces* its entry (it is already a total); a project total is the sum of its tabs, closed ones included, since
  they cost money. Stored in `localStorage` `td.usage.v1` (7-day prune) so a reload keeps it; palette → **Reset
  usage** clears it. **What a "token" is:** new input + cache writes + output; **cache reads are shown separately**
  in the tooltip (≈98 % of the volume, and repeats). Claude's transcript repeats a message per streamed block, so
  the helper sums per message id — a naive sum double-counts ~2× (`scripts/check-usage.js` pins it). **Not
  covered:** Claude sub-agent runs (separate files), any dollar figure (no transcript has one; no price table),
  CLIs without a transcript. Verified against a real Claude Code transcript (matches an independent recount) and a
  real Codex rollout. No data → nothing shown, never `0`.
- 🔐 **Opt-in allow-rules + hard deny-list (#44, phase 2)** — **off by default, none shipped.** A hook-backed
  approval row for a shell command also offers **Always allow…**: a confirm dialog names the scope (the **git
  repo / worktree** containing the agent's working directory, so a `cd` into a subfolder still matches) and
  asks *only this exact command* or *anything starting with its first two words*. The rule is derived on the
  server from the command you were just shown — the client never sends a pattern, and there is no user regex.
  Matching is literal: exact string, or a prefix on a word boundary **with nothing chained after it** (`;`, `&`,
  `|`, backticks, `$(`, redirects, newlines make a prefix rule not match), the same agent, Bash only, inside
  the scope dir. Stored `0600` in `~/.termdeck/approval-rules.json`; capped at 100. **Visible, never silent:**
  each automatic answer is a toast ("Auto-allowed by rule") and an audit entry (*source: rule*, rule id) next to
  your manual ones; under the queue, *Auto-allow rules* lists them with **✕ delete** and **pause / resume**
  (pause keeps the rules). **Hard deny-list** (`scripts/approval-rules.js`): recursive `rm`, `sudo`, `git push --force` /
  delete / `reset --hard` / `clean`, download-piped-to-shell, `bash -c` / `eval` / interpreter inline code,
  `ssh`/`scp`/`nc`/`rsync`, reading `~/.ssh` / `.env` / cloud credentials, uploads, recursive `chmod`, `kill`
  by name, shell-startup edits, `npm publish`, `DROP TABLE` … — such a request shows a **⚠ reason**, has no
  *Always allow*, is refused by the rule endpoint, and is **re-checked at match time** so even a hand-edited
  rules file cannot cover it. It is best-effort, **not a sandbox**; CI (`scripts/check-rules.js`) pins matcher
  and deny-list behaviour. Same trust as terminal input: a local process that can already drive termdeck could
  also create a rule, so keep the loopback bind / access token. Rules only act through hooks (Claude Code,
  Codex) and need no browser open.
- 🔌 **Agent event bridge** — an agent CLI's lifecycle hooks report real state instead of the idle/regex
  guesses. Every PTY gets `TD_ID`, `TD_URL`, `TD_HOOK` (and `TD_TOKEN` when the access token is on) in its
  environment (tmux ≥ 3.2 via `-e`); the server also writes its current URL (and token, if on) to `~/.termdeck/server.json` (0600, removed on exit) and the helper falls back to it when `TD_URL` is unreachable, so tmux-kept shells keep reporting after a restart on another port; `scripts/td-hook.js` — a dependency-free, silent, never-blocking
  no-op outside termdeck — POSTs `{id,agent,type,tool,detail,files}` to `POST /api/agent-events`, where
  `type` ∈ `prompt_submit | tool_start | tool_end | permission_request | stop | error`. The server pushes
  the event only to that terminal's own browser socket (and replays the last one on reattach). In the
  browser: `permission_request` → red *needs approval* instantly, `stop` → amber *waiting*, anything else
  → *working* (also clears a red flag once you answered). The queue row shows the current tool and file
  (and cost, if an agent supplies one; token totals have their own entry below). A tab that receives events is auto-tagged as an agent and
  its output heuristics stand down; the 8s idle watch becomes a 120s safety net (an Esc-interrupt fires
  no Stop hook). **Without hooks nothing changes.** Setup for Claude Code, Gemini CLI and Codex:
  [docs/agent-hooks.md](docs/agent-hooks.md). **Verified against real Claude Code and Codex sessions (#46):**
  captured payloads live in `scripts/fixtures/hooks/` and CI (`scripts/check-hooks.js`) replays them through
  the helper, so a CLI changing its hook format fails the build instead of silently breaking the queue
  (Gemini CLI still unverified). Running the real CLIs surfaced and fixed: the hook command is now guarded
  (`[ -z "$TD_HOOK" ] || node …`) because a bare `node ""` errored on every event when the agent ran **outside**
  termdeck — `termdeck hooks install` upgrades old entries in place and leaves hand-edited ones alone; Codex
  `apply_patch` shows the patched file(s) instead of the raw patch text; and Codex needs
  `[shell_environment_policy] inherit = "all"` for hooks to see `TD_*` (documented, and `hooks install` prints a note).
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
- 🖥️ **Command palette** (`⌘K`) — fuzzy search over commands, sessions, snippets, SSH hosts, and AI CLI presets. Command
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
- 🔔 **Actionable toasts linger** — a toast with a click action (jump to a session, reveal a window…) stays at least 10s, is keyboard-focusable (Tab, Enter/Space to act), and its countdown pauses while the pointer is over it **or** it has focus, re-arming only once both are gone. Sticky (0 ms) toasts stay sticky.
- 🖥️ In-app toasts, mirrored to native desktop notifications **only when the window is unfocused**
  (opt-in via browser permission). Hovering a toast **pauses its auto-hide** (so you can read or
  click it, e.g. the game offer); moving the pointer away re-arms the countdown. ✕ dismisses now.
- 🖥️ **Command-done alerts** — a shell you're not watching finishing (prompt returns `$ # % >`,
  bell, or OSC 133;D shell-integration mark) fires a toast/notification. 3s per-tab cooldown.
- 🖥️ Attention indicators on tabs/dock chips for background output.

## Appearance & layout
- 🖥️ Themes — per-terminal or dashboard-wide, searchable picker (`⌘⇧P`). 24 built-in: 17 dark + 7 light (GitHub Light, Paper, Solarized Light, One Light, Catppuccin Latte, Rose Pine Dawn, Gruvbox Light).
  Text on accent-filled surfaces (the primary dialog button, hovered menu rows) is picked per theme as near-black or white, whichever contrasts more with that theme's accent (≥4.7:1 across all 24), via the `--on-accent` variable.
- 🖥️ Dock — bottom session bar with activity/attention indicators, overflow edge hints, and pointer-event drag-and-drop reordering (desktop: immediate; touch: long-press ~250ms to drag, so swiping over chips scrolls the dock).
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
  A **Feedback** line links to GitHub Discussions and the issue form (also at the end of `termdeck --help`
  and in the README). Plain links only — no telemetry, no prompts. Shown in the hosted demo too.
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
- 📄 **Remote access docs** — `docs/remote-access.md`: Tailscale Serve (recommended), SSH tunnel, LAN bind.
- 🔌 **`TD_ALLOWED_HOSTS`** — opt-in, comma-separated, exact-match hostnames added to the Origin + Host check so a
  reverse proxy like `tailscale serve` works while the server stays on loopback. No wildcards; unset = localhost only.
  Setting it also enables the access token (see above).
- 🔌 **Session log on exit** — with `TD_LOG_DIR` set, a shell's buffered output (ANSI stripped, last `TD_BUFFER` bytes)
  is written to `<dir>/<timestamp>_<id>.log` (dir `0700`, file `0600`) when the shell actually ends (kill / process exit).
  Browser disconnects don't write a log — reattach/replay is unchanged. Off by default (output can contain secrets).
- 🖥️ **Clickable file paths** — `path/file.ext`, `./x`, `~/x`, `/abs/x`, optional `:line[:col]` in terminal output become links
  when `/api/stat` confirms a regular file (relative paths resolve against the tab's live cwd). Click opens the file viewer
  scrolled to and highlighting that line (markdown opens as raw source for a `:line` link). Live mode only; no-op in demo.
- 📄 **Known limits** — a README section stating plainly what termdeck doesn't do (reboots end shells, heuristic agent state without hooks, no answering without your click or an opt-in rule, remote-access caveats, caps, Windows differences, demo has no backend).
- 🔌 **`termdeck autostart install|uninstall`** — sets up start-at-login without hand-editing (`scripts/autostart.js`):
  a launchd agent `~/Library/LaunchAgents/com.termdeck.plist` (macOS; `launchctl bootstrap`/`bootout`) or a systemd
  **user** unit `~/.config/systemd/user/termdeck.service` (Linux; `daemon-reload` + `enable --now`). No root.
  Fills the real `node`/`server.js` paths, `NO_OPEN=1`, a pinned `PORT` (`--port`, default 3000) and a `PATH`
  with node's, tmux's and git's dirs (service managers start with a minimal one); `HOST` only if `--host` is given,
  with a warning for non-loopback. Previews the whole file and the exact commands first; `--dry-run` writes/runs
  nothing; confirm unless `--yes` (non-terminal without it refuses). Idempotent (an identical file is left alone),
  reloads cleanly when it changed, `uninstall` stops the service and removes only a file it recognises (a foreign file
  is never overwritten). Paths are XML/systemd-escaped; the macOS log is pre-created `0600` because a non-loopback
  start logs the token URL; the access token is never written to the unit. Refuses to install from the temporary
  `npx` cache (it can be deleted). Verified on macOS (install → serving → idempotent → uninstall → clean); the
  systemd path is covered by a rendered-file check only.
- 📄 **Autostart templates** — `docs/autostart/` ships a launchd plist (macOS) and a systemd user unit (Linux), plus SSH-tunnel/Tailscale remote-access notes.
- 🔌 **Loopback bind** by default (`127.0.0.1`); `HOST=0.0.0.0` (or an IP) to expose, with a warning.
- 🔌 **Auth token on non-loopback binds** — when `HOST` isn't loopback, a random token is generated at startup and printed in
  the URL (`/?t=<token>`). Visiting it sets an `HttpOnly; SameSite=Strict` cookie and redirects; every HTTP request and WS
  upgrade then requires that cookie (401 otherwise). Restart = new token. Loopback stays token-free.
- 🔌 **WS Origin + Host validation** — rejects the upgrade unless both resolve to a known localhost
  name (blocks cross-site / DNS-rebind attacks on the shell socket). No token on loopback by design.
- 🔌 **`/api/agent-events` hardening** — same `apiGuard` Origin/Host check (and access token when on) as
  every `/api/*` route; JSON only, 64KB body cap, `type` whitelist, unknown/log-only terminal ids → 404,
  fields whitelisted and length-capped, 30 events/s per terminal (429), shown via `textContent`. An event
  can never write to a PTY — it only changes what the UI displays; termdeck still never answers without your click or a rule you opted in to (see *Approve / Deny*, *allow-rules*).
- 🔌 **`/api/git/root` + `/api/git/worktree` + `/api/git/diff` + `/api/git/finish`** — git repo detection, worktree creation
  and read-only diff for the agent-worktree flow, behind the **same** `apiGuard` as the rest. Worktree
  creation writes to the repo but grants no capability a shell in that repo doesn't already have
  (`git worktree add` is one command); **nothing deletes except the opt-in cleanup of *Finish agent task*** (`git worktree remove` / `git
  branch -d`, never forced, only termdeck-made worktrees) — no `-D`, no reset. Branch names are validated against a strict pattern and every git call uses `execFile` with an
  argument array (no shell), so a branch name or prompt can't inject a command.
- 🔌 **`/api/ls` + `/api/reveal` + `/api/read`** — sidebar-tree filesystem read, OS-file-manager reveal,
  and file-text read for the in-app viewer (2 MB cap, NUL-byte binary detection), all behind the
  **same** Origin+Host guard as the WS (`apiGuard`) so a cross-site page can't read the disk.
- 🔌 **Auto-open browser** on `npm start` — launches the dashboard in the default browser
  (OS opener: `open`/`start`/`xdg-open`). `NO_OPEN=1` skips it; `BROWSER=<name|path>` picks a
  specific browser (e.g. `BROWSER="Google Chrome"` on macOS, `BROWSER=firefox` on Linux).
- 🔌 `/debug` page — dumps env and tries each shell candidate when shells won't start.
- 🔌 **Command line** — `termdeck --help`, `--version`, `--port <n>`, `--host <addr>`, `--no-open` (flags are applied
  as the equivalent env vars *before* the server boots and win over existing ones; a bad value or unknown flag prints
  help and exits 2; works through `npm start -- --port 4000` too). No argument-parsing dependency (`scripts/cli.js`).
- 🔌 **`termdeck hooks install|uninstall`** — sets up the agent hooks without hand-editing JSON (`scripts/hooks.js`).
  Detects Claude Code (`~/.claude/settings.json`), Gemini CLI (`~/.gemini/settings.json`) and Codex
  (`~/.codex/hooks.json`) by their config dir (`--agent` forces one and creates its file). **Merges** the
  `node "$TD_HOOK" <agent>` entries into each event's list — your existing hooks and every other key are kept, a
  second run is a no-op, `uninstall` removes only our entries. Shows **only our entries** (never other settings,
  which may hold secrets), asks to confirm (`--yes` skips, `--dry-run` writes nothing, a non-terminal without
  `--yes` refuses), writes a timestamped `.termdeck-bak-…` backup, then writes atomically through symlinks (dotfile
  managers) keeping the file's mode, indent and trailing newline. A file that isn't valid JSON, or has a
  wrongly-shaped `hooks`, is reported and left untouched while the other CLIs still proceed (exit 1). The
  event table lives in one place and `scripts/check-hooks-docs.js` (run in CI) fails if
  [docs/agent-hooks.md](docs/agent-hooks.md) drifts from it. Only runs on this explicit command, never on start.
- 🔌 **`termdeck doctor`** — offline self-check (`scripts/doctor.js`), run in a child process so the server never starts:
  Node version, node-pty (and the macOS `spawn-helper` execute bit — missing after `npx`/global installs; doctor restores it, as the server does on start, so the shell check below is honest), a shell actually spawns, tmux present and ≥ 3.2 (needed
  for the agent-hook env), git, whether the port is free (a pinned `PORT` that's busy is a failure; otherwise a note
  that the server will move), network exposure / token state, wildcard `TD_ALLOWED_HOSTS`, `TD_*` numbers that would
  silently fall back to defaults, and `TD_LOG_DIR` writability. Each problem prints its fix. Exit 0 = all good,
  1 = any warning/failure. No network calls; plain text when piped or `NO_COLOR` is set.
- 🔌 **`npx` runnable** — `npx github:kiril6/termdeck` fetches deps and launches the server with no clone (`bin: termdeck`, shebang on `server.js`). Runs correctly as an installed dependency (npx / `npm i -g`), not just from a repo clone: `/vendor/*` assets resolve xterm via `require.resolve` (deps get hoisted to a parent `node_modules`, so `__dirname/node_modules` would 404), and node-pty's `spawn-helper` is `chmod +x`'d at startup on macOS (installs that skip `install.js` leave it non-executable → `posix_spawnp failed`). tmux/durable-session support only if `tmux` is on the host (offered for install on first interactive run — see Durable sessions).
- 🔌 **Auto port fallback** — default port is 3000. If it's busy and `PORT` wasn't set, the server walks up to the next free port automatically (3001, 3002, … up to 20 tries) and prints which one it landed on — so `npx` still works when 3000 is taken. If you **explicitly** set `PORT`, it's respected: a clash fails loudly with a `PORT=<n+1>` hint rather than silently moving. `HOST=0.0.0.0` (or a LAN IP) still binds where you ask.

## Modes
- 🖥️ **Live** over `http(s)://` (real shells). **Demo** over `file://`, with `?demo` in the URL, or on a `github.io` host (no backend, UI preview with a fake shell).
- 🌐 **Hosted demo** — `npm run build:demo` produces a static, backend-free copy under `docs/app/` (vendored xterm, relative paths) for GitHub Pages. Served at [kiril6.github.io/termdeck/app](https://kiril6.github.io/termdeck/app/?demo).
