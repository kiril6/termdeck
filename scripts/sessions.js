// The terminals: one WebSocket per terminal, each backed by a PTY (inside tmux when the host has it).
// Disconnect ≠ kill: a closed socket starts a grace timer, and reconnecting with the same id cancels it and
// replays the ring buffer. server.js owns the `live` map and hands it here and to the agent routes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');
const { execFile, execFileSync } = require('child_process');
const access = require('./access');

const isWindows = os.platform() === 'win32';
function positiveEnvNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
const GRACE_MS  = positiveEnvNumber('TD_GRACE_MS', 60_000);
const BUFFER    = positiveEnvNumber('TD_BUFFER', 1_000_000); // per-session replay ring
const tail      = (sess) => sess.buffer.slice(-BUFFER);            // what replay / logs see: the last BUFFER chars
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const MAX_PANELS = Math.floor(positiveEnvNumber('TD_MAX_PANELS', 64)); // live PTY cap across all projects

// ── Durable sessions via tmux ────────────────────────────────────────────────
// A raw PTY dies with this node process (server restart / crash → every shell
// gone). Delegating the PTY to tmux makes the shell outlive the server: we spawn
// `tmux new-session -A` (attach-or-create), so a reconnect after restart reattaches
// the still-living session. This is how ttyd/wetty/gotty do persistence too.
// Off automatically where tmux is missing (incl. Windows) or when NO_TMUX=1 —
// falls back to the raw-shell spawn below. Ceiling: nothing survives a REBOOT
// (process memory is gone); tmux only survives the server dying, not the OS.
const tmuxPresent = () => { try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); return true; } catch { return false; } };
let TMUX_OK = !isWindows && !process.env.NO_TMUX && tmuxPresent();   // let: maybePromptTmux() may flip it on after an install
// Ids are checked at connect (VALID_ID); dropping '-' keeps the names of shells already running under older versions.
function tmuxSessionName(id) { return 'td_' + String(id).replace(/[^A-Za-z0-9_]/g, '').slice(0, 60); }
// tmux resolves `-t name` by prefix when there is no exact match (td_ab → td_abc), so target sessions with '='.
const tmuxTarget = (name, pane) => '=' + name + (pane ? ':' : '');

// ── One-time offer to install tmux for durable sessions ──────────────────────
// Only when attached to a real terminal (npx / `npm start` by hand), tmux is
// absent, and the user hasn't opted out. Never in CI/pipes, on Windows, or with
// NO_TMUX set — so it can't hang a scripted/detached run. Declining writes a
// marker so we ask at most once. Installing is the user's explicit y/N in their
// own terminal (sudo prompts land there via stdio:inherit).
const TMUX_OPTOUT = path.join(os.homedir(), '.termdeck', 'tmux-optout');
const TMUX_OPTOUT_LEGACY = path.join(os.homedir(), '.termdeck-tmux-optout');   // before 1.26; moved on first read
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
  try {
    if (fs.existsSync(TMUX_OPTOUT_LEGACY)) { fs.mkdirSync(path.dirname(TMUX_OPTOUT), { recursive: true, mode: 0o700 }); fs.renameSync(TMUX_OPTOUT_LEGACY, TMUX_OPTOUT); }
    if (fs.existsSync(TMUX_OPTOUT)) return;
  } catch { if (fs.existsSync(TMUX_OPTOUT_LEGACY)) return; }   // can't move it: still honour it
  console.log('\n  \x1b[36mtmux is not installed.\x1b[0m termdeck can use it for durable sessions:');
  console.log('    \x1b[2mwithout tmux →\x1b[0m shells survive a browser refresh (60s grace + replay)');
  console.log('    \x1b[2mwith tmux    →\x1b[0m shells also survive the server restarting or crashing');
  const inst = tmuxInstaller();
  const optOut = () => { try { fs.mkdirSync(path.dirname(TMUX_OPTOUT), { recursive: true, mode: 0o700 }); fs.writeFileSync(TMUX_OPTOUT, ''); } catch {} };
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

// ── Agent event bridge (#40) ─────────────────────────────────────────────────
// Each PTY gets TD_ID/TD_URL/TD_HOOK/TD_HOOK_AUTH so an agent CLI's hook, running inside that
// shell, can POST its lifecycle events back (scripts/td-hook.js). TD_URL is fixed at listen().
const AGENT_HOOK = path.join(__dirname, 'td-hook.js');
// tmux builds the session env from its server, not from our client, so pass it with -e (tmux >= 3.2).
const tmuxEnvFlags = (() => {
  try { const [, a, b] = /(\d+)\.(\d+)/.exec(execFileSync('tmux', ['-V']).toString()) || []; return +a > 3 || (+a === 3 && +b >= 2); }
  catch { return false; }
})();

// ── live output: batched, with backpressure ──
// The ring buffer always gets every byte; this only decides what goes to the socket and when.
// Batching: a chunk with nothing pending goes out at once (typing echo stays instant); chunks arriving within the
// next FLUSH_MS are merged into one message — far fewer frames and JSON encodes under heavy output.
// Backpressure: a socket more than BEHIND_BYTES behind (stalled / sleeping / slow browser) stops getting live output,
// so server memory stays bounded. The shell never pauses. Once the socket has drained, it gets the same reset +
// ring-buffer replay a reconnect gets — so the screen is correct again without anything ever being dropped silently.
const FLUSH_MS = 8, BEHIND_BYTES = 4 * 1024 * 1024;
function replayTo(sess, ws, id) {
  clearTimeout(sess.flushT); sess.flushT = null; sess.pend = ''; sess.behind = false;   // pending output is in the ring already
  send(ws, { type:'attach', id, shell:sess.shellName, cwd:sess.cwd, resumed:true });
  if (sess.buffer) send(ws, { type:'output', data:tail(sess) });
}
function pushOutput(sess, id, data) {
  if (!sess.ws || sess.ws.readyState !== 1 || sess.behind) return;
  if (sess.flushT) { sess.pend += data; return; }
  sendLive(sess, id, data);
  sess.flushT = setTimeout(() => flushOutput(sess, id), FLUSH_MS);
}
function flushOutput(sess, id) {
  sess.flushT = null;
  const data = sess.pend; sess.pend = '';
  if (!data) return;
  sendLive(sess, id, data);
  sess.flushT = setTimeout(() => flushOutput(sess, id), FLUSH_MS);
}
function sendLive(sess, id, data) {
  const ws = sess.ws;
  if (!ws || ws.readyState !== 1 || sess.behind) return;
  if (ws.bufferedAmount <= BEHIND_BYTES) return send(ws, { type:'output', data });
  sess.behind = true; sess.pend = '';
  const wait = setInterval(() => {
    if (sess.ws !== ws || ws.readyState !== 1) return clearInterval(wait);   // closed or replaced: reattach replays anyway
    if (ws.bufferedAmount > 0) return;
    clearInterval(wait);
    replayTo(sess, ws, id);
  }, 100);
}

function send(ws, obj)  { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }
const MAX_COLS = 1000, MAX_ROWS = 500;                   // far beyond any screen; bounds what a client can make the pty allocate
function clampInt(v, d, max) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : d; }
function baseName(p)    { return String(p).split(/[\\/]/).pop(); }
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;
function genId()        { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

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

/**
 * live: id -> { term, buffer, ws, killTimer, cwd, shellName, isLog, tmuxName }
 * approvals: { pending, settle } from agent-api.js
 */
function createSessions({ pty, live, approvals, secret, home, logDir, safeDir }) {
  let AGENT_URL = '';
  const agentEnv = (id, base) => ({ ...base, TD_ID: id, TD_URL: AGENT_URL, TD_HOOK: AGENT_HOOK, TD_HOOK_AUTH: access.hookAuth(secret, id) });
  // Opt-in audit trail: with TD_LOG_DIR set, each shell's buffered output (ANSI stripped, last
  // TD_BUFFER bytes) is written there when the shell really ends. Browser disconnects don't count.
  function saveLog(sess, id, code) {
    if (!logDir || !sess.buffer) return;
    try {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file  = path.join(logDir, `${stamp}_${String(id).replace(/[^\w.-]/g, '_').slice(0, 60)}.log`);
      const head  = `# termdeck session ${id} · ${sess.shellName} · cwd ${sess.cwd} · exit ${code} · ended ${new Date().toISOString()}\n\n`;
      fs.writeFileSync(file, head + tail(sess).replace(ANSI_RE, '').replace(/\r\n?/g, '\n'), { mode: 0o600 });
    } catch (e) { console.error('  [log] save failed:', e.message); }
  }

  function onConnection(ws, req) {
    const q     = url.parse(req.url, true).query;
    const id    = String(q.id || genId());
    // The app sends `<window>-<tab>` (letters, digits). Anything else is refused, never rewritten into a valid one.
    if (!VALID_ID.test(id)) return ws.close(1008, 'invalid terminal id');
    const cols  = clampInt(q.cols, 80, MAX_COLS);
    const rows  = clampInt(q.rows, 24, MAX_ROWS);
    const isLog = q.log === '1';

    // ── reattach ──
    const existing = live.get(id);
    if (existing) {
      clearTimeout(existing.killTimer);
      existing.killTimer = null;
      // Opened on another device / browser: close the old socket so it can't keep typing into a screen it no longer sees.
      const prev = existing.ws;
      existing.ws = ws;
      if (prev && prev !== ws) { send(prev, { type:'taken' }); prev.close(4001, 'opened elsewhere'); }
      replayTo(existing, ws, id);
      if (existing.agentEvt) {   // a replayed request is only answerable while its hook is still held; settled ones lose the reqId
        const e = existing.agentEvt, held = approvals.pending.get(id)?.reqId === e.reqId;
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
    // Two ids that differ only by '-' share a tmux name: never let a second one attach to the first one's shell.
    if (TMUX_OK && [...live.values()].some((s) => s.tmuxName === tmuxSessionName(id))) return ws.close(1008, 'terminal id in use');
    let cwd = q.cwd ? String(q.cwd) : home;
    if (!safeDir(cwd)) cwd = home;
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
      try { execFileSync('tmux', ['has-session', '-t', tmuxTarget(name)], { stdio:'ignore' }); existed = true; } catch {}
      try {
        term = pty.spawn('tmux', ['new-session', '-A', '-D', '-s', name, '-c', cwd,
                                     ...(tmuxEnvFlags ? ['-e', 'TD_ID=' + id, '-e', 'TD_URL=' + AGENT_URL, '-e', 'TD_HOOK=' + AGENT_HOOK, '-e', 'TD_HOOK_AUTH=' + access.hookAuth(secret, id)] : []),
                                     ...(wantShell ? [wantShell] : []),    // trailing shell-command: only used when the session is created
                                     // Hide tmux's status bar: the window chrome already shows name/shell/time, and its default
                                     // black-on-green is unreadable on light themes. This session only — the user's own tmux keeps its bar.
                                     ';', 'set-option', '-t', name, 'status', 'off'],
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
      console.error('  [fatal] No shell spawned. Visit ' + AGENT_URL + '/debug');
      send(ws, { type:'output', data:[
        '\r\n\x1b[31mCould not start a shell.\x1b[0m',
        '\x1b[33mErrors:\x1b[0m',
        ...errors.map((e)=>'  \x1b[2m'+e+'\x1b[0m'),
        '',
        '\x1b[36mRun the setup script to fix this:\x1b[0m',
        '  \x1b[1mnode install.js\x1b[0m',
        '',
        '\x1b[2mDebug page: ' + AGENT_URL + '/debug\x1b[0m',
      ].join('\r\n')});
      send(ws, { type:'exit', code:1 });
      return;
    }

    const sess = { term, buffer:'', pend:'', flushT:null, behind:false, ws, killTimer:null, cwd, shellName:baseName(usedShell), isLog, tmuxName };
    live.set(id, sess);
    console.log('  [+]', usedShell, tmuxName ? '(tmux '+tmuxName+')' : '', 'pid='+term.pid, 'id='+id);

    term.onData((data) => {
      // Amortized trim: slicing on every chunk copied the whole ring each time (~100× slower under heavy output).
      // The ring may hold up to 2× BUFFER; readers take the last BUFFER via tail().
      sess.buffer += data;
      if (sess.buffer.length > 2 * BUFFER) sess.buffer = tail(sess);
      try { pushOutput(sess, id, data); } catch (e) { console.error('  [pty] output failed for ' + id + ':', e.message); }   // the ring already has it
    });
    term.onExit(({ exitCode }) => {
      try {
        clearTimeout(sess.flushT); sess.flushT = null;               // last batched output must reach the screen before 'exit'
        if (sess.pend) { sendLive(sess, id, sess.pend); sess.pend = ''; }
        if (sess.ws) send(sess.ws, { type:'exit', code:exitCode });
        saveLog(sess, id, exitCode);
      } catch (e) { console.error('  [pty] exit handling failed for ' + id + ':', e.message); }
      clearTimeout(sess.killTimer);
      live.delete(id);
    });

    send(ws, { type:'attach', id, shell:sess.shellName, cwd, resumed:false });
    // Startup command: typed into the fresh shell after it settles, so the user sees it run and
    // the interactive shell stays afterwards (`ssh host` → back at local shell on disconnect).
    if (runCmd) setTimeout(() => { try { sess.term.write(cmd + '\r'); } catch {} }, 300);
    bindWsEvents(ws, id);
  }
  function handleConnection(ws, req) {
    try { onConnection(ws, req); }
    catch (e) {                                                   // a failed attach/spawn closes this socket, not the server
      console.error('  [ws] connection failed:', e.stack || e.message);
      try { send(ws, { type:'error', code:'server_error' }); ws.close(1011); } catch {}
    }
  }

  function bindWsEvents(ws, id) {
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;                  // e.g. `null` — reading .type on it used to crash the server
      try { onMessage(ws, id, m); }
      catch (e) { console.error(`  [ws] message "${String(m.type).slice(0, 20)}" failed for ${id}:`, e.message); }   // one bad message never takes every shell down
    });
    ws.on('close', () => {
      const s = live.get(id); if (!s || s.ws !== ws) return;
      s.ws = null;
      s.killTimer = setTimeout(() => { try { s.term.kill(); } catch {} live.delete(id); }, GRACE_MS);
    });
  }
  function onMessage(ws, id, m) {
      const s = live.get(id); if (!s || s.ws !== ws) return;   // a taken-over socket is read-only until it closes
      if      (m.type === 'input'  && !s.isLog && typeof m.data === 'string') {
        // Typing in the terminal = you're handling the prompt there; stop holding the hook (Codex blocks on it
        // before showing its prompt). Terminal-generated replies (cursor/device reports, focus) don't count.
        if (approvals.pending.has(id) && !/^\x1b(\[[\x30-\x3f]*[\x20-\x2f]*[cRnIOty$]|\]|P)/.test(String(m.data))) approvals.settle(id, null, 'terminal');
        s.term.write(m.data);
      }
      else if (m.type === 'approve' && !s.isLog) {
        const p = approvals.pending.get(id);
        if (p && p.reqId === m.reqId && (m.decision === 'allow' || m.decision === 'deny')) approvals.settle(id, m.decision, 'click');
      }
      else if (m.type === 'resize') { try { s.term.resize(clampInt(m.cols,80,MAX_COLS), clampInt(m.rows,24,MAX_ROWS)); } catch {} }
      else if (m.type === 'kill')   {
        // tmux: killing the pty only detaches the client — the session would live on and
        // reattach as a "dead" terminal. Kill the session so the shell actually ends.
        if (s.tmuxName) { try { execFile('tmux', ['kill-session', '-t', tmuxTarget(s.tmuxName)], () => {}); } catch {} }
        try { s.term.kill(); } catch {}
        clearTimeout(s.killTimer); live.delete(id);
      }
  }

  if (readCwds || TMUX_OK) setInterval(async () => {
    // Raw shells: OS pid → cwd. tmux sessions have the wrong pid (the tmux client), so ask tmux.
    const rawByPid = new Map();
    for (const s of live.values()) if (!s.tmuxName && s.term?.pid) rawByPid.set(s.term.pid, s);
    if (readCwds && rawByPid.size) {
      let map; try { map = await readCwds([...rawByPid.keys()]); } catch { map = new Map(); }
      for (const [pid, cwd] of map) pushCwd(rawByPid.get(pid), cwd);
    }
    // One tmux call for every session (not one per session): the active pane of each session's active window.
    const byName = new Map();
    for (const s of live.values()) if (s.tmuxName) byName.set(s.tmuxName, s);
    if (byName.size) execFile('tmux', ['list-panes', '-a', '-F', '#{window_active}#{pane_active} #{session_name} #{pane_current_path}'],
      { timeout: CWD_POLL_MS }, (e, out) => {
        if (e) return;
        for (const line of out.split('\n')) {
          const m = /^11 (\S+) (.+)$/.exec(line);                 // tmux may print a tab as "_": split on spaces (names have none)
          if (m) pushCwd(byName.get(m[1]), m[2]);
        }
      });
  }, CWD_POLL_MS).unref();

  return {
    handleConnection,
    setAgentUrl: (u) => { AGENT_URL = u; },   // fixed at listen(); shells started after it carry it as TD_URL
    tmuxOk: () => TMUX_OK,
  };
}

module.exports = { createSessions, maybePromptTmux, shellCandidates, baseName, send, tmuxTarget, positiveEnvNumber };
