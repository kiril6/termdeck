// node scripts/tmux.test.js — durable sessions: with tmux, a shell survives the SERVER restarting (not just a browser
// refresh) — same process, same shell state, output replayed — and closing it ends the tmux session. Own tmux socket
// (TMUX_TMPDIR) and throwaway HOME, so it never touches your real sessions. Skips where tmux isn't installed.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');

const hasTmux = process.platform !== 'win32' && (() => { try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); return true; } catch { return false; } })();
if (!hasTmux) { console.log('tmux.test: skipped (tmux not installed)'); process.exit(0); }

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-tmux-'));
const tmuxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-tmux-sock-'));
const env = { ...process.env, HOME: home, TMUX_TMPDIR: tmuxDir, NO_OPEN: '1', SHELL: '/bin/bash' };
delete env.NO_TMUX; delete env.TMUX;
const tmux = (...a) => { try { return execFileSync('tmux', a, { env, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return ''; } };
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 50) { if (fn()) return true; await sleep(50); } return false; };

let srv = null;
const cleanup = (code) => {
  tmux('kill-server');
  const end = () => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(tmuxDir, { recursive: true, force: true }); process.exit(code); };
  if (srv && srv.exitCode === null) { srv.once('exit', end); srv.kill(); } else end();
};
setTimeout(() => { console.error('tmux.test: timed out'); cleanup(1); }, 60000).unref();

(async () => {
  const port = await free(), id = 'tmuxtest' + Date.now();
  const start = () => { srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...env, PORT: String(port) }, stdio: 'ignore' }); };
  const connect = async (cid = id) => {
    for (let i = 0; i < 100; i++) {
      let secret = ''; try { secret = fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim(); } catch {}
      const c = await new Promise((ok) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?id=${cid}&cols=100&rows=30`, { headers: { Origin: `http://127.0.0.1:${port}`, Cookie: 'td_token=' + secret } });
        const msgs = []; ws.on('message', (raw) => msgs.push(JSON.parse(raw)));
        ws.on('open', () => ok({ ws, msgs })); ws.on('error', () => ok(null)); ws.on('unexpected-response', () => ok(null));
      });
      if (c) return c;
      await sleep(100);
    }
    throw new Error('server did not start');
  };
  const out = (c) => c.msgs.filter((m) => m.type === 'output').map((m) => m.data).join('');
  try {
    start();
    let c = await connect();
    await until(() => c.msgs.some((m) => m.type === 'attach'));
    await sleep(500);
    c.ws.send(JSON.stringify({ type: 'input', data: 'MARK=durable-$((6*7)); echo PID=$$\r' }));
    assert.ok(await until(() => /PID=\d+/.test(out(c))), 'shell answered');
    const pid = /PID=(\d+)/.exec(out(c))[1];
    assert.match(tmux('list-sessions', '-F', '#{session_name}'), /^td_tmuxtest/m, 'the shell runs in a td_* tmux session');

    // `cd` is followed: the server polls tmux for the active pane's directory and pushes {type:'cwd'}.
    const sub = path.join(home, 'sub dir'); fs.mkdirSync(sub);
    c.ws.send(JSON.stringify({ type: 'input', data: `cd '${sub}'\r` }));
    assert.ok(await until(() => c.msgs.some((m) => m.type === 'cwd' && m.cwd === fs.realpathSync(sub))), 'cwd change reported');

    // The server goes away (crash / restart); tmux keeps the shell.
    await new Promise((r) => { srv.once('exit', r); srv.kill('SIGKILL'); });
    start();
    c = await connect();
    assert.ok(await until(() => out(c).includes('PID=' + pid)), 'output from before the restart is shown again');
    c.ws.send(JSON.stringify({ type: 'input', data: 'echo "SAME=$$ $MARK"\r' }));
    assert.ok(await until(() => out(c).includes(`SAME=${pid} durable-42`)), 'same shell process and state after the restart');

    // Closing the terminal ends the tmux session too (killing only the client would leave it running).
    c.ws.send(JSON.stringify({ type: 'kill' }));
    assert.ok(await until(() => !/^td_tmuxtest/m.test(tmux('list-sessions', '-F', '#{session_name}')), 5000), 'tmux session ended');
    c.ws.close();

    // A window closed without its socket (#302): the HTTP kill ends the tmux session, live or not, and the orphan
    // sweep lists and kills sessions nothing owns — but only ones nothing is attached to.
    const secret = fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim();
    const api = (method, p, body) => new Promise((ok, no) => {
      const q = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Origin: `http://127.0.0.1:${port}`, Cookie: 'td_token=' + secret, 'Content-Type': 'application/json' } },
        (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok(JSON.parse(b))); });
      q.on('error', no); q.end(body ? JSON.stringify(body) : undefined);
    });
    const has = (name) => tmux('list-sessions', '-F', '#{session_name}').split('\n').includes(name);
    const open = async (cid) => { const k = await connect(cid); await until(() => k.msgs.some((m) => m.type === 'attach')); return k; };
    const restart = async () => { await new Promise((r) => { srv.once('exit', r); srv.kill('SIGKILL'); }); start(); await connect().then((k) => k.ws.close()); };
    const live = id + 'live', gone = id + 'gone', orph = id + 'orph';
    const kl = await open(live);
    assert.ok(has('td_' + live));
    assert.deepStrictEqual(await api('POST', '/api/session-kill', { id: live }), { ok: true });
    assert.ok(await until(() => !has('td_' + live), 5000), 'HTTP kill ends a live terminal and its tmux session');
    kl.ws.close();
    assert.deepStrictEqual(await api('POST', '/api/session-kill', { id: '../x' }), { ok: false }, 'an invalid id is refused');

    const kg = await open(gone), ko = await open(orph);
    kg.ws.close(); ko.ws.close(); await sleep(300);
    await restart();                                                    // tmux still has both; the server no longer knows them
    assert.ok(has('td_' + gone) && has('td_' + orph));
    assert.ok((await api('GET', '/api/orphans')).names.includes('td_' + orph), 'a detached session no terminal owns is listed');
    assert.deepStrictEqual(await api('POST', '/api/session-kill', { id: gone }), { ok: true });
    assert.ok(await until(() => !has('td_' + gone), 5000), 'HTTP kill ends a tmux session the server no longer holds');
    assert.deepStrictEqual((await api('POST', '/api/orphans/kill', { names: ['td_' + orph, 'td_notthere', 'other'] })).killed, ['td_' + orph], 'only real orphans are killed');
    assert.ok(await until(() => !has('td_' + orph), 5000), 'sweep ended the orphan');
    const ka = await open(id + 'att');                                  // attached: owned by a live terminal, never listed
    assert.ok(!(await api('GET', '/api/orphans')).names.includes('td_' + id + 'att'), 'an attached session is not an orphan');
    ka.ws.send(JSON.stringify({ type: 'kill' }));
    console.log('tmux.test: ok');
    cleanup(0);
  } catch (e) { console.error(e); cleanup(1); }
})();
