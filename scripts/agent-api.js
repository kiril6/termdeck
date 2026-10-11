// /api/agent-events — structured agent state from CLI hooks (#40), the Approve / Deny queue (#44) with its opt-in
// allow-rules, and "Stop server" for a port a terminal opened. Returns the routes and the held approvals, which
// sessions.js settles when you type in the terminal or click in the browser.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const access = require('./access');
const rules = require('./approval-rules');
const { createStore } = require('./json-store');
const { tokenEq } = require('./http-security');
const { gitP } = require('./git-api');
const { send, tmuxTarget, positiveEnvNumber } = require('./sessions');

const isWindows = process.platform === 'win32';
// Events are UNTRUSTED data: whitelisted fields, length caps, per-terminal rate limit, unknown ids
// ignored. They only ever flow to that terminal's own browser socket — nothing here writes to a PTY.
const AGENT_EVT_TYPES = new Set(['prompt_submit', 'tool_start', 'tool_end', 'permission_request', 'stop', 'error']);
const cap = (v, n) => typeof v === 'string' && v ? v.slice(0, n) : undefined;
const execP = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 3000 }, (_e, out) => resolve(out || '')));
// Approve / Deny from the queue (#44).
// The hook helper's request stays open; a click arrives over that terminal's own WebSocket (same
// Origin/Host/token guards as input) and is answered with {decision}. Nothing is typed into a PTY, and
// no click means no decision: the helper prints nothing and the CLI shows its normal prompt.
const APPROVAL_HOLD_MS = Math.floor(positiveEnvNumber('TD_APPROVAL_HOLD_MS', 120000));
const AUDIT_MAX_BYTES = 10 * 1024 * 1024;
// Opt-in allow-rules (#44 phase 2).
// OFF by default and none shipped. A rule is derived server-side from a command you were just shown
// (reqId), so the client never supplies a pattern, never a regex; matching + the deny-list live in
// scripts/approval-rules.js (pinned by scripts/check-rules.js). Stored 0600 in ~/.termdeck. Every firing is
// an audit entry (source 'rule') and a toast. Same trust as terminal input: a local process that can already
// drive termdeck could also create a rule — keep the loopback bind / token.
const RULES_FILE = path.join(os.homedir(), '.termdeck', 'approval-rules.json');
const RECENT_REQ_MS = 10 * 60 * 1000, MAX_RULES = 100;
const validRule = (r) => r && typeof r.id === 'string' && r.tool === 'Bash' && typeof r.agent === 'string' && (r.mode === 'exact' || r.mode === 'prefix')
  && typeof r.pattern === 'string' && r.pattern && typeof r.dir === 'string' && path.isAbsolute(r.dir);

module.exports = function agentApi({ apiGuard, hasAuthCookie, secret, live, logDir }) {
  const notify = (() => {   // #84: optional outgoing webhook; off unless TD_NOTIFY_URL is set
    const n = require('./notify');
    try { return n.createNotifier(n.configFrom(process.env)); }
    catch (e) { console.error(`  TD_NOTIFY_URL ignored: ${e.message}`); return () => {}; }
  })();
  const pendingApprovals = new Map();   // terminal id -> { reqId, res, ev, timer }
  const approvalAudit = [];             // newest last, capped; also appended to TD_LOG_DIR/approvals.jsonl when set
  function recordApproval(entry) {
    approvalAudit.push(entry); if (approvalAudit.length > 200) approvalAudit.shift();
    if (logDir) try {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
      const f = path.join(logDir, 'approvals.jsonl');
      try { if (fs.statSync(f).size > AUDIT_MAX_BYTES) fs.renameSync(f, path.join(logDir, 'approvals.1.jsonl')); } catch {}   // keep this + one previous file
      fs.appendFileSync(f, JSON.stringify(entry) + '\n', { mode: 0o600 });
    } catch {}
  }
  function settleApproval(id, decision, source) {   // decision: 'allow' | 'deny' | null (= no decision, CLI asks as usual)
    const p = pendingApprovals.get(id); if (!p) return false;
    pendingApprovals.delete(id); clearTimeout(p.timer);
    recordApproval({ ts: Date.now(), id, agent: p.ev.agent, tool: p.ev.tool, detail: p.ev.detail, files: p.ev.files, cwd: p.ev.cwd, decision, source });
    if (!p.res.writableEnded) { if (decision) p.res.json({ decision }); else p.res.status(204).end(); }
    const s = live.get(id); if (s?.ws) send(s.ws, { type: 'approval', reqId: p.reqId, done: true, decision, source });
    return true;
  }
  const recentReqs = new Map();         // reqId -> { agent, tool, command, cwd, ts }
  const rulesFile = createStore(RULES_FILE, {   // shared safely by several servers; an unreadable file is kept aside, never overwritten
    parse: (j) => {
      if (j.rules !== undefined && !Array.isArray(j.rules)) throw new Error('"rules" is not a list');
      return { enabled: j.enabled === true, rules: (j.rules || []).filter(validRule).slice(0, MAX_RULES) };
    },
    serialize: (v) => v,
    version: 1,
  });
  function updateRules(fn) {
    try { return rulesFile.update(fn); } catch (e) { console.error('  [rules] save failed:', e.message); return undefined; }
  }

  const api = express.Router();
  // "Stop server" from the footer globe: SIGTERM whatever listens on `port`, but only if it is the pane's own
  // shell or a descendant of it — the client sends an id+port, never a pid, so this can't kill arbitrary processes.
  api.post('/api/stop-port', apiGuard, async (req, res) => {
    const b = req.body, port = Number(b?.port);
    const s = b && typeof b.id === 'string' ? live.get(b.id) : null;
    if (!s || s.isLog || !Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).end();
    if (isWindows) return res.status(501).json({ error: 'not supported on Windows' });
    const root = s.tmuxName
      ? parseInt(await execP('tmux', ['display-message', '-p', '-t', tmuxTarget(s.tmuxName, true), '#{pane_pid}']), 10)   // the pty pid is only the tmux client
      : s.term?.pid;
    if (!root) return res.status(404).json({ error: 'shell not found' });
    const kids = new Map();                                                 // ppid → [pid]
    for (const line of (await execP('ps', ['-A', '-o', 'pid=,ppid='])).split('\n')) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (pid && ppid >= 0) kids.set(ppid, [...(kids.get(ppid) || []), pid]);
    }
    const tree = new Set([root]);
    for (const pid of tree) for (const k of kids.get(pid) || []) tree.add(k);
    const listeners = (await execP('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t'])).split('\n').map(Number).filter(Boolean);
    const targets = listeners.filter((pid) => tree.has(pid) && pid !== root && pid !== process.pid);
    if (!targets.length) return res.status(404).json({ error: 'no server found on :' + port + ' in this terminal' });
    for (const pid of targets) { try { process.kill(pid, 'SIGTERM'); } catch {} }
    res.json({ ok: true, pids: targets });
  });
  api.post('/api/agent-events', apiGuard, (req, res) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || typeof b.id !== 'string' || !AGENT_EVT_TYPES.has(b.type)) return res.status(400).end();
    const s = live.get(b.id);
    if (!s || s.isLog) return res.status(404).end();
    const now = Date.now();
    if (now - (s.evtWin || 0) > 1000) { s.evtWin = now; s.evtCount = 0; }
    if (++s.evtCount > 30) return res.status(429).end();           // 30 events/s per terminal
    // Trusted = this terminal's own hook (TD_HOOK_AUTH) or the browser. Untrusted = shells started before TD_HOOK_AUTH
    // existed (still show working / waiting / needs approval), or any other local program: display only — never held
    // for a click, never answered by a rule, never settles or supersedes a real held request.
    const trusted = hasAuthCookie(req) || tokenEq(req.get('x-td-hook-auth') || '', access.hookAuth(secret, b.id));
    if (!trusted && pendingApprovals.has(b.id)) return res.status(204).end();   // can't clear or hide a request awaiting your click
    const ev = { type: b.type, agent: cap(b.agent, 32), tool: cap(b.tool, 64), detail: cap(b.detail, 200), session: cap(b.session, 64), ts: now };
    if (Array.isArray(b.files)) ev.files = b.files.slice(0, 10).map((f) => cap(f, 300)).filter(Boolean);
    if (Number.isFinite(b.tokens)) ev.tokens = b.tokens;
    if (Number.isFinite(b.cost))   ev.cost = b.cost;
    if (Number.isFinite(b.cacheTokens)) ev.cache = b.cacheTokens;   // cache reads, shown beside tokens (#85)
    // Any event other than the request itself means the agent moved on (you answered in the terminal).
    if (trusted && b.type !== 'permission_request') settleApproval(b.id, null, 'terminal');
    // #44 phase 2: an opt-in allow-rule answers on its own — visibly (audit entry + toast), never for a deny-list command.
    const cmd = trusted && b.type === 'permission_request' && b.wait === true && typeof b.command === 'string' ? b.command.slice(0, 4000) : null;
    if (cmd !== null) {
      const full = { agent: ev.agent, tool: ev.tool, command: cmd, cwd: cap(b.cwd, 500) };
      const risk = rules.riskReason(cmd);
      const ruleSet = rulesFile.load();                              // re-read if another server changed it
      const hit = !risk && ruleSet.enabled && ruleSet.rules.find((r) => rules.matches(r, full));
      if (hit) {
        settleApproval(b.id, null, 'superseded');
        recordApproval({ ts: now, id: b.id, agent: ev.agent, tool: ev.tool, detail: ev.detail, cwd: full.cwd, decision: 'allow', source: 'rule', ruleId: hit.id });
        if (s.ws) send(s.ws, { type: 'autoallow', tool: ev.tool, detail: ev.detail, rule: hit.pattern });
        return res.json({ decision: 'allow' });
      }
      if (risk) ev.risk = risk;                                       // shown on the row: this one always needs a click
      ev.cwd = full.cwd;
    }
    // #44: a permission request from a hook that can take a decision back (b.wait) is held open until the
    // browser answers. Only with a browser attached — otherwise nobody could click, so fall through at once.
    const held = trusted && b.wait === true && b.type === 'permission_request' && !!s.ws;
    if (held) {
      settleApproval(b.id, null, 'superseded');
      ev.reqId = crypto.randomUUID();
      if (cmd !== null) {   // what a later "Always allow" is derived from: only a command you were actually shown
        for (const [k, r] of recentReqs) if (now - r.ts > RECENT_REQ_MS) recentReqs.delete(k);
        if (recentReqs.size >= 50) recentReqs.delete(recentReqs.keys().next().value);
        recentReqs.set(ev.reqId, { agent: ev.agent, tool: ev.tool, command: cmd, cwd: ev.cwd, ts: now });
      }
      const p = { reqId: ev.reqId, res, ev, timer: setTimeout(() => settleApproval(b.id, null, 'timeout'), APPROVAL_HOLD_MS) };
      pendingApprovals.set(b.id, p);
      res.on('close', () => { if (pendingApprovals.get(b.id) === p) settleApproval(b.id, null, 'terminal'); });   // helper gone: the CLI was answered or died
    }
    s.agentEvt = ev;                                                // replayed to a reattaching browser
    notify(b.id, ev, { project: path.basename(s.cwd || '') || 'termdeck', link: `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}/#t=${encodeURIComponent(b.id)}` });
    if (s.ws) send(s.ws, { type: 'agent', event: ev });
    if (!held) res.status(204).end();
  });
  api.get('/api/approvals', apiGuard, (req, res) => res.json(approvalAudit.slice(-50).reverse()));

  api.get('/api/approval-rules', apiGuard, (req, res) => res.json(rulesFile.load()));
  api.post('/api/approval-rules', apiGuard, async (req, res) => {
    const { reqId, mode } = req.body || {};
    const r = recentReqs.get(reqId);
    if (!r || Date.now() - r.ts > RECENT_REQ_MS) return res.status(400).json({ error: 'that request has expired — answer one first' });
    if (r.tool !== 'Bash' || !r.command) return res.status(400).json({ error: 'only shell commands can get a rule' });
    const risk = rules.riskReason(r.command);
    if (risk) return res.status(400).json({ error: 'matches the deny-list (' + risk + ') — always needs a click' });
    const pattern = mode === 'prefix' ? rules.prefixOf(r.command) : mode === 'exact' ? rules.norm(r.command) : null;
    if (!pattern || rules.riskReason(pattern)) return res.status(400).json({ error: 'no safe pattern for that command' });
    if (!r.cwd || !path.isAbsolute(r.cwd)) return res.status(400).json({ error: 'the agent did not report a working directory' });
    let dir = r.cwd;                                        // scope = the repo / worktree root, so a `cd` into a subfolder still matches
    try { dir = (await gitP(['rev-parse', '--show-toplevel'], r.cwd)).trim() || dir; } catch {}
    const rule = updateRules((store) => {
      let found = store.rules.find((x) => x.agent === r.agent && x.mode === mode && x.pattern === pattern && x.dir === dir);
      if (!found) {
        if (store.rules.length >= MAX_RULES) return null;
        found = { id: crypto.randomUUID(), agent: r.agent, tool: 'Bash', mode, pattern, dir, created: Date.now() };
        store.rules.push(found);
      }
      store.enabled = true;
      return found;
    });
    if (rule === null) return res.status(400).json({ error: 'rule limit reached (' + MAX_RULES + ')' });
    if (!rule) return res.status(500).json({ error: 'could not save the rule file' });
    res.json(rule);
  });
  api.delete('/api/approval-rules/:id', apiGuard, (req, res) => {
    updateRules((store) => { const i = store.rules.findIndex((x) => x.id === req.params.id); return i < 0 ? null : store.rules.splice(i, 1); });
    res.status(204).end();
  });
  api.post('/api/approval-rules/enabled', apiGuard, (req, res) => {   // pause / resume without losing the rules
    updateRules((store) => { store.enabled = req.body?.enabled === true; return true; });
    res.json(rulesFile.load());
  });
  return { router: api, approvals: { pending: pendingApprovals, settle: settleApproval } };
};
