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
nothing, never blocks the agent for more than ~2s, and always exits 0. Events are display-only —
termdeck never answers a prompt for you.

> Shells that were already running when you upgraded don't have `TD_ID`; open a new terminal.
> After a server restart on a different port, shells kept alive by tmux still hold the old `TD_URL`.

## Claude Code

`~/.claude/settings.json` (or a project's `.claude/settings.json`):

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" claude" }] }],
    "PreToolUse":       [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" claude" }] }],
    "PostToolUse":      [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" claude" }] }],
    "PermissionRequest":[{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" claude" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" claude" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" claude" }] }]
  }
}
```

## Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "hooks": {
    "BeforeAgent":  [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" gemini" }] }],
    "BeforeTool":   [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" gemini" }] }],
    "AfterTool":    [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" gemini" }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" gemini" }] }],
    "AfterAgent":   [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" gemini" }] }]
  }
}
```

## Codex

`~/.codex/hooks.json` (Codex asks you to review/trust new hooks the first time):

```json
{
  "hooks": {
    "UserPromptSubmit":  [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" codex" }] }],
    "PreToolUse":        [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" codex" }] }],
    "PostToolUse":       [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" codex" }] }],
    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" codex" }] }],
    "Stop":              [{ "hooks": [{ "type": "command", "command": "node \"$TD_HOOK\" codex" }] }]
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
| `tokens`, `cost` | optional numbers, shown only if present |

`permission_request` → red *needs approval*; `stop`/`error` → amber *waiting*; the rest → *working*.
Unknown ids return 404, malformed events 400, more than 30 events/s per terminal 429.
