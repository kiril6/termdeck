// Shared helpers for the soak scripts: start a real termdeck on a throwaway HOME and talk to it.
// Never touches your own ~/.termdeck, shells' rc files or tmux sessions.
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

// Cumulative CPU seconds and RSS (MB) of one process, from ps (macOS and Linux).
function usage(pid) {
  const [time, rss] = execFileSync('ps', ['-o', 'time=,rss=', '-p', String(pid)]).toString().trim().split(/\s+/);
  const secs = time.replace(/^(\d+)-/, (_, d) => `${d * 24}:`).split(':').reduce((a, v) => a * 60 + Number(v), 0);
  return { cpu: secs, rssMB: Number(rss) / 1024 };
}

// tmux: true runs with durable sessions on a private socket dir, and puts a counting shim first on PATH so a
// script can see how often the server calls tmux (TMUX_LOG gets one line per call).
async function startServer({ tmux = false, env = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-soak-'));
  const port = await freePort();
  const extra = { NO_TMUX: '1' };
  let tmuxDir, tmuxLog;
  if (tmux) {
    tmuxDir = fs.mkdtempSync('/tmp/tds-');                  // short: tmux socket paths over ~104 chars fail on macOS
    tmuxLog = path.join(tmuxDir, 'calls.log');
    const real = execFileSync('sh', ['-c', 'command -v tmux']).toString().trim();
    const bin = path.join(tmuxDir, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "$1" >> '${tmuxLog}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
    Object.assign(extra, { NO_TMUX: '', TMUX: '', TMUX_TMPDIR: tmuxDir, PATH: `${bin}:${process.env.PATH}` });
  }
  const srvEnv = { ...process.env, HOME: home, SHELL: '/bin/bash', BASH_SILENCE_DEPRECATION_WARNING: '1', PORT: String(port), NO_OPEN: '1', ...extra, ...env };
  for (const [k, v] of Object.entries(srvEnv)) if (v === '') delete srvEnv[k];
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: srvEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', (d) => { err += d; });
  const url = `http://127.0.0.1:${port}`;
  let token = '';
  for (let i = 0; i < 100 && !token; i++) {
    try { token = fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim(); await fetch(url); } catch { token = ''; await sleep(100); }
  }
  if (!token) { srv.kill(); throw new Error('server did not start\n' + err); }

  const stop = () => new Promise((ok) => {
    const cleanup = () => {
      if (tmux) try { execFileSync('tmux', ['kill-server'], { env: { ...process.env, TMUX: '', TMUX_TMPDIR: tmuxDir }, stdio: 'ignore' }); } catch {}
      for (const d of [home, tmuxDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
      ok();
    };
    if (srv.exitCode !== null) return cleanup();
    srv.once('exit', cleanup); srv.kill();
  });
  process.on('exit', () => { try { srv.kill(); } catch {} });

  // One terminal socket. Resolves on `attach` with { ws, msgs, out() }.
  const open = (id, { cols = 200, rows = 50 } = {}) => new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?id=${id}&cols=${cols}&rows=${rows}`,
      { headers: { Origin: url, Cookie: `td_token=${token}` } });
    const msgs = [];
    ws.on('message', (raw) => { const m = JSON.parse(raw); msgs.push(m); if (m.type === 'attach') ok({ ws, msgs, out: () => msgs.filter((x) => x.type === 'output').map((x) => x.data).join('') }); });
    ws.on('error', fail);
  });
  const send = (ws, m) => ws.send(JSON.stringify(m));
  const tmuxCalls = () => { try { return fs.readFileSync(tmuxLog, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  return { url, port, pid: srv.pid, token, open, send, stop, usage: () => usage(srv.pid), tmuxCalls, tmuxDir };
}

module.exports = { ROOT, sleep, usage, startServer };
