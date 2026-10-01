#!/usr/bin/env node
// termdeck agent-event hook helper (#40). Wire it into an agent CLI's hooks and it reports the
// agent's lifecycle to the termdeck terminal it runs in:   node "$TD_HOOK" <agent>
// Reads the hook JSON from stdin (Claude Code / Gemini CLI / Codex share this shape).
// SAFE TO LEAVE INSTALLED: silent no-op outside termdeck (no TD_ID/TD_URL), never prints, never
// blocks the agent (short timeout) and always exits 0 — a hook must not break the agent's turn.
const http = require('http');
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
  const req = http.request(new URL('/api/agent-events', TD_URL), {
    method: 'POST', timeout: 1500,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
               ...(TD_TOKEN ? { Cookie: 'td_token=' + TD_TOKEN } : {}) },
  }, (res) => { res.resume(); res.on('end', () => process.exit(0)); });
  req.on('error', () => process.exit(0)).on('timeout', () => process.exit(0));
  req.end(body);
});
