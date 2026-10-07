#!/usr/bin/env node
// `termdeck doctor` (#59): offline self-check. Never starts the server, never touches the network.
// Exit 0 = every check passed (info lines don't count), 1 = at least one warning or failure.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (c, s) => tty ? `\x1b[${c}m${s}\x1b[0m` : s;
const MARK = { pass: paint(32, '✓'), warn: paint(33, '!'), fail: paint(31, '✗'), info: paint(2, '·') };
const rows = [];
const add = (level, name, detail, fix) => rows.push({ level, name, detail, fix });
const run = (cmd, args) => { try { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
const verOf = (s) => { const m = /(\d+)\.(\d+)/.exec(s || ''); return m ? [+m[1], +m[2]] : null; };

async function portFree(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

(async () => {
  // Node
  const need = require('../package.json').engines.node;           // ">=18"
  const min = +/(\d+)/.exec(need)[1];
  if (+process.versions.node.split('.')[0] >= min) add('pass', 'Node', `${process.version} (${need})`);
  else add('fail', 'Node', `${process.version}, need ${need}`, 'install a newer Node (https://nodejs.org)');
  add('info', 'Platform', `${os.platform()} ${os.arch()}`);

  // node-pty
  let pty, ptyDir, ptyName;
  for (const pkg of ['node-pty', '@homebridge/node-pty-prebuilt-multiarch']) {
    try { pty = require(path.join(__dirname, '..', 'node_modules', pkg)); } catch { try { pty = require(pkg); } catch { continue; } }
    ptyName = pkg; ptyDir = path.dirname(require.resolve(pkg + '/package.json')); break;
  }
  if (pty) add('pass', 'node-pty', `${ptyName}@${require(ptyName + '/package.json').version}`);
  else add('fail', 'node-pty', 'could not be loaded', 'run: node install.js');

  if (pty && process.platform === 'darwin') {   // npx/global installs skip install.js, so the bit is missing; server.js re-applies it on start — do the same so the shell check below is honest
    const helper = path.join(ptyDir, 'prebuilds', `darwin-${os.arch() === 'arm64' ? 'arm64' : 'x64'}`, 'spawn-helper');
    try { fs.accessSync(helper, fs.constants.X_OK); add('pass', 'spawn-helper', 'executable'); }
    catch {
      if (!fs.existsSync(helper)) add('info', 'spawn-helper', 'prebuild not present for this arch');
      else try { fs.chmodSync(helper, 0o755); add('pass', 'spawn-helper', 'was not executable — fixed (termdeck does this on every start too)'); }
      catch (e) { add('fail', 'spawn-helper', `not executable and could not be fixed (${e.code})`, `run: chmod +x "${helper}"`); }
    }
  }

  // A shell actually spawns
  if (pty) {
    const isWin = os.platform() === 'win32';
    const cands = [process.env.SHELL, isWin ? 'powershell.exe' : null, '/bin/zsh', '/bin/bash', '/bin/sh']
      .filter((s, i, a) => s && a.indexOf(s) === i);
    let ok = null;
    for (const sh of cands) {
      try { const t = pty.spawn(sh, [], { name: 'xterm', cols: 40, rows: 10, cwd: os.homedir(), env: process.env }); t.kill(); ok = sh; break; } catch {}
    }
    if (ok) add('pass', 'Shell', `${ok} spawns`);
    else add('fail', 'Shell', `none of ${cands.join(', ')} could be spawned`, 'run: node install.js, then open /debug when the server runs');
  }

  // tmux (durable sessions) — >= 3.2 also needed for agent-hook env
  if (os.platform() === 'win32') add('info', 'tmux', 'not available on Windows (shells do not outlive the server)');
  else if (process.env.NO_TMUX) add('info', 'tmux', 'disabled by NO_TMUX');
  else {
    const out = run('tmux', ['-V']);
    const v = verOf(out);
    if (!out) add('warn', 'tmux', 'not found — shells will not survive a server restart', 'install tmux (brew/apt/dnf install tmux)');
    else if (v && (v[0] > 3 || (v[0] === 3 && v[1] >= 2))) add('pass', 'tmux', out);
    else add('warn', 'tmux', `${out} — agent hooks need >= 3.2 inside tmux sessions`, 'upgrade tmux');
  }

  // git (agent worktrees, diff review)
  const git = run('git', ['--version']);
  if (git) add('pass', 'git', git);
  else add('warn', 'git', 'not found — New agent task and Review changes need it', 'install git');

  // Port
  const host = process.env.HOST || '127.0.0.1';
  const pinned = process.env.PORT != null && process.env.PORT !== '';
  const port = Number(process.env.PORT) || 3000;
  if (await portFree(port, host)) add('pass', 'Port', `${host}:${port} is free`);
  else if (pinned) add('fail', 'Port', `${host}:${port} is in use and PORT is pinned`, `pick another: termdeck --port ${port + 1}`);
  else add('warn', 'Port', `${host}:${port} is in use — the server will move to the next free port`);

  // Network exposure
  const loop = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const extra = String(process.env.TD_ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
  const wild = extra.filter((h) => h.includes('*'));
  if (wild.length) add('warn', 'TD_ALLOWED_HOSTS', `wildcards are ignored: ${wild.join(', ')}`, 'list exact hostnames');
  const real = extra.filter((h) => !h.includes('*'));
  if (!loop) add('warn', 'Exposure', `bound to ${host} — reachable from the network; the access token is ON`, 'prefer the loopback bind plus a tunnel (docs/remote-access.md)');
  else if (real.length) add('info', 'Exposure', `loopback bind, extra hosts: ${real.join(', ')} — the access token is ON`);
  else add('pass', 'Exposure', 'loopback only, no token needed');

  // TD_* values that silently fall back to defaults
  for (const [k, d] of [['TD_GRACE_MS', 60000], ['TD_BUFFER', '(default)'], ['TD_MAX_PANELS', 64]]) {
    const raw = process.env[k];
    if (raw === undefined) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) add('info', k, `${raw}`);
    else add('warn', k, `"${raw}" is not a positive number — the default (${d}) is used`, `fix or unset ${k}`);
  }
  if (process.env.TD_LOG_DIR) {
    const dir = process.env.TD_LOG_DIR;
    const probe = fs.existsSync(dir) ? dir : path.dirname(path.resolve(dir));
    try { fs.accessSync(probe, fs.constants.W_OK); add('pass', 'TD_LOG_DIR', `${dir} is writable`); }
    catch { add('warn', 'TD_LOG_DIR', `${dir} is not writable — session logs will not be saved`, 'fix permissions or the path'); }
  }

  if (process.env.TD_NOTIFY_URL) {   // #84: validate only, never sends anything
    try {
      const c = require('./notify').configFrom(process.env);
      add('pass', 'TD_NOTIFY_URL', `webhook on → ${c.url.origin}, events: ${[...c.events].join(',')}${c.detail ? '' : ', detail off'}`);
    } catch (e) { add('warn', 'TD_NOTIFY_URL', `${e.message} — notifications are off`, 'use a full http(s) URL, e.g. https://ntfy.sh/my-topic'); }
  }

  // Report
  const w = Math.max(...rows.map((r) => r.name.length));
  console.log(`\n  termdeck doctor — v${require('../package.json').version}\n`);
  for (const r of rows) {
    console.log(`  ${MARK[r.level]} ${r.name.padEnd(w)}  ${r.detail}`);
    if (r.fix) console.log(`  ${' '.repeat(w + 2)}  ${paint(2, '→ ' + r.fix)}`);
  }
  const bad = rows.filter((r) => r.level === 'warn' || r.level === 'fail');
  console.log(`\n  ${bad.length ? paint(33, `${bad.length} issue${bad.length === 1 ? '' : 's'} found`) : paint(32, 'all good')}\n`);
  process.exit(bad.length ? 1 : 0);
})();
