#!/usr/bin/env node
/**
 * TermDeck — backend
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
const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { WebSocketServer } = require('ws');
const { createSecurity } = require('./scripts/http-security');
const { createSessions, maybePromptTmux, shellCandidates } = require('./scripts/sessions');
const agentApi   = require('./scripts/agent-api');
const fsApi      = require('./scripts/fs-api');
const layoutsApi = require('./scripts/layouts-api');
const { gitApi } = require('./scripts/git-api');

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
const HOST = process.env.HOST || '127.0.0.1';   // set HOST=0.0.0.0 (or a LAN IP) to expose deliberately
const HOME      = process.env.HOME || process.env.USERPROFILE || os.homedir();
// Opt-in audit trail (shell output and approval decisions) — see sessions.js and agent-api.js.
const LOG_DIR = process.env.TD_LOG_DIR ? path.resolve(process.env.TD_LOG_DIR) : null;
function expandDir(d) {                              // "" / "~" / "~/x" → absolute path
  let p = d ? String(d) : HOME;
  if (p === '~' || p.startsWith('~/')) p = path.join(HOME, p.slice(1));
  return path.resolve(p);
}
function safeDir(p)     { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

const app = express();
// Headers, the localhost → 127.0.0.1 redirect and the sign-in gate, before anything is served.
const security = createSecurity({ host: HOST, publicDir: path.join(__dirname, 'public') });
const { LOOPBACK, LOCAL_ONLY, EXTRA_HOSTS, TOKEN, apiGuard } = security;
app.use(...security.middleware);
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
for (const p of ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search', '@xterm/addon-web-links',
                 '@xterm/addon-webgl', '@xterm/addon-serialize', '@xterm/addon-unicode11']) {
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
app.get('/debug', apiGuard, (_req, res) => {
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

  res.send(`<!DOCTYPE html><html><head><title>TermDeck Debug</title>
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
<h1>▚ TermDeck — Debug</h1>
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


// ── /api — version, update check, changelog; the route groups live in scripts/*-api.js ──
const APP_VERSION = require('./package.json').version;  // single source of truth
app.get('/api/version', (_req, res) => res.json({ version: APP_VERSION }));
const checkUpdate = require('./scripts/update-check').createChecker(APP_VERSION, process.env.TD_UPDATE_URL || undefined);
app.get('/api/update-check', apiGuard, (_req, res) =>             // click-initiated only; the server (not the browser) asks npm
  checkUpdate().then((r) => res.json(r), () => res.status(502).json({ error: 'registry unreachable' })));
app.get('/api/changelog', (_req, res) => res.type('text/plain').sendFile(path.join(__dirname, 'CHANGELOG.md'), (e) => { if (e && !res.headersSent) res.status(404).end(); }));

/** id -> { term, buffer, ws, killTimer, cwd, shellName, isLog, tmuxName } — the terminals, shared by sessions and the agent routes */
const live = new Map();
const agent = agentApi({ apiGuard, hasAuthCookie: security.hasAuthCookie, secret: security.SECRET, live, logDir: LOG_DIR });
app.use(fsApi({ apiGuard, expandDir, safeDir }));
app.use(layoutsApi({ apiGuard }));
app.use(agent.router);
app.use(gitApi({ apiGuard, expandDir, safeDir }));

// Last stop for a route that throws: log it, answer a plain JSON 500 — never Express's default page, which shows the
// stack trace and server paths. (Malformed JSON bodies land here too, as 400.)
app.use((err, _req, res, _next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error('  [http] route failed:', err.stack || err.message);
  if (!res.headersSent) res.status(status).json({ error: status === 500 ? 'internal error' : 'bad request' });
});
// Express 4 doesn't catch a rejected async route: log it instead of letting Node end the process (and every raw
// shell with it). The request may go unanswered; the PTYs are untouched by a route's failure.
process.on('unhandledRejection', (e) => console.error('  [error] unhandled rejection:', e && e.stack || e));

// ── WebSocket / pty server ───────────────────────────────────────────────────
// The WS spawns real shells: verifyClient checks Host, Origin and the sign-in cookie (http-security.js).
const server = http.createServer(app);
// maxPayload: ws defaults to 100 MB per message; 16 MB still fits a very large native paste (one message).
const wss    = new WebSocketServer({ server, maxPayload: 16 * 1024 * 1024, verifyClient: security.verifyClient });
const sessions = createSessions({ pty, live, approvals: agent.approvals, secret: security.SECRET, home: HOME, logDir: LOG_DIR, safeDir });
wss.on('connection', sessions.handleConnection);

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
// A pinned port (autostart always pins one) may still be held by the server we are replacing: a shutdown with many
// tmux sessions takes over a second. Wait for it instead of exiting at once (launchd / systemd would throttle restarts).
const PORT_WAIT_MS = 5000, PORT_WAIT_STEP = 250;
let portWaited = 0;
function listenOn(port, triesLeft) {
  let settled = false;
  // EADDRINUSE surfaces on the WebSocketServer (ws forwards the http server's error to
  // itself), so listen on BOTH server and wss; `settled` keeps the first one authoritative.
  const cleanup = () => { server.removeListener('error', onError); wss.removeListener('error', onError); server.removeListener('listening', onListening); };
  const onError = (e) => {
    if (settled) return; settled = true; cleanup();
    if (e.code === 'EADDRINUSE') {
      if (!portPinned && triesLeft > 0) { console.error(`  \x1b[2mPort ${port} in use — trying ${port + 1}…\x1b[0m`); return listenOn(port + 1, triesLeft - 1); }
      if (portPinned && portWaited < PORT_WAIT_MS) { portWaited += PORT_WAIT_STEP; return setTimeout(() => listenOn(port, triesLeft), PORT_WAIT_STEP); }
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
    sessions.setAgentUrl(base);
    // Shells kept alive by tmux across a restart still hold the OLD TD_URL; td-hook.js falls back to this file (#47).
    // No token in it: hooks authenticate with TD_HOOK_AUTH, which stays valid across restarts.
    try {
      const dir = path.join(os.homedir(), '.termdeck'), f = path.join(dir, 'server.json');
      // Another live server on this home (easy with the port fallback): both work, but it is usually one left running.
      let prev; try { prev = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      if (prev?.pid && prev.pid !== process.pid && pidAlive(prev.pid)) {
        console.error(`  \x1b[33m⚠ Another termdeck server is running on this account (pid ${prev.pid}, ${prev.url}).\x1b[0m\n    Both work and share ~/.termdeck; stop the one you don't use.`);
      }
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(f, JSON.stringify({ url: base, pid: process.pid, local: LOCAL_ONLY }), { mode: 0o600 });
      fs.chmodSync(f, 0o600);
      process.on('exit', () => { try { if (JSON.parse(fs.readFileSync(f, 'utf8')).pid === process.pid) fs.unlinkSync(f); } catch {} });
    } catch {}   // best effort: without it only the restart-on-another-port case degrades
    const open = `${base}/?t=${TOKEN}`;   // tokenized URL: first visit sets the auth cookie
    // Not a terminal (launchd / systemd log): keep the local secret out of the log; `termdeck open` prints the link.
    console.log(`\n  TermDeck → ${LOCAL_ONLY && !process.stdout.isTTY ? base + '   (sign-in link: termdeck open)' : open}`);
    console.log(`  Debug             → ${base}/debug`);
    console.log(`  ${os.platform()} ${os.arch()}  |  Node ${process.version}  |  ${ptyPkg}`);
    console.log(`  Durable sessions  → ${sessions.tmuxOk() ? 'tmux (shells survive server restart)' : 'off — raw shells (install tmux, or NO_TMUX unset, to enable)'}`);
    if (actual !== START_PORT) console.log(`  \x1b[2m(port ${START_PORT} was busy)\x1b[0m`);
    if (EXTRA_HOSTS.size) console.log(`  Extra allowed hosts → ${[...EXTRA_HOSTS].join(', ')}  (token required)`);
    if (!LOOPBACK) console.log(`\n  \x1b[33m⚠ Bound to ${HOST} — shells reachable from the network, gated by the token in the URL above. Keep it secret.\n    Safer: keep the loopback bind and use a tunnel / tailscale serve — see docs/remote-access.md\x1b[0m`);
    console.log('');
    if (!process.env.NO_OPEN) openBrowser(open);
  };
  server.once('error', onError);
  wss.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
maybePromptTmux().finally(() => listenOn(START_PORT, portPinned ? 0 : MAX_PORT_TRIES));

// Open the dashboard on start (NO_OPEN=1 skips it). BROWSER=<name|path> picks the browser.
const { openBrowser } = require('./scripts/open-browser');
