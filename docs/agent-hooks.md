# Agent hooks — exact agent state in the queue

Out of the box termdeck guesses agent state from terminal output (idle for ~8s = waiting, a regex for
permission prompts). Agent CLIs can report it exactly through **hooks**. Wire them to termdeck's helper
and the agent queue shows real *working / waiting / needs approval* with the current tool and file —
instantly, no idle wait.

Every terminal termdeck spawns has these environment variables:

| Variable | Meaning |
|---|---|
| `TD_ID` | this terminal's id (tells termdeck which window an event belongs to) |
| `TD_URL` | where to POST events (the running server) |
| `TD_HOOK` | absolute path of the helper, `scripts/td-hook.js` |
| `TD_TOKEN` | access token, only when remote access is on |

The helper is **safe to leave installed**: outside termdeck (no `TD_ID`) it does nothing, it prints
nothing, never blocks the agent for more than ~2s, and always exits 0 — with one deliberate exception: a
`PermissionRequest` (Claude Code, Codex) is held until you click **Approve / Deny** on the agent-queue row, then the
helper prints that decision. No click means no output and the CLI asks as usual (after 120s, when you type in the
terminal, or when no browser is attached). termdeck never answers a prompt unless you click — or you opted in to a scoped
allow-rule (*Always allow…* on an approval row; off by default; never for deny-listed commands; every firing is logged and toasted).

## Verified against the real CLIs

Payloads were captured from real sessions and are replayed through the helper in CI
(`scripts/fixtures/hooks/`, `node scripts/check-hooks.js`), so a CLI changing its hook format fails the build.

| CLI | Version tested | Status |
|---|---|---|
| Claude Code | 2.1.195 | ✅ every event in the snippet; `"$TD_HOOK"` expands; silent and error-free outside termdeck |
| Codex | codex-cli 0.160.0 | ✅ with one setting (below): all events incl. approval; `apply_patch` files are read from the patch text (it arrives in `tool_input.command`). No `Notification` hook exists |
| Gemini CLI | — | ⚠️ not verified yet (needs a signed-in install); the snippet follows its docs |

**Two things the real CLIs taught us** (both fixed here):
- A bare `node "$TD_HOOK" …` **fails outside termdeck** — `$TD_HOOK` is empty, `node ""` runs node on stdin and the hook
  exits 1 with a SyntaxError on every event. The snippets below guard it (`[ -z "$TD_HOOK" ] || node …`), and
  `termdeck hooks install` upgrades older entries in place.
- **Codex hooks run with a reduced environment**: `TD_ID`/`TD_URL`/`TD_HOOK` arrive empty unless
  `~/.codex/config.toml` has `[shell_environment_policy] inherit = "all"`. (Codex's default excludes variables whose
  names contain `KEY`/`SECRET`/`TOKEN`, so with remote access on `TD_TOKEN` is dropped too.)

Notes from the captures: Claude Code fires `PermissionRequest` and `Notification` (`notification_type: "permission_prompt"`) only
in **interactive** sessions — `claude -p` denies instead of asking, so no approval state there.

**Token usage (#85):** no hook payload carries it, but Claude Code and Codex give a `transcript_path` (JSONL) and the
helper reads it on `stop` (silent, ≤ 48 MB, ~50 ms), sending `tokens` and `cacheTokens` — as **recorded by the agent**,
never estimated, and **no dollar figure** (neither transcript has one; termdeck ships no price table).
- `tokens` = new input + cache writes + output; `cacheTokens` = cache reads, shown separately because they are ~98 % of
  the volume (measured: 18.6 M cache reads vs 0.33 M real tokens in one session) and are repeats.
- **Claude Code** repeats one message once per streamed block in the transcript; a naive sum **double-counts (~2×)**, so
  the helper sums per message id. Main conversation only — sub-agent runs are not in that file. `scripts/check-usage.js` pins this in CI.
- **Codex** `token_count` is cumulative: the helper takes the last one (input − cached input + output).
- **Gemini CLI**: unchecked, shows nothing. Unreadable / missing / oversized transcripts show nothing (never a `0`).

## Quick setup

```bash
termdeck hooks install --dry-run     # preview: shows only the entries it would add
termdeck hooks install               # asks, backs up, then merges   (--yes to skip the question)
termdeck hooks uninstall             # removes only termdeck's entries
```

It detects Claude Code, Gemini CLI and Codex (`--agent claude|gemini|codex|all`), **merges** into their existing
config without touching your other hooks or settings, is idempotent, writes a timestamped
`<file>.termdeck-bak-…` backup first, and refuses (changing nothing) on a file it can't parse. Prefer to edit by
hand? The snippets below are exactly what it writes.

> Shells that were already running when you upgraded don't have `TD_ID`; open a new terminal.
> After a server restart on a different port, tmux-kept shells still hold the old `TD_URL`; the helper then falls back to
> `~/.termdeck/server.json` (current URL, plus the token when it is on; mode 0600), so events still arrive.

## Claude Code

`~/.claude/settings.json` (or a project's `.claude/settings.json`):

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" claude" }] }],
    "PreToolUse":       [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" claude" }] }],
    "PostToolUse":      [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" claude" }] }],
    "PermissionRequest":[{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" claude" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" claude" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" claude" }] }]
  }
}
```

## Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "hooks": {
    "BeforeAgent":  [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" gemini" }] }],
    "BeforeTool":   [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" gemini" }] }],
    "AfterTool":    [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" gemini" }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" gemini" }] }],
    "AfterAgent":   [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" gemini" }] }]
  }
}
```

## Codex

`~/.codex/hooks.json` (Codex asks you to review/trust new hooks the first time), **plus** this in `~/.codex/config.toml`
so the hooks can see `TD_*`:

```toml
[shell_environment_policy]
inherit = "all"
```

```json
{
  "hooks": {
    "UserPromptSubmit":  [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" codex" }] }],
    "PreToolUse":        [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" codex" }] }],
    "PostToolUse":       [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" codex" }] }],
    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" codex" }] }],
    "Stop":              [{ "hooks": [{ "type": "command", "command": "[ -z \"$TD_HOOK\" ] || node \"$TD_HOOK\" codex" }] }]
  }
}
```

The three CLIs share the same stdin shape (`hook_event_name`, `tool_name`, `tool_input`), so one helper
serves all of them. Other CLIs: any hook that can pipe that JSON into `node "$TD_HOOK" <name>` works, or
POST directly:

```bash
curl -s -X POST "$TD_URL/api/agent-events" -H 'Content-Type: application/json' \
  ${TD_TOKEN:+-H "Cookie: td_token=$TD_TOKEN"} \
  -d "{\"id\":\"$TD_ID\",\"agent\":\"mycli\",\"type\":\"stop\"}"
```

## Event reference

`POST /api/agent-events` — JSON, max 64KB:

| Field | |
|---|---|
| `id` | required — `$TD_ID` |
| `type` | required — `prompt_submit`, `tool_start`, `tool_end`, `permission_request`, `stop`, `error` |
| `agent`, `tool`, `detail`, `files` | optional display strings (capped; `files` ≤ 10) |
| `tokens`, `cacheTokens`, `cost` | optional numbers (the helper sends the first two on `stop`; `cost` only if an agent supplies one), shown only if present |

`permission_request` → red *needs approval*; `stop`/`error` → amber *waiting*; the rest → *working*.
Unknown ids return 404, malformed events 400, more than 30 events/s per terminal 429.
