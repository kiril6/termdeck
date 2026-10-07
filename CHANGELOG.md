# Changelog

User-facing changes per release, newest first. Shown in the app under Help → What's new.

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
