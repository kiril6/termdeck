#!/usr/bin/env node
// termdeck agent-event hook helper (#40). Wire it into an agent CLI's hooks and it reports the
// agent's lifecycle to the termdeck terminal it runs in:   node "$TD_HOOK" <agent>
// Reads the hook JSON from stdin (Claude Code / Gemini CLI / Codex share this shape).
// SAFE TO LEAVE INSTALLED: silent no-op outside termdeck (no TD_ID/TD_URL), never blocks the agent
// (short timeout) and always exits 0 — a hook must not break the agent's turn. The ONE exception (#44):
// a PermissionRequest is held until you click Approve/Deny in termdeck (or ~2 min / you answer in the
// terminal), and only then prints the decision. No click = no output = the CLI's normal prompt.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TD_ID, TD_URL, TD_TOKEN } = process.env;
if (!TD_ID || !TD_URL) process.exit(0);
const WAIT_MS = 125000;                              // just over the server's approval hold (120s)
const ceiling = setTimeout(() => process.exit(0), 2000);   // hard ceiling
ceiling.unref();

const EVENTS = {
  UserPromptSubmit: 'prompt_submit', BeforeAgent: 'prompt_submit',
  PreToolUse: 'tool_start',          BeforeTool: 'tool_start',
  PostToolUse: 'tool_end',           AfterTool: 'tool_end',
  PermissionRequest: 'permission_request',
  Stop: 'stop',                      AfterAgent: 'stop',
  StopFailure: 'error',              PostToolUseFailure: 'error',
};

function toEvent(h, agent) {
  let type = EVENTS[h.hook_event_name];
  if (h.hook_event_name === 'Notification' && /permission/i.test(h.notification_type || h.message || '')) type = 'permission_request';
  if (!type) return null;
  const input = h.tool_input && typeof h.tool_input === 'object' ? h.tool_input : {};
  const file = input.file_path || input.path || input.notebook_path;
  let detail = input.command || input.pattern || input.url || h.message;
  let files = typeof file === 'string' ? [file] : undefined;
  if (h.tool_name === 'apply_patch' && typeof input.command === 'string') {   // Codex: the patch text itself is tool_input.command
    files = [...input.command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim());
    detail = files.length > 1 ? files.length + ' files' : undefined;           // never show the raw patch as the "command"
    if (!files.length) files = undefined;
  }
  // wait: ask the server to hold this request open for a human decision. Only a real PermissionRequest
  // (Claude Code / Codex) can take a decision back — a Gemini Notification can't.
  const ev = { id: TD_ID, agent, type, tool: h.tool_name, detail, files, wait: h.hook_event_name === 'PermissionRequest' };
  // The full command + cwd let the server match opt-in allow-rules (#44 phase 2). Bash only — never a patch body.
  if (ev.wait && h.tool_name === 'Bash' && typeof input.command === 'string') { ev.command = input.command.slice(0, 4000); if (typeof h.cwd === 'string') ev.cwd = h.cwd.slice(0, 500); }
  return ev;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { if (raw.length < 1 << 20) raw += c; });
process.stdin.on('end', () => {
  let ev; try { ev = toEvent(JSON.parse(raw), process.argv[2] || 'agent'); } catch { ev = null; }
  if (!ev) process.exit(0);
  const body = JSON.stringify(ev);
  if (ev.wait) { clearTimeout(ceiling); setTimeout(() => process.exit(0), WAIT_MS).unref(); }
  const post = (url, token, onFail) => {
    const req = http.request(new URL('/api/agent-events', url), {
      method: 'POST', timeout: ev.wait ? WAIT_MS : 1500,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                 ...(token ? { Cookie: 'td_token=' + token } : {}) },
    }, (res) => {
      let out = '';
      res.setEncoding('utf8').on('data', (c) => { if (out.length < 1024) out += c; });
      res.on('end', () => {
        if (ev.wait && res.statusCode === 200) {
          let d; try { d = JSON.parse(out).decision; } catch {}
          if (d === 'allow' || d === 'deny') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest',
            decision: d === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', ...(ev.agent === 'codex' ? { message: 'Denied from termdeck' } : {}) } } }));
        }
        process.exit(0);
      });
    });
    req.on('error', onFail).on('timeout', () => { req.destroy(); onFail(); });
    req.end(body);
  };
  // Unreachable TD_URL = the server restarted elsewhere (tmux shells keep the old env, #47): use the url/token it wrote to ~/.termdeck/server.json.
  post(TD_URL, TD_TOKEN, () => {
    let cur; try { cur = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.termdeck', 'server.json'), 'utf8')); } catch {}
    if (!cur || typeof cur.url !== 'string' || cur.url === TD_URL) process.exit(0);
    try { post(cur.url, cur.token, () => process.exit(0)); } catch { process.exit(0); }
  });
});
