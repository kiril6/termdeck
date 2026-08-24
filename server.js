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

const express = require('express');
const { spawn, execFile } = require('child_process');
const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const url     = require('url');
const { WebSocketServer } = require('ws');

// ── Load node-pty — try both the standard and the Linux prebuilt fork ────────
let pty;
const ptyAttempts = ['node-pty', '@homebridge/node-pty-prebuilt-multiarch'];
for (const pkg of ptyAttempts) {
  try { pty = require(pkg); break; } catch {}
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
// Serve ONLY the app dir — never express.static(__dirname), which would expose
// server.js, package.json, and repo docs at /server.js etc. (info disclosure,
// esp. when HOST=0.0.0.0). The '/' route below still serves a root-level index.html.
app.use(express.static(path.join(__dirname, 'public')));
// xterm.js + addons served locally from node_modules so the app works fully offline
// (no CDN). Scoped to just these packages — never expose all of node_modules.
for (const p of ['xterm', 'xterm-addon-fit', 'xterm-addon-search',
                 'xterm-addon-web-links', 'xterm-addon-webgl', 'xterm-addon-serialize'])
  app.use('/vendor/' + p, express.static(path.join(__dirname, 'node_modules', p)));
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

// ── WebSocket / pty server ───────────────────────────────────────────────────
// SECURITY: this WS spawns real shells. Unauthenticated + open would be RCE for any
// web page (CSRF / DNS-rebind). Defense: bind loopback by default, and validate both
// the Origin (blocks cross-site drive-by) and the Host header (blocks DNS-rebind,
// where an attacker page resolves its own domain to 127.0.0.1). See listen() + verifyClient.
const HOST = process.env.HOST || '127.0.0.1';   // set HOST=0.0.0.0 (or a LAN IP) to expose deliberately
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', HOST.toLowerCase()]);
function hostnameOf(v) {                          // pull hostname from an Origin URL or a Host header
  if (!v) return null;
  try { return new URL(v.includes('://') ? v : 'http://' + v).hostname.toLowerCase(); }
  catch { return null; }
}
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, verifyClient: ({ req }) => {
  const host   = hostnameOf(req.headers.host);       // always present (HTTP/1.1); rebind sets this to attacker domain
  const origin = hostnameOf(req.headers.origin);     // browsers always send it on WS; non-browser clients omit it
  if (host && !ALLOWED_HOSTS.has(host)) return false;     // DNS-rebind guard
  if (origin && !ALLOWED_HOSTS.has(origin)) return false; // cross-site CSRF guard
  return true;
}});

const isWindows = os.platform() === 'win32';
const HOME      = process.env.HOME || process.env.USERPROFILE || os.homedir();
const GRACE_MS  = 60_000;
const BUFFER    = 1_000_000;   // per-session replay ring: last ~1MB of output redelivered on reattach

// ── Durable sessions via tmux ────────────────────────────────────────────────
// A raw PTY dies with this node process (server restart / crash → every shell
// gone). Delegating the PTY to tmux makes the shell outlive the server: we spawn
// `tmux new-session -A` (attach-or-create), so a reconnect after restart reattaches
// the still-living session. This is how ttyd/wetty/gotty do persistence too.
// Off automatically where tmux is missing (incl. Windows) or when NO_TMUX=1 —
// falls back to the raw-shell spawn below. Ceiling: nothing survives a REBOOT
// (process memory is gone); tmux only survives the server dying, not the OS.
const { execFileSync } = require('child_process');
const TMUX_OK = !isWindows && !process.env.NO_TMUX && (() => {
  try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
function tmuxSessionName(id) { return 'td_' + String(id).replace(/[^A-Za-z0-9_]/g, '').slice(0, 60); }

function shellCandidates() {
  return [
    process.env.SHELL,
    isWindows ? 'powershell.exe' : null,
    '/bin/zsh', '/bin/bash', '/bin/sh',
  ].filter((s, i, a) => s && a.indexOf(s) === i);
}

/** id -> { term, buffer, ws, killTimer, cwd, shellName, isLog } */
const live = new Map();

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
    try { existing.term.resize(cols, rows); } catch {}
    bindWsEvents(ws, id);
    return;
  }

  // ── new shell ──
  let cwd = q.cwd ? String(q.cwd) : HOME;
  if (!safeDir(cwd)) cwd = HOME;
  const cmd = q.cmd ? String(q.cmd) : null;   // optional command to run once, on a freshly-created shell (e.g. `ssh host`, `npm run dev`)

  let term, usedShell, tmuxName = null, runCmd = false;
  const errors = [];

  // Durable path: hand the PTY to tmux (attach-or-create) so it survives restarts.
  if (TMUX_OK) {
    const name = tmuxSessionName(id);
    const env  = { ...process.env }; delete env.TMUX;   // avoid nested-session warning if server runs inside tmux
    // Whether the session already exists decides if `cmd` should run: only on a fresh create,
    // never on a reattach (else the startup command re-fires every server restart).
    let existed = false;
    try { execFileSync('tmux', ['has-session', '-t', name], { stdio:'ignore' }); existed = true; } catch {}
    try {
      term = pty.spawn('tmux', ['new-session', '-A', '-D', '-s', name, '-c', cwd],
                       { name:'xterm-256color', cols, rows, cwd, env });
      usedShell = process.env.SHELL || 'sh';            // tmux runs the login shell inside; badge shows it
      tmuxName  = name;
      runCmd    = !!cmd && !existed;
    } catch (e) {
      errors.push('tmux: ' + e.message);
      console.error('  [tmux spawn fail]', e.message, '→ falling back to raw shell');
    }
  }

  // Fallback: raw shell (Windows, no tmux, or tmux spawn failed). Always a fresh shell here
  // (reattach within grace uses the `existing` branch above), so a cmd always runs.
  if (!term) for (const sh of shellCandidates()) {
    runCmd = !!cmd;
    try {
      term = pty.spawn(sh, [], { name:'xterm-256color', cols, rows, cwd, env:process.env });
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
    if      (m.type === 'input'  && !s.isLog) s.term.write(m.data);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, HOST, () => {
  const ptyPkg = (() => { for (const p of ptyAttempts) { try { return p+'@'+require(p+'/package.json').version; } catch {} } return '?'; })();
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
  console.log(`\n  Terminal Dashboard → http://localhost:${PORT}`);
  console.log(`  Debug             → http://localhost:${PORT}/debug`);
  console.log(`  ${os.platform()} ${os.arch()}  |  Node ${process.version}  |  ${ptyPkg}`);
  console.log(`  Durable sessions  → ${TMUX_OK ? 'tmux (shells survive server restart)' : 'off — raw shells (install tmux, or NO_TMUX unset, to enable)'}`);
  if (!loopback) console.log(`\n  \x1b[33m⚠ Bound to ${HOST} — shells reachable from the network. Only do this on a trusted LAN.\x1b[0m`);
  console.log('');
  openBrowser(`http://localhost:${PORT}`);
});

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
