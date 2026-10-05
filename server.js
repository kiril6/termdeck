#!/usr/bin/env node
/**
 * Terminal Dashboard — backend
 *
 * First-time setup (picks the right node-pty for your OS, no compiler needed):
 *   node install.js
 *
 * Then every time:
 *   npm start  →  http://localhost:3000
 *
 * Debug page if shells won't start:
 *   http://localhost:3000/debug
 */

require('./scripts/cli').applyArgs(process.argv.slice(2));   // --help / --version / --port / doctor (#59) — before anything boots

const express = require('express');
const { spawn, execFile } = require('child_process');
const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const url     = require('url');
const { WebSocketServer } = require('ws');

// ── Load node-pty — try both the standard and the Linux prebuilt fork ────────
let pty, ptyDir;
const ptyAttempts = ['node-pty', '@homebridge/node-pty-prebuilt-multiarch'];
for (const pkg of ptyAttempts) {
  try { pty = require(pkg); ptyDir = path.dirname(require.resolve(pkg + '/package.json')); break; } catch {}
}

// macOS unpacks node-pty prebuilds without the execute bit on spawn-helper, which
// node-pty forks to exec shells → "posix_spawnp failed". install.js fixes this, but
// installs that skip it (npx github:, npm i -g) don't — so restore +x at runtime too.
if (pty && ptyDir && process.platform === 'darwin') {
  for (const a of ['darwin-arm64', 'darwin-x64']) {
    try { fs.chmodSync(path.join(ptyDir, 'prebuilds', a, 'spawn-helper'), 0o755); } catch {}
  }
}

if (!pty) {
  console.error('\n╔══════════════════════════════════════════════════════╗');
  console.error('║  node-pty could not be loaded.                       ║');
  console.error('║                                                      ║');
  console.error('║  Run the setup script (no compiler needed):          ║');
  console.error('║    node install.js                                   ║');
  console.error('║                                                      ║');
  console.error('║  Or install manually:                                ║');
  console.error('║    macOS / Windows:                                  ║');
  console.error('║      npm install node-pty@1.1.0                     ║');
  console.error('║    Linux:                                            ║');
  console.error('║      npm install @homebridge/node-pty-prebuilt-multiarch ║');
  console.error('╚══════════════════════════════════════════════════════╝\n');
  process.exit(1);
}

// ── Express + static files ───────────────────────────────────────────────────
const app = express();
const HOST = process.env.HOST || '127.0.0.1';   // set HOST=0.0.0.0 (or a LAN IP) to expose deliberately
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
// Non-loopback bind (or extra allowed hosts = proxied remote access) = remote shell for anyone who can reach the port, so require a random
// per-start token: open /?t=<token> once → HttpOnly cookie → required on every HTTP request
// and WS upgrade. Loopback stays token-free. Restart = new token (old cookies stop working).
// Opt-in extra hostnames (exact match, comma-separated) for a reverse proxy such as
// `tailscale serve` (e.g. TD_ALLOWED_HOSTS=mybox.tail1234.ts.net). No wildcards, empty by default.
const EXTRA_HOSTS = new Set(String(process.env.TD_ALLOWED_HOSTS || '').split(',')
  .map((h) => h.trim().toLowerCase()).filter((h) => {
    if (h.includes('*')) { console.error(`  TD_ALLOWED_HOSTS: ignoring "${h}" — wildcards are not allowed`); return false; }
    return !!h;
  }));
const TOKEN = LOOPBACK && !EXTRA_HOSTS.size ? null : require('crypto').randomBytes(24).toString('hex');
function tokenEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && require('crypto').timingSafeEqual(x, y);
}
function hasAuthCookie(req) {
  const m = /(?:^|;\s*)td_token=([^;]+)/.exec(req.headers.cookie || '');
  return !!m && tokenEq(m[1], TOKEN);
}
if (TOKEN) app.use((req, res, next) => {
  if (req.query.t !== undefined && tokenEq(req.query.t, TOKEN)) {
    res.setHeader('Set-Cookie', `td_token=${TOKEN}; Path=/; HttpOnly; SameSite=Strict`);
    return res.redirect(req.path);
  }
  if (hasAuthCookie(req)) return next();
  res.status(401).type('text').send('Unauthorized — open the tokenized URL printed at server startup.');
});
// Serve ONLY the app dir — never express.static(__dirname), which would expose
// server.js, package.json, and repo docs at /server.js etc. (info disclosure,
// esp. when HOST=0.0.0.0). The '/' route below still serves a root-level index.html.
app.use(express.json({ limit: '64kb' }));   // /api/git/worktree posts { dir, branch }
app.use(express.static(path.join(__dirname, 'public')));
// xterm.js + addons served locally from node_modules so the app works fully offline
// (no CDN). Scoped to just these packages — never expose all of node_modules.
// Resolve each package's real path via node resolution (not __dirname/node_modules):
// when termdeck runs as an installed dependency, npm hoists these to a parent
// node_modules, so a hardcoded __dirname/node_modules/<p> would 404. See require.resolve.
for (const p of ['xterm', 'xterm-addon-fit', 'xterm-addon-search',
                 'xterm-addon-web-links', 'xterm-addon-webgl', 'xterm-addon-serialize']) {
  try {
    app.use('/vendor/' + p, express.static(path.dirname(require.resolve(p + '/package.json'))));
  } catch { console.error('  [vendor] cannot resolve', p, '— run: node install.js'); }
}
app.get('/', (_req, res) => {
  const found = [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'public', 'index.html'),
  ].find((p) => fs.existsSync(p));
  if (found) return res.sendFile(found);
  res.status(500).send('index.html not found. It should live next to server.js or in ./public/');
});

// ── /debug — open this if terminals won't start ──────────────────────────────
app.get('/debug', (_req, res) => {
  const info = {
    node:      process.version,
    platform:  os.platform(),
    arch:      os.arch(),
    'node-pty': (() => {
      for (const p of ptyAttempts) {
        try { return p + '@' + require(p + '/package.json').version; } catch {}
      }
      return 'not found';
    })(),
    SHELL: process.env.SHELL || '(not set)',
    HOME:  process.env.HOME  || '(not set)',
  };

  const candidates = shellCandidates();
  const results = {};
  for (const sh of candidates) {
    try {
      const t = pty.spawn(sh, [], { name:'xterm', cols:40, rows:10, cwd:os.homedir(), env:process.env });
      results[sh] = '✓ OK (pid ' + t.pid + ')';
      t.kill();
    } catch (e) {
      results[sh] = '✗ ' + e.message;
    }
  }

  const allFail = Object.values(results).every((v) => v.startsWith('✗'));

  const rows = (obj) => Object.entries(obj)
    .map(([k,v]) => `<tr><td>${k}</td><td class="${v.startsWith('✓')||!v.startsWith('✗')?'ok':'fail'}">${v}</td></tr>`)
    .join('');

  res.send(`<!DOCTYPE html><html><head><title>Terminal Dashboard Debug</title>
<style>
  body{font-family:monospace;background:#0b0f14;color:#c9d4de;padding:32px;font-size:13px;line-height:1.6;}
  h1{color:#4fd6be;} h2{color:#c9d4de;font-size:13px;margin-top:28px;letter-spacing:.1em;text-transform:uppercase;}
  table{border-collapse:collapse;max-width:700px;width:100%;margin-bottom:24px;}
  td{padding:7px 14px;border-bottom:1px solid #1f2c39;}
  td:first-child{color:#66798a;width:220px;}
  .ok{color:#46d17f;} .fail{color:#e0655f;}
  .fix{background:#130e0e;border:1px solid #e0655f;border-radius:8px;padding:18px 22px;
       max-width:660px;color:#e0a94e;line-height:2;}
  code{background:#0e151d;padding:2px 7px;border-radius:4px;color:#4fd6be;}
</style></head><body>
<h1>▚ Terminal Dashboard — Debug</h1>
<h2>Environment</h2><table>${rows(info)}</table>
<h2>Shell Spawn Tests</h2><table>${rows(results)}</table>
${allFail ? `<div class="fix"><b>All shells failed to spawn.</b><br><br>
Run the setup script (installs prebuilt binaries, no compiler):<br>
<code>node install.js</code><br><br>
If that fails, install build tools first:<br>
macOS: <code>xcode-select --install</code><br>
Linux: <code>sudo apt-get install build-essential python3</code><br>
Windows: install VS Build Tools<br><br>
Then run <code>node install.js</code> again.
</div>` : '<p style="color:#46d17f">✓ At least one shell works. Reload the dashboard.</p>'}
</body></html>`);
});

// ── /api — filesystem for the sidebar tree ───────────────────────────────────
// SECURITY: these read/reveal real paths, so they carry the SAME Origin+Host guard
// as the WS. Loopback bind already blocks remote reach; this blocks a cross-site page
// from driving them. `ls` responses are also same-origin-protected by the browser.
function apiGuard(req, res, next) {
  const host   = hostnameOf(req.headers.host);
  const origin = hostnameOf(req.headers.origin);
  if (host   && !ALLOWED_HOSTS.has(host))   return res.status(403).end();
  if (origin && !ALLOWED_HOSTS.has(origin)) return res.status(403).end();
  next();
}
function expandDir(d) {                              // "" / "~" / "~/x" → absolute path
  let p = d ? String(d) : HOME;
  if (p === '~' || p.startsWith('~/')) p = path.join(HOME, p.slice(1));
  return path.resolve(p);
}
const APP_VERSION = require('./package.json').version;  // single source of truth
app.get('/api/version', (_req, res) => res.json({ version: APP_VERSION }));
app.get('/api/ls', apiGuard, (req, res) => {
  const dir = expandDir(req.query.dir);
  if (!safeDir(dir)) return res.status(404).json({ error:'not a directory', dir });
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes:true }); }
  catch (e) { return res.status(403).json({ error:e.code || 'read failed', dir }); }
  const all = req.query.all === '1';                 // ?all=1 → include dotfiles (sidebar "show hidden")
  const entries = ents
    .filter((e) => all || !e.name.startsWith('.'))   // hide dotfiles by default, like `ls`
    .map((e) => { try { return { name:e.name, dir:e.isDirectory() }; } catch { return { name:e.name, dir:false }; } })
    .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name)));
  res.json({ dir, entries });
});
app.get('/api/shells', apiGuard, (_req, res) => {      // shells the "Shell" picker may offer (the same allowlist spawn enforces)
  res.json({ shells: shellCandidates().map((p) => ({ path: p, name: baseName(p) })) });
});
app.get('/api/reveal', apiGuard, (req, res) => {     // open the OS file manager at a path
  const target = expandDir(req.query.path);
  if (!fs.existsSync(target)) return res.status(404).end();
  const isDir = safeDir(target);
  let cmd, args;
  if (isWindows)                        { cmd = 'explorer'; args = isDir ? [target] : ['/select,' + target]; }
  else if (process.platform === 'darwin'){ cmd = 'open';    args = isDir ? [target] : ['-R', target]; }
  else                                  { cmd = 'xdg-open'; args = [isDir ? target : path.dirname(target)]; }
  try { spawn(cmd, args, { stdio:'ignore', detached:true }).on('error', () => {}).unref(); } catch {}
  res.json({ ok:true });
});
const EDITOR = process.env.TD_EDITOR || 'code';     // fixed by config, never by the request; no shell → a path can't inject a command
app.get('/api/open-editor', apiGuard, (req, res) => {  // open a path in the configured editor
  const target = expandDir(req.query.path);
  if (!fs.existsSync(target)) return res.status(404).json({ error:'path not found' });
  const child = spawn(EDITOR, [target], { stdio:'ignore', detached:true });
  child.once('error', (e) => res.status(e.code === 'ENOENT' ? 404 : 500)
    .json({ error: e.code === 'ENOENT' ? `editor "${EDITOR}" not found — set TD_EDITOR` : (e.code || 'launch failed') }));
  child.once('spawn', () => { child.unref(); res.json({ ok:true }); });
});
app.get('/api/stat', apiGuard, (req, res) => {       // lightweight "is this a regular file?" for clickable output paths
  try { res.json({ file: fs.statSync(expandDir(req.query.path)).isFile() }); }
  catch { res.json({ file: false }); }
});
app.get('/api/read', apiGuard, (req, res) => {       // read a text file for the in-app viewer
  // No path jail: the app already hands out real shells (cat reads anything), so a viewer over
  // the same loopback+Origin/Host guard grants no new capability. Same trust model as /api/ls.
  const target = expandDir(req.query.path);
  let st;
  try { st = fs.statSync(target); } catch { return res.status(404).json({ error:'not found' }); }
  if (st.isDirectory()) return res.status(400).json({ error:'is a directory' });
  const MAX = 2 * 1024 * 1024;                        // 2MB cap — this is a peek, not an editor
  let fd;
  try {
    fd = fs.openSync(target, 'r');
    const len = Math.min(st.size, MAX);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    if (buf.includes(0)) return res.json({ path:target, name:baseName(target), binary:true });
    res.json({ path:target, name:baseName(target), text:buf.toString('utf8'), truncated:st.size > MAX });
  } catch (e) { res.status(403).json({ error:e.code || 'read failed' }); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
});

// ── /api/agent-events — structured agent state from CLI hooks (#40) ───────────
// Events are UNTRUSTED data: whitelisted fields, length caps, per-terminal rate limit, unknown ids
// ignored. They only ever flow to that terminal's own browser socket — nothing here writes to a PTY.
const rules = require('./scripts/approval-rules');
const AGENT_EVT_TYPES = new Set(['prompt_submit', 'tool_start', 'tool_end', 'permission_request', 'stop', 'error']);
const cap = (v, n) => typeof v === 'string' && v ? v.slice(0, n) : undefined;
app.post('/api/agent-events', apiGuard, (req, res) => {
  const b = req.body;
  if (!b || typeof b !== 'object' || typeof b.id !== 'string' || !AGENT_EVT_TYPES.has(b.type)) return res.status(400).end();
  const s = live.get(b.id);
  if (!s || s.isLog) return res.status(404).end();
  const now = Date.now();
  if (now - (s.evtWin || 0) > 1000) { s.evtWin = now; s.evtCount = 0; }
  if (++s.evtCount > 30) return res.status(429).end();           // 30 events/s per terminal
  const ev = { type: b.type, agent: cap(b.agent, 32), tool: cap(b.tool, 64), detail: cap(b.detail, 200), ts: now };
  if (Array.isArray(b.files)) ev.files = b.files.slice(0, 10).map((f) => cap(f, 300)).filter(Boolean);
  if (Number.isFinite(b.tokens)) ev.tokens = b.tokens;
  if (Number.isFinite(b.cost))   ev.cost = b.cost;
  if (Number.isFinite(b.cacheTokens)) ev.cache = b.cacheTokens;   // cache reads, shown beside tokens (#85)
  // Any event other than the request itself means the agent moved on (you answered in the terminal).
  if (b.type !== 'permission_request') settleApproval(b.id, null, 'terminal');
  // #44 phase 2: an opt-in allow-rule answers on its own — visibly (audit entry + toast), never for a deny-list command.
  const cmd = b.type === 'permission_request' && b.wait === true && typeof b.command === 'string' ? b.command.slice(0, 4000) : null;
  if (cmd !== null) {
    const full = { agent: ev.agent, tool: ev.tool, command: cmd, cwd: cap(b.cwd, 500) };
    const risk = rules.riskReason(cmd);
    const hit = !risk && ruleStore.enabled && ruleStore.rules.find((r) => rules.matches(r, full));
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
  const held = b.wait === true && b.type === 'permission_request' && !!s.ws;
  if (held) {
    settleApproval(b.id, null, 'superseded');
    ev.reqId = require('crypto').randomUUID();
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
  if (s.ws) send(s.ws, { type: 'agent', event: ev });
  if (!held) res.status(204).end();
});

// ── Approve / Deny from the queue (#44) ───────────────────────────────────────
// The hook helper's request stays open; a click arrives over that terminal's own WebSocket (same
// Origin/Host/token guards as input) and is answered with {decision}. Nothing is typed into a PTY, and
// no click means no decision: the helper prints nothing and the CLI shows its normal prompt.
const APPROVAL_HOLD_MS = Math.floor(positiveEnvNumber('TD_APPROVAL_HOLD_MS', 120000));
const pendingApprovals = new Map();   // terminal id -> { reqId, res, ev, timer }
const approvalAudit = [];             // newest last, capped; also appended to TD_LOG_DIR/approvals.jsonl when set
function recordApproval(entry) {
  approvalAudit.push(entry); if (approvalAudit.length > 200) approvalAudit.shift();
  if (LOG_DIR) try { fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 }); fs.appendFileSync(path.join(LOG_DIR, 'approvals.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 }); } catch {}
}
function settleApproval(id, decision, source) {   // decision: 'allow' | 'deny' | null (= no decision, CLI asks as usual)
  const p = pendingApprovals.get(id); if (!p) return false;
  pendingApprovals.delete(id); clearTimeout(p.timer);
  recordApproval({ ts: Date.now(), id, agent: p.ev.agent, tool: p.ev.tool, detail: p.ev.detail, files: p.ev.files, cwd: p.ev.cwd, decision, source });
  if (!p.res.writableEnded) { if (decision) p.res.json({ decision }); else p.res.status(204).end(); }
  const s = live.get(id); if (s?.ws) send(s.ws, { type: 'approval', reqId: p.reqId, done: true, decision, source });
  return true;
}
app.get('/api/approvals', apiGuard, (req, res) => res.json(approvalAudit.slice(-50).reverse()));

// ── Opt-in allow-rules (#44 phase 2) ──────────────────────────────────────────
// OFF by default and none shipped. A rule is derived server-side from a command you were just shown
// (reqId), so the client never supplies a pattern, never a regex; matching + the deny-list live in
// scripts/approval-rules.js (pinned by scripts/check-rules.js). Stored 0600 in ~/.termdeck. Every firing is
// an audit entry (source 'rule') and a toast. Same trust as terminal input: a local process that can already
// drive termdeck could also create a rule — keep the loopback bind / token.
const RULES_FILE = path.join(os.homedir(), '.termdeck', 'approval-rules.json');
const RECENT_REQ_MS = 10 * 60 * 1000, MAX_RULES = 100;
const recentReqs = new Map();         // reqId -> { agent, tool, command, cwd, ts }
const validRule = (r) => r && typeof r.id === 'string' && r.tool === 'Bash' && typeof r.agent === 'string' && (r.mode === 'exact' || r.mode === 'prefix')
  && typeof r.pattern === 'string' && r.pattern && typeof r.dir === 'string' && path.isAbsolute(r.dir);
let ruleStore = { enabled: false, rules: [] };
try { const j = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')); ruleStore = { enabled: j.enabled === true, rules: (Array.isArray(j.rules) ? j.rules : []).filter(validRule).slice(0, MAX_RULES) }; } catch {}
function saveRules() {
  try {
    fs.mkdirSync(path.dirname(RULES_FILE), { recursive: true, mode: 0o700 });
    const tmp = RULES_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(ruleStore, null, 2), { mode: 0o600 }); fs.renameSync(tmp, RULES_FILE);
    return true;
  } catch (e) { console.error('  [rules] save failed:', e.message); return false; }
}
app.get('/api/approval-rules', apiGuard, (req, res) => res.json(ruleStore));
app.post('/api/approval-rules', apiGuard, async (req, res) => {
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
  let rule = ruleStore.rules.find((x) => x.agent === r.agent && x.mode === mode && x.pattern === pattern && x.dir === dir);
  if (!rule) {
    if (ruleStore.rules.length >= MAX_RULES) return res.status(400).json({ error: 'rule limit reached (' + MAX_RULES + ')' });
    rule = { id: require('crypto').randomUUID(), agent: r.agent, tool: 'Bash', mode, pattern, dir, created: Date.now() };
    ruleStore.rules.push(rule);
  }
  ruleStore.enabled = true;
  if (!saveRules()) return res.status(500).json({ error: 'could not save the rule file' });
  res.json(rule);
});
app.delete('/api/approval-rules/:id', apiGuard, (req, res) => {
  const n = ruleStore.rules.length;
  ruleStore.rules = ruleStore.rules.filter((x) => x.id !== req.params.id);
  if (ruleStore.rules.length !== n) saveRules();
  res.status(204).end();
});
app.post('/api/approval-rules/enabled', apiGuard, (req, res) => {   // pause / resume without losing the rules
  ruleStore.enabled = req.body?.enabled === true; saveRules(); res.json(ruleStore);
});

// ── /api/git — worktree-per-agent + read-only diff review ────────────────────
// Same Origin+Host guard as /api/ls. Worktree creation writes to the user's repo,
// but grants no capability a shell in that repo doesn't already have (`git worktree
// add` is one typed command) — so the trust model is unchanged. Nothing here ever
// deletes except "Finish task" (#83): explicit opt-in cleanup of a termdeck-made worktree, never --force,
// never `branch -D`, never reset. Review is read-only.
const GIT_BRANCH_RE = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,99}$/;   // no leading '-', no spaces/globs
function gitP(args, cwd) {                                       // execFile (no shell) → args can't inject
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr: String(stderr || '') })) : resolve(String(stdout)));
  });
}
const GIT_MISSING = 'git is not installed';
const gitFail = (e) => e.code === 'ENOENT' ? GIT_MISSING
  : (e.stderr || e.message || 'git failed').trim().split('\n')[0];

app.get('/api/git/root', apiGuard, async (req, res) => {         // is this dir a repo? → toplevel
  const dir = expandDir(req.query.dir);
  if (!safeDir(dir)) return res.status(404).json({ error: 'not a directory' });
  try {
    const root = (await gitP(['rev-parse', '--show-toplevel'], dir)).trim();
    const branch = (await gitP(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim();
    res.json({ root, branch });
  } catch (e) { res.status(404).json({ error: e.code === 'ENOENT' ? GIT_MISSING : 'not a git repository' }); }
});

// POST: creates a sibling worktree `<main-repo>-worktrees/<branch>` off the given dir's current HEAD,
// so each agent gets an isolated checkout instead of three agents racing on one tree.
app.post('/api/git/worktree', apiGuard, async (req, res) => {
  const dir    = expandDir(req.body?.dir);
  const branch = String(req.body?.branch || '').trim();
  if (!safeDir(dir))              return res.status(400).json({ error: 'not a directory' });
  if (!GIT_BRANCH_RE.test(branch))return res.status(400).json({ error: 'invalid branch name' });
  try {
    const top    = (await gitP(['rev-parse', '--show-toplevel'], dir)).trim();
    const base   = (await gitP(['rev-parse', 'HEAD'], top)).trim();
    const bb     = (await gitP(['rev-parse', '--abbrev-ref', 'HEAD'], top)).trim();
    const baseBranch = bb === 'HEAD' ? '' : bb;                  // '' = detached; "Finish task" then falls back to the main tree's branch
    // First `worktree list` entry is always the MAIN tree, so tasks started from inside an
    // agent worktree still land in <main>-worktrees/ instead of nesting (#39).
    const root   = (await gitP(['worktree', 'list', '--porcelain'], top)).split('\n')
                     .find((l) => l.startsWith('worktree '))?.slice(9).trim() || top;
    const wtHome = path.join(path.dirname(root), path.basename(root) + '-worktrees');
    const wtPath = path.join(wtHome, branch.replace(/\//g, '-'));
    if (fs.existsSync(wtPath))    return res.status(409).json({ error: 'worktree path already exists', path: wtPath });
    fs.mkdirSync(wtHome, { recursive: true });
    await gitP(['worktree', 'add', '-b', branch, wtPath, base], root);
    res.json({ path: wtPath, branch, base, baseBranch, root });
  } catch (e) { res.status(400).json({ error: gitFail(e) }); }
});

// Read-only: what has the agent changed since the worktree was cut? Diffs the working
// tree against the base commit, so it covers both committed and uncommitted work.
app.get('/api/git/diff', apiGuard, async (req, res) => {
  const dir  = expandDir(req.query.dir);
  const base = String(req.query.base || 'HEAD').trim();
  if (!safeDir(dir)) return res.status(404).json({ error: 'not a directory' });
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(base)) return res.status(400).json({ error: 'invalid base' });
  try {
    const [names, diff, untracked] = await Promise.all([
      gitP(['diff', '--name-status', base], dir),
      gitP(['diff', base], dir),
      gitP(['ls-files', '--others', '--exclude-standard'], dir),
    ]);
    const files = names.trim() ? names.trim().split('\n').map((l) => {
      const [status, ...rest] = l.split('\t');
      return { status: status[0], path: rest.join('\t') };
    }) : [];
    const newFiles = untracked.trim() ? untracked.trim().split('\n') : [];
    newFiles.forEach((p) => files.push({ status: '?', path: p }));
    res.json({ dir, base, files, diff, untracked: newFiles });
  } catch (e) { res.status(400).json({ error: gitFail(e) }); }
});

// Finish task (#83): land an agent worktree — merge locally or open a PR — then optionally remove it.
// GET previews (read-only) and computes what is allowed + why not; POST re-runs the SAME preview and only
// acts if the chosen action is allowed. Cleanup is the one delete in /api/git: `git worktree remove` and
// `git branch -d` WITHOUT force (git itself refuses dirty trees / unmerged branches), only for a worktree that
// is listed by `git worktree list` AND sits directly inside <main>-worktrees/. No shell: execFile + arg arrays.
const run = (cmd, args, cwd, timeout = 120000) => new Promise((resolve) => {
  execFile(cmd, args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});
const lines = (s) => s.split('\n').map((l) => l.trimEnd()).filter(Boolean);
async function finishPreview(dir, baseBranch) {
  const top = (await gitP(['rev-parse', '--show-toplevel'], dir)).trim();
  const main = (await gitP(['worktree', 'list', '--porcelain'], top)).split('\n')
                 .find((l) => l.startsWith('worktree '))?.slice(9).trim();
  const real = (p) => fs.realpathSync(p);
  if (!main || real(main) === real(top)) throw new Error('this is the main working tree, not an agent worktree');
  if (path.dirname(real(top)) !== real(path.join(path.dirname(main), path.basename(main) + '-worktrees')))
    throw new Error('not a worktree created by termdeck');
  const branch = (await gitP(['rev-parse', '--abbrev-ref', 'HEAD'], top)).trim();
  if (!GIT_BRANCH_RE.test(branch)) throw new Error('worktree is on a detached HEAD');
  const mainBranch = (await gitP(['rev-parse', '--abbrev-ref', 'HEAD'], main)).trim();
  const target = baseBranch || mainBranch;
  if (!GIT_BRANCH_RE.test(target)) throw new Error('base branch is unknown (main tree is on a detached HEAD)');
  await gitP(['rev-parse', '--verify', 'refs/heads/' + target], main).catch(() => { throw new Error('base branch “' + target + '” no longer exists'); });
  const [dirty, mainDirty, ahead, origin] = await Promise.all([
    gitP(['status', '--porcelain'], top).then(lines),
    gitP(['status', '--porcelain', '--untracked-files=no'], main).then(lines),
    gitP(['rev-list', '--count', target + '..' + branch], main).then((s) => +s.trim()),
    gitP(['remote', 'get-url', 'origin'], main).then(() => true, () => false),
  ]);
  const out = { top, main, branch, target, mainBranch, ahead, dirty, merge: { ok: false }, pr: { ok: false } };
  const why = dirty.length ? 'Uncommitted changes in the worktree — commit or discard first'
            : !ahead      ? 'Nothing to land — the branch has no commits beyond ' + target : '';
  // merge: lands in the MAIN tree, so it must already be on the target branch and clean
  out.merge.reason = why
    || (mainBranch !== target ? 'The main working tree is on “' + mainBranch + '” — check out “' + target + '” there first' : '')
    || (mainDirty.length ? 'The main working tree has uncommitted changes' : '');
  if (!out.merge.reason) {                                        // dry run: exit 1 = conflicts, names listed after the tree id
    const m = await run('git', ['merge-tree', '--write-tree', '--name-only', target, branch], main);
    if (m.err && m.err.code === 1) out.merge.reason = 'Would conflict in: ' + lines(m.stdout.split('\n\n')[0]).slice(1, 6).join(', ');
    else if (m.err) out.merge.reason = 'Conflict check failed: ' + (m.stderr.trim().split('\n')[0] || 'git ≥ 2.38 required');
  }
  out.merge.ok = !out.merge.reason;
  const gh = await run('gh', ['auth', 'status'], top, 15000);
  out.pr.reason = why
    || (gh.err && gh.err.code === 'ENOENT' ? 'GitHub CLI (gh) is not installed' : gh.err ? 'gh is not signed in — run `gh auth login`' : '')
    || (!origin ? 'No “origin” remote' : '');
  out.pr.ok = !out.pr.reason;
  return out;
}
const finishing = new Set();                                      // main trees with a finish in flight (double-click guard)
app.get('/api/git/finish', apiGuard, async (req, res) => {
  const dir = expandDir(req.query.dir);
  const baseBranch = String(req.query.baseBranch || '').trim();
  if (!safeDir(dir)) return res.status(404).json({ error: 'not a directory' });
  if (baseBranch && !GIT_BRANCH_RE.test(baseBranch)) return res.status(400).json({ error: 'invalid base branch' });
  try { res.json(await finishPreview(dir, baseBranch)); }
  catch (e) { res.status(400).json({ error: gitFail(e) }); }
});
app.post('/api/git/finish', apiGuard, async (req, res) => {
  const dir = expandDir(req.body?.dir);
  const baseBranch = String(req.body?.baseBranch || '').trim();
  const action = String(req.body?.action || '');
  if (!safeDir(dir)) return res.status(400).json({ error: 'not a directory' });
  if (baseBranch && !GIT_BRANCH_RE.test(baseBranch)) return res.status(400).json({ error: 'invalid base branch' });
  if (!['merge', 'pr', 'none'].includes(action)) return res.status(400).json({ error: 'invalid action' });
  let p;
  try { p = await finishPreview(dir, baseBranch); } catch (e) { return res.status(400).json({ error: gitFail(e) }); }
  if (finishing.has(p.main)) return res.status(409).json({ error: 'another finish is already running for this repo' });
  finishing.add(p.main);
  try {
    const out = {};
    if (action === 'merge') {
      if (!p.merge.ok) return res.status(409).json({ error: p.merge.reason });
      const m = await run('git', ['merge', '--no-ff', '--no-edit', p.branch], p.main);
      if (m.err) { await run('git', ['merge', '--abort'], p.main); return res.status(409).json({ error: 'merge failed: ' + (lines(m.stderr)[0] || lines(m.stdout)[0] || 'unknown') }); }
      out.merged = true;
    } else if (action === 'pr') {
      if (!p.pr.ok) return res.status(409).json({ error: p.pr.reason });
      const push = await run('git', ['push', '-u', 'origin', p.branch], p.top);
      if (push.err) return res.status(409).json({ error: 'push failed: ' + (lines(push.stderr).pop() || 'unknown') });
      const args = ['pr', 'create', '--fill', '--head', p.branch, ...(baseBranch ? ['--base', baseBranch] : [])];
      const pr = await run('gh', args, p.top);
      if (pr.err) return res.status(409).json({ error: 'gh pr create failed: ' + (lines(pr.stderr).pop() || 'unknown') });
      out.url = lines(pr.stdout).pop();
    } else if (p.dirty.length) return res.status(409).json({ error: 'Uncommitted changes in the worktree — commit or discard first' });   // 'none' + cleanup still needs a clean tree
    if (req.body?.cleanup) {
      const rm = await run('git', ['worktree', 'remove', p.top], p.main);                // no --force: git refuses a dirty tree
      if (rm.err) out.cleanupError = lines(rm.stderr)[0] || 'git worktree remove failed';
      else {
        const br = await run('git', ['branch', '-d', p.branch], p.main);                 // -d, never -D: git refuses unmerged
        if (br.err) out.cleanupError = 'worktree removed, branch kept: ' + (lines(br.stderr)[0] || 'git branch -d failed');
        else out.cleaned = true;
      }
    }
    res.json(out);
  } finally { finishing.delete(p.main); }
});

// Conflict radar (#43): which files are changed in more than one agent worktree of the same repo? Read-only,
// informational. The client posts its agent worktrees {dir, base}; we diff each against its base (committed +
// uncommitted + untracked), intersect per repo, and for shared files compare the changed line ranges (-U0).
// Bounded: <=16 trees, <=500 files per tree, <=50 shared files, 4 git processes at a time.
const OVERLAP_TREES = 16, OVERLAP_FILES = 500, OVERLAP_SHARED = 50, BASE_RE = /^[A-Za-z0-9._/-]{1,100}$/;
async function inBatches(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
}
const hunkRanges = (diff) => [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)]   // old-side lines; a pure insertion (count 0) is the point after line a
  .map(([, a, b]) => [+a, +a + Math.max(b === undefined ? 1 : +b, 1) - 1]);
const rangesCollide = (A, B) => A.some(([a1, a2]) => B.some(([b1, b2]) => a1 <= b2 && b1 <= a2));
app.post('/api/git/overlaps', apiGuard, async (req, res) => {
  const trees = (Array.isArray(req.body?.trees) ? req.body.trees : []).slice(0, OVERLAP_TREES)
    .map((t, idx) => ({ idx, dir: expandDir(t?.dir), base: String(t?.base || 'HEAD').trim() }))
    .filter((t) => safeDir(t.dir) && BASE_RE.test(t.base));
  try {
    await inBatches(trees, 4, async (t) => {
      try {
        const common = fs.realpathSync(path.resolve(t.dir, (await gitP(['rev-parse', '--git-common-dir'], t.dir)).trim()));   // relative to t.dir; realpath = same key for all worktrees
        const [changed, untracked] = await Promise.all([
          gitP(['diff', '--name-only', t.base], t.dir), gitP(['ls-files', '--others', '--exclude-standard'], t.dir)]);
        t.common = common;
        t.untracked = new Set(untracked.split('\n').filter(Boolean));
        t.files = new Set([...changed.split('\n'), ...t.untracked].filter(Boolean).slice(0, OVERLAP_FILES));
      } catch { t.files = null; }   // not a repo / bad base / git missing: skip this tree
    });
    const byRepo = new Map();
    trees.filter((t) => t.files).forEach((t) => byRepo.set(t.common, [...(byRepo.get(t.common) || []), t]));
    const overlaps = [];
    for (const group of byRepo.values()) {
      if (group.length < 2) continue;
      const owners = new Map();
      group.forEach((t) => t.files.forEach((f) => owners.set(f, [...(owners.get(f) || []), t])));
      const shared = [...owners].filter(([, ts]) => ts.length > 1).slice(0, OVERLAP_SHARED);
      await inBatches(shared, 4, async ([file, ts]) => {
        let collide = null;                                          // null = can't tell (different bases / unreadable)
        if (new Set(ts.map((t) => t.base)).size === 1 && !ts.some((t) => t.untracked.has(file))) {
          try {
            const rs = await Promise.all(ts.map(async (t) => hunkRanges(await gitP(['diff', '-U0', t.base, '--', file], t.dir))));
            collide = rs.some((a, i) => rs.slice(i + 1).some((b) => rangesCollide(a, b)));
          } catch {}
        } else if (ts.every((t) => t.untracked.has(file))) collide = true;   // both created the same new file
        overlaps.push({ path: file, trees: ts.map((t) => t.idx), collide });
      });
    }
    res.json({ overlaps });
  } catch (e) { res.status(400).json({ error: gitFail(e) }); }
});

// ── WebSocket / pty server ───────────────────────────────────────────────────
// SECURITY: this WS spawns real shells. Unauthenticated + open would be RCE for any
// web page (CSRF / DNS-rebind). Defense: bind loopback by default, and validate both
// the Origin (blocks cross-site drive-by) and the Host header (blocks DNS-rebind,
// where an attacker page resolves its own domain to 127.0.0.1). See listen() + verifyClient.
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', HOST.toLowerCase(), ...EXTRA_HOSTS]);
function hostnameOf(v) {                          // pull hostname from an Origin URL or a Host header
  if (!v) return null;
  try { return new URL(v.includes('://') ? v : 'http://' + v).hostname.toLowerCase(); }
  catch { return null; }
}
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, verifyClient: ({ req }, done) => {
  const host   = hostnameOf(req.headers.host);       // always present (HTTP/1.1); rebind sets this to attacker domain
  const origin = hostnameOf(req.headers.origin);     // browsers always send it on WS; non-browser clients omit it
  if (host && !ALLOWED_HOSTS.has(host)) return done(false, 403);     // DNS-rebind guard
  if (origin && !ALLOWED_HOSTS.has(origin)) return done(false, 403); // cross-site CSRF guard
  if (TOKEN && !hasAuthCookie(req)) return done(false, 401);
  done(true);   // the terminal cap is enforced in the connection handler, so the client can be told WHY
}});

const isWindows = os.platform() === 'win32';
const HOME      = process.env.HOME || process.env.USERPROFILE || os.homedir();
function positiveEnvNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
const GRACE_MS  = positiveEnvNumber('TD_GRACE_MS', 60_000);
const BUFFER    = positiveEnvNumber('TD_BUFFER', 1_000_000); // per-session replay ring
// Opt-in audit trail: with TD_LOG_DIR set, each shell's buffered output (ANSI stripped, last
// TD_BUFFER bytes) is written there when the shell really ends. Browser disconnects don't count.
const LOG_DIR = process.env.TD_LOG_DIR ? path.resolve(process.env.TD_LOG_DIR) : null;
const ANSI_RE = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
function saveLog(sess, id, code) {
  if (!LOG_DIR || !sess.buffer) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file  = path.join(LOG_DIR, `${stamp}_${String(id).replace(/[^\w.-]/g, '_').slice(0, 60)}.log`);
    const head  = `# termdeck session ${id} · ${sess.shellName} · cwd ${sess.cwd} · exit ${code} · ended ${new Date().toISOString()}\n\n`;
    fs.writeFileSync(file, head + sess.buffer.replace(ANSI_RE, '').replace(/\r\n?/g, '\n'), { mode: 0o600 });
  } catch (e) { console.error('  [log] save failed:', e.message); }
}
const MAX_PANELS = Math.floor(positiveEnvNumber('TD_MAX_PANELS', 64)); // live PTY cap across all projects

// ── Durable sessions via tmux ────────────────────────────────────────────────
// A raw PTY dies with this node process (server restart / crash → every shell
// gone). Delegating the PTY to tmux makes the shell outlive the server: we spawn
// `tmux new-session -A` (attach-or-create), so a reconnect after restart reattaches
// the still-living session. This is how ttyd/wetty/gotty do persistence too.
// Off automatically where tmux is missing (incl. Windows) or when NO_TMUX=1 —
// falls back to the raw-shell spawn below. Ceiling: nothing survives a REBOOT
// (process memory is gone); tmux only survives the server dying, not the OS.
const { execFileSync } = require('child_process');
const tmuxPresent = () => { try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); return true; } catch { return false; } };
let TMUX_OK = !isWindows && !process.env.NO_TMUX && tmuxPresent();   // let: maybePromptTmux() may flip it on after an install
function tmuxSessionName(id) { return 'td_' + String(id).replace(/[^A-Za-z0-9_]/g, '').slice(0, 60); }

// ── One-time offer to install tmux for durable sessions ──────────────────────
// Only when attached to a real terminal (npx / `npm start` by hand), tmux is
// absent, and the user hasn't opted out. Never in CI/pipes, on Windows, or with
// NO_TMUX set — so it can't hang a scripted/detached run. Declining writes a
// marker so we ask at most once. Installing is the user's explicit y/N in their
// own terminal (sudo prompts land there via stdio:inherit).
const TMUX_OPTOUT = path.join(os.homedir(), '.termdeck-tmux-optout');
function ask(q) {
  return new Promise((r) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    const fin = (v) => { if (done) return; done = true; rl.close(); r(v); };
    rl.on('close', () => fin(''));            // stdin EOF → no answer → treat as decline, don't hang startup
    rl.question(q, (a) => fin(a.trim()));
  });
}
// The package-manager command for this OS, or null if we can't spot one.
function tmuxInstaller() {
  if (process.platform === 'darwin') {
    try { execFileSync('sh', ['-c', 'command -v brew'], { stdio: 'ignore' }); } catch { return null; }
    return { cmd: 'brew', args: ['install', 'tmux'], sudo: false, show: 'brew install tmux' };
  }
  for (const m of [
    { cmd: 'apt-get', args: ['install', '-y', 'tmux'],        show: 'sudo apt-get install -y tmux' },
    { cmd: 'dnf',     args: ['install', '-y', 'tmux'],        show: 'sudo dnf install -y tmux' },
    { cmd: 'pacman',  args: ['-S', '--noconfirm', 'tmux'],    show: 'sudo pacman -S tmux' },
    { cmd: 'zypper',  args: ['install', '-y', 'tmux'],        show: 'sudo zypper install -y tmux' },
    { cmd: 'apk',     args: ['add', 'tmux'],                  show: 'sudo apk add tmux' },
  ]) {
    try { execFileSync('sh', ['-c', 'command -v ' + m.cmd], { stdio: 'ignore' }); return { ...m, sudo: true }; } catch {}
  }
  return null;
}
async function maybePromptTmux() {
  if (TMUX_OK || isWindows || process.env.NO_TMUX) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;   // detached / piped / CI
  try { if (fs.existsSync(TMUX_OPTOUT)) return; } catch {}
  console.log('\n  \x1b[36mtmux is not installed.\x1b[0m termdeck can use it for durable sessions:');
  console.log('    \x1b[2mwithout tmux →\x1b[0m shells survive a browser refresh (60s grace + replay)');
  console.log('    \x1b[2mwith tmux    →\x1b[0m shells also survive the server restarting or crashing');
  const inst = tmuxInstaller();
  const optOut = () => { try { fs.writeFileSync(TMUX_OPTOUT, ''); } catch {} };
  if (!inst) {
    console.log('  Couldn\'t find a package manager — install tmux yourself, then restart. Won\'t ask again.\n');
    optOut(); return;
  }
  const ans = await ask(`  Install it now with \x1b[1m${inst.show}\x1b[0m? [y/N] `);
  if (!/^y(es)?$/i.test(ans)) {
    optOut();
    console.log(`  Skipped. Run \x1b[1m${inst.show}\x1b[0m anytime — won't ask again.\n`);
    return;
  }
  try {
    const bin  = inst.sudo ? 'sudo' : inst.cmd;
    const args = inst.sudo ? [inst.cmd, ...inst.args] : inst.args;
    execFileSync(bin, args, { stdio: 'inherit' });   // sudo/brew interact in the user's terminal
    if (tmuxPresent()) { TMUX_OK = true; console.log('  \x1b[32m✓ tmux installed — durable sessions enabled.\x1b[0m\n'); }
    else console.log('  tmux still not on PATH — continuing without it.\n');
  } catch {
    console.log(`  Install didn't complete — continuing without tmux. Run \x1b[1m${inst.show}\x1b[0m manually.\n`);
  }
}

function shellCandidates() {
  return [
    process.env.SHELL,
    isWindows ? 'powershell.exe' : null,
    '/bin/zsh', '/bin/bash', '/bin/sh',
    ...['fish', isWindows ? 'pwsh.exe' : 'pwsh'].map(onPath),   // optional extras: offered in the picker, last-resort fallbacks
  ].filter((s, i, a) => s && a.indexOf(s) === i);
}
// Absolute path of `name` on $PATH, or null. Lets fish/pwsh show up only when installed.
function onPath(name) {
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    const f = path.join(d, name);
    try { if (d && fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}

/** id -> { term, buffer, ws, killTimer, cwd, shellName, isLog } */
const live = new Map();

// ── Agent event bridge (#40) ─────────────────────────────────────────────────
// Each PTY gets TD_ID/TD_URL(/TD_TOKEN)/TD_HOOK so an agent CLI's hook, running inside that
// shell, can POST its lifecycle events back (scripts/td-hook.js). TD_URL is fixed at listen().
let AGENT_URL = '';
const AGENT_HOOK = path.join(__dirname, 'scripts', 'td-hook.js');
const agentEnv = (id, base) => ({ ...base, TD_ID: id, TD_URL: AGENT_URL, TD_HOOK: AGENT_HOOK, ...(TOKEN ? { TD_TOKEN: TOKEN } : {}) });
// tmux builds the session env from its server, not from our client, so pass it with -e (tmux >= 3.2).
const tmuxEnvFlags = (() => {
  try { const [, a, b] = /(\d+)\.(\d+)/.exec(execFileSync('tmux', ['-V']).toString()) || []; return +a > 3 || (+a === 3 && +b >= 2); }
  catch { return false; }
})();

wss.on('connection', (ws, req) => {
  const q     = url.parse(req.url, true).query;
  const id    = String(q.id || genId());
  const cols  = clampInt(q.cols, 80);
  const rows  = clampInt(q.rows, 24);
  const isLog = q.log === '1';

  // ── reattach ──
  const existing = live.get(id);
  if (existing) {
    clearTimeout(existing.killTimer);
    existing.killTimer = null;
    existing.ws = ws;
    send(ws, { type:'attach', id, shell:existing.shellName, cwd:existing.cwd, resumed:true });
    if (existing.buffer) send(ws, { type:'output', data:existing.buffer });
    if (existing.agentEvt) {   // a replayed request is only answerable while its hook is still held; settled ones lose the reqId
      const e = existing.agentEvt, held = pendingApprovals.get(id)?.reqId === e.reqId;
      send(ws, { type:'agent', event: held || !e.reqId ? e : { ...e, reqId: undefined } });
    }
    try { existing.term.resize(cols, rows); } catch {}
    bindWsEvents(ws, id);
    return;
  }

  // ── new shell ──
  // Cap only brand-new sessions (reattach returned above). A refused HTTP upgrade can't carry a reason the
  // browser can read, so accept, say why, and close — the client then stops retrying and shows the limit.
  if (live.size >= MAX_PANELS) {
    send(ws, { type:'error', code:'panel_cap_reached', limit:MAX_PANELS, current:live.size });
    return ws.close();
  }
  let cwd = q.cwd ? String(q.cwd) : HOME;
  if (!safeDir(cwd)) cwd = HOME;
  const wantShell = shellCandidates().includes(String(q.shell)) ? String(q.shell) : null;   // allowlist only — never an arbitrary executable
  const cmd = q.cmd ? String(q.cmd) : null;   // optional command to run once, on a freshly-created shell (e.g. `ssh host`, `npm run dev`)

  let term, usedShell, tmuxName = null, runCmd = false;
  const errors = [];

  // Durable path: hand the PTY to tmux (attach-or-create) so it survives restarts.
  if (TMUX_OK) {
    const name = tmuxSessionName(id);
    const env  = agentEnv(id, process.env); delete env.TMUX;   // avoid nested-session warning if server runs inside tmux
    // Whether the session already exists decides if `cmd` should run: only on a fresh create,
    // never on a reattach (else the startup command re-fires every server restart).
    let existed = false;
    try { execFileSync('tmux', ['has-session', '-t', name], { stdio:'ignore' }); existed = true; } catch {}
    try {
      term = pty.spawn('tmux', ['new-session', '-A', '-D', '-s', name, '-c', cwd,
                                   ...(tmuxEnvFlags ? ['-e', 'TD_ID=' + id, '-e', 'TD_URL=' + AGENT_URL, '-e', 'TD_HOOK=' + AGENT_HOOK, ...(TOKEN ? ['-e', 'TD_TOKEN=' + TOKEN] : [])] : []),
                                   ...(wantShell ? [wantShell] : [])],   // trailing shell-command: only used when the session is created
                       { name:'xterm-256color', cols, rows, cwd, env });
      usedShell = wantShell || process.env.SHELL || 'sh';            // tmux runs the login shell inside; badge shows it
      tmuxName  = name;
      runCmd    = !!cmd && !existed;
    } catch (e) {
      errors.push('tmux: ' + e.message);
      console.error('  [tmux spawn fail]', e.message, '→ falling back to raw shell');
    }
  }

  // Fallback: raw shell (Windows, no tmux, or tmux spawn failed). Always a fresh shell here
  // (reattach within grace uses the `existing` branch above), so a cmd always runs.
  if (!term) for (const sh of [...new Set([wantShell, ...shellCandidates()].filter(Boolean))]) {
    runCmd = !!cmd;
    try {
      term = pty.spawn(sh, [], { name:'xterm-256color', cols, rows, cwd, env:agentEnv(id, process.env) });
      usedShell = sh;
      break;
    } catch (e) {
      errors.push(sh + ': ' + e.message);
      console.error('  [spawn fail]', sh, '→', e.message);
    }
  }

  if (!term) {
    console.error('  [fatal] No shell spawned. Visit http://localhost:' + PORT + '/debug');
    send(ws, { type:'output', data:[
      '\r\n\x1b[31mCould not start a shell.\x1b[0m',
      '\x1b[33mErrors:\x1b[0m',
      ...errors.map((e)=>'  \x1b[2m'+e+'\x1b[0m'),
      '',
      '\x1b[36mRun the setup script to fix this:\x1b[0m',
      '  \x1b[1mnode install.js\x1b[0m',
      '',
      '\x1b[2mDebug page: http://localhost:' + PORT + '/debug\x1b[0m',
    ].join('\r\n')});
    send(ws, { type:'exit', code:1 });
    return;
  }

  const sess = { term, buffer:'', ws, killTimer:null, cwd, shellName:baseName(usedShell), isLog, tmuxName };
  live.set(id, sess);
  console.log('  [+]', usedShell, tmuxName ? '(tmux '+tmuxName+')' : '', 'pid='+term.pid, 'id='+id);

  term.onData((data) => {
    sess.buffer = (sess.buffer + data).slice(-BUFFER);
    if (sess.ws?.readyState === 1) send(sess.ws, { type:'output', data });
  });
  term.onExit(({ exitCode }) => {
    if (sess.ws) send(sess.ws, { type:'exit', code:exitCode });
    saveLog(sess, id, exitCode);
    clearTimeout(sess.killTimer);
    live.delete(id);
  });

  send(ws, { type:'attach', id, shell:sess.shellName, cwd, resumed:false });
  // Startup command: typed into the fresh shell after it settles, so the user sees it run and
  // the interactive shell stays afterwards (`ssh host` → back at local shell on disconnect).
  if (runCmd) setTimeout(() => { try { sess.term.write(cmd + '\r'); } catch {} }, 300);
  bindWsEvents(ws, id);
});

function bindWsEvents(ws, id) {
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    const s = live.get(id); if (!s) return;
    if      (m.type === 'input'  && !s.isLog) {
      // Typing in the terminal = you're handling the prompt there; stop holding the hook (Codex blocks on it
      // before showing its prompt). Terminal-generated replies (cursor/device reports, focus) don't count.
      if (pendingApprovals.has(id) && !/^\x1b(\[[\x30-\x3f]*[\x20-\x2f]*[cRnIOty$]|\]|P)/.test(String(m.data))) settleApproval(id, null, 'terminal');
      s.term.write(m.data);
    }
    else if (m.type === 'approve' && !s.isLog) {
      const p = pendingApprovals.get(id);
      if (p && p.reqId === m.reqId && (m.decision === 'allow' || m.decision === 'deny')) settleApproval(id, m.decision, 'click');
    }
    else if (m.type === 'resize') { try { s.term.resize(clampInt(m.cols,80), clampInt(m.rows,24)); } catch {} }
    else if (m.type === 'kill')   {
      // tmux: killing the pty only detaches the client — the session would live on and
      // reattach as a "dead" terminal. Kill the session so the shell actually ends.
      if (s.tmuxName) { try { execFile('tmux', ['kill-session', '-t', s.tmuxName], () => {}); } catch {} }
      try { s.term.kill(); } catch {}
      clearTimeout(s.killTimer); live.delete(id);
    }
  });
  ws.on('close', () => {
    const s = live.get(id); if (!s || s.ws !== ws) return;
    s.ws = null;
    s.killTimer = setTimeout(() => { try { s.term.kill(); } catch {} live.delete(id); }, GRACE_MS);
  });
}

function send(ws, obj)  { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }
function clampInt(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; }
function baseName(p)    { return String(p).split(/[\\/]/).pop(); }
function genId()        { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function safeDir(p)     { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

// ── live cwd tracking ──
// Poll each shell's real working dir from the OS and push {type:'cwd'} when it changes, so the
// window's cwd badge follows `cd` without any shell-config/OSC-7 dependency. Linux reads the
// /proc/<pid>/cwd symlink; macOS runs one batched lsof for all shells; other OSes: feature off.
const CWD_POLL_MS = 1500;
function readCwdsLinux(pids) {
  const out = new Map();
  for (const pid of pids) { try { out.set(pid, fs.readlinkSync('/proc/' + pid + '/cwd')); } catch {} }
  return Promise.resolve(out);
}
function readCwdsDarwin(pids) {
  return new Promise((resolve) => {
    const out = new Map();
    if (!pids.length) return resolve(out);
    // -a AND: only the cwd fd, only these pids; -Fpn = parseable output (p<pid> then n<path>).
    execFile('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')], { timeout: CWD_POLL_MS }, (err, stdout) => {
      if (!stdout) return resolve(out);
      let cur = null;
      for (const line of stdout.split('\n')) {
        if (line[0] === 'p') cur = parseInt(line.slice(1), 10);
        else if (line[0] === 'n' && cur != null) out.set(cur, line.slice(1));
      }
      resolve(out);
    });
  });
}
const readCwds = process.platform === 'linux'  ? readCwdsLinux
               : process.platform === 'darwin' ? readCwdsDarwin
               : null;
function pushCwd(s, cwd) {                              // keep latest so reattach's `attach` is current
  if (!s || !cwd || cwd === s.cwd) return;
  s.cwd = cwd;
  if (s.ws?.readyState === 1) send(s.ws, { type: 'cwd', cwd });
}
if (readCwds || TMUX_OK) setInterval(async () => {
  // Raw shells: OS pid → cwd. tmux sessions have the wrong pid (the tmux client), so ask tmux.
  const rawByPid = new Map();
  for (const s of live.values()) if (!s.tmuxName && s.term?.pid) rawByPid.set(s.term.pid, s);
  if (readCwds && rawByPid.size) {
    let map; try { map = await readCwds([...rawByPid.keys()]); } catch { map = new Map(); }
    for (const [pid, cwd] of map) pushCwd(rawByPid.get(pid), cwd);
  }
  for (const s of live.values()) if (s.tmuxName) {
    execFile('tmux', ['display-message', '-p', '-t', s.tmuxName, '#{pane_current_path}'],
             { timeout: CWD_POLL_MS }, (e, out) => { if (!e && out) pushCwd(s, out.trim()); });
  }
}, CWD_POLL_MS).unref();

// Graceful shutdown: kill every live PTY before exiting. Without this a dead parent
// leaves orphan shells running until the OS reparents them — they accumulate across
// `npm start` restarts. once() so a double signal (repeated Ctrl+C) can still hard-exit.
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => {
  for (const s of live.values()) { try { s.term.kill(); } catch {} }
  process.exit(0);
});

// Port: default 3000. If it's taken and PORT wasn't explicitly set, walk up to the
// next free port automatically (npx users often already have 3000 busy) — but if the
// user pinned PORT, respect it and fail loudly rather than silently moving.
const portPinned = process.env.PORT != null && process.env.PORT !== '';
const START_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_TRIES = 20;
function listenOn(port, triesLeft) {
  let settled = false;
  // EADDRINUSE surfaces on the WebSocketServer (ws forwards the http server's error to
  // itself), so listen on BOTH server and wss; `settled` keeps the first one authoritative.
  const cleanup = () => { server.removeListener('error', onError); wss.removeListener('error', onError); server.removeListener('listening', onListening); };
  const onError = (e) => {
    if (settled) return; settled = true; cleanup();
    if (e.code === 'EADDRINUSE') {
      if (!portPinned && triesLeft > 0) { console.error(`  \x1b[2mPort ${port} in use — trying ${port + 1}…\x1b[0m`); return listenOn(port + 1, triesLeft - 1); }
      const hint = portPinned ? `PORT=${port + 1} npm start` : `PORT=8080 npm start`;
      console.error(`\n  Port ${port} is in use${portPinned ? '' : ' (and no free port found)'}. Start on another: \x1b[1m${hint}\x1b[0m\n`);
      process.exit(1);
    }
    throw e;
  };
  const onListening = () => {
    if (settled) return; settled = true; cleanup();
    const actual = server.address().port;
    const ptyPkg = (() => { for (const p of ptyAttempts) { try { return p+'@'+require(p+'/package.json').version; } catch {} } return '?'; })();
    // We bind 127.0.0.1 (IPv4). Advertise/open that exact host, NOT "localhost" — on macOS
    // localhost can resolve to ::1 (IPv6) first, so a browser could hit a *different* server
    // already on IPv6 :3000 (e.g. a Vite dev server) instead of us. 127.0.0.1 is unambiguous.
    const host = LOOPBACK ? '127.0.0.1' : HOST;
    const base = `http://${host}:${actual}`;
    AGENT_URL = base;
    // Shells kept alive by tmux across a restart still hold the OLD TD_URL/TD_TOKEN; td-hook.js falls back to this file (#47).
    try {
      const dir = path.join(os.homedir(), '.termdeck'), f = path.join(dir, 'server.json');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(f, JSON.stringify({ url: base, pid: process.pid, ...(TOKEN ? { token: TOKEN } : {}) }), { mode: 0o600 });
      fs.chmodSync(f, 0o600);
      process.on('exit', () => { try { if (JSON.parse(fs.readFileSync(f, 'utf8')).pid === process.pid) fs.unlinkSync(f); } catch {} });
    } catch {}   // best effort: without it only the restart-on-another-port case degrades
    const open = TOKEN ? `${base}/?t=${TOKEN}` : base;   // tokenized URL: first visit sets the auth cookie
    console.log(`\n  Terminal Dashboard → ${open}`);
    console.log(`  Debug             → ${base}/debug`);
    console.log(`  ${os.platform()} ${os.arch()}  |  Node ${process.version}  |  ${ptyPkg}`);
    console.log(`  Durable sessions  → ${TMUX_OK ? 'tmux (shells survive server restart)' : 'off — raw shells (install tmux, or NO_TMUX unset, to enable)'}`);
    if (actual !== START_PORT) console.log(`  \x1b[2m(port ${START_PORT} was busy)\x1b[0m`);
    if (EXTRA_HOSTS.size) console.log(`  Extra allowed hosts → ${[...EXTRA_HOSTS].join(', ')}  (token required)`);
    if (!LOOPBACK) console.log(`\n  \x1b[33m⚠ Bound to ${HOST} — shells reachable from the network, gated by the token in the URL above. Keep it secret.\n    Safer: keep the loopback bind and use a tunnel / tailscale serve — see docs/remote-access.md\x1b[0m`);
    console.log('');
    openBrowser(open);
  };
  server.once('error', onError);
  wss.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}
maybePromptTmux().finally(() => listenOn(START_PORT, portPinned ? 0 : MAX_PORT_TRIES));

// Open the dashboard on start. NO_OPEN=1 skips it. BROWSER=<name|path> picks the browser
// (e.g. BROWSER="Google Chrome" on macOS, BROWSER=firefox on Linux); default = OS default.
function openBrowser(target) {
  if (process.env.NO_OPEN) return;
  const browser = process.env.BROWSER;
  let cmd, args;
  if (browser) {
    if (process.platform === 'darwin') { cmd = 'open'; args = ['-a', browser, target]; }
    else                               { cmd = browser; args = [target]; }   // Linux/Windows: run the browser binary directly
  } else if (isWindows) { cmd = 'cmd'; args = ['/c', 'start', '', target]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [target]; }
  else { cmd = 'xdg-open'; args = [target]; }
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}
