#!/usr/bin/env node
// termdeck agent-event hook helper (#40). Wire it into an agent CLI's hooks and it reports the
// agent's lifecycle to the termdeck terminal it runs in:   node "$TD_HOOK" <agent>
// Reads the hook JSON from stdin (Claude Code / Gemini CLI / Codex share this shape).
// SAFE TO LEAVE INSTALLED: silent no-op outside termdeck (no TD_ID/TD_URL), never prints, never
// blocks the agent (short timeout) and always exits 0 — a hook must not break the agent's turn.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TD_ID, TD_URL, TD_TOKEN } = process.env;
if (!TD_ID || !TD_URL) process.exit(0);
setTimeout(() => process.exit(0), 2000).unref();   // hard ceiling

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
  return {
    id: TD_ID, agent, type, tool: h.tool_name,
    detail: input.command || input.pattern || input.url || h.message,
    files: typeof file === 'string' ? [file] : undefined,
  };
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { if (raw.length < 1 << 20) raw += c; });
process.stdin.on('end', () => {
  let ev; try { ev = toEvent(JSON.parse(raw), process.argv[2] || 'agent'); } catch { ev = null; }
  if (!ev) process.exit(0);
  const body = JSON.stringify(ev);
  const post = (url, token, onFail) => {
    const req = http.request(new URL('/api/agent-events', url), {
      method: 'POST', timeout: 1500,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                 ...(token ? { Cookie: 'td_token=' + token } : {}) },
    }, (res) => { res.resume(); res.on('end', () => process.exit(0)); });
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
