# Hook payload fixtures (#46)

Real stdin payloads captured from the agent CLIs' hooks, with paths, ids, transcript paths and model
text replaced by placeholders. `expected.json` in each folder is the event `scripts/td-hook.js` must
produce for each one. `node scripts/check-hooks.js` (run in CI) feeds every fixture through the helper
against a mock server and fails on any difference — so if a CLI changes its hook format, CI fails
instead of the agent queue silently going quiet.

| CLI | Captured with | Fixtures |
|---|---|---|
| Claude Code | 2.1.195 (interactive + `-p`) | all six hook events |
| Codex | codex-cli 0.160.0 (interactive TUI) | no `Notification` hook exists |
| GitHub Copilot CLI | 1.0.93 (`copilot -p`, user hooks) | prompt, pre/post tool, permission request (camelCase, no `hook_event_name`), notification, stop |
| Gemini CLI | 0.62.0: only `SessionStart` / `SessionEnd` fired (the personal-account tier is rejected, so no model turn ran) | none yet — those two events are not mapped by the helper; capture a full turn with an API-key login |

To add a CLI or refresh one: record the hook's stdin (any hook command that writes stdin to a file),
sanitise it, drop it in `<cli>/<name>.json`, and add its expected event to `<cli>/expected.json`.
