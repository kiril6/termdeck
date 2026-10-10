# Changelog

User-facing changes per release, newest first. Shown in the app under Help → What's new.

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
