// node scripts/buffer.test.js — the replay ring keeps the last TD_BUFFER chars across many chunks, and a
// reattach replays only that tail (the ring is trimmed lazily, so it may briefly hold up to 2× before trimming).
// Also: opening the same id elsewhere tells and closes the old socket, and the new one drives the shell.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const BUFFER = 2000;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-buffer-'));
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

(async () => {
  const port = await free();
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, HOME: home, PORT: String(port), TD_BUFFER: String(BUFFER), NO_TMUX: '1', NO_OPEN: '1' }, stdio: 'ignore' });
  const done = (code) => {                                       // wait for exit: the server removes its own files on the way out
    srv.once('exit', () => { fs.rmSync(home, { recursive: true, force: true }); process.exit(code); });
    srv.kill();
  };
  setTimeout(() => { console.error('buffer.test: timed out'); done(1); }, 20000).unref();

  const connect = () => new Promise((ok, fail) => {
    let cookie = ''; try { cookie = 'td_token=' + fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim(); } catch {}   // written on start
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?id=buftest&cols=80&rows=24`, { headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie } });
    const msgs = []; ws.on('message', (raw) => msgs.push(JSON.parse(raw))); ws.on('open', () => ok({ ws, msgs })); ws.on('error', fail);
  });
  let c; for (let i = 0; i < 50 && !c; i++) c = await connect().catch(() => new Promise((r) => setTimeout(r, 100)));
  assert.ok(c, 'server did not start');

  // ~14 KB in many small chunks: forces several trims of a 2000-char ring.
  c.ws.send(JSON.stringify({ type: 'input', data: 'seq 1 3000; echo END""MARK\r' }));
  const out = () => c.msgs.filter((m) => m.type === 'output').map((m) => m.data).join('');
  for (let i = 0; i < 100 && !out().includes('ENDMARK'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(out().includes('ENDMARK'), 'command output never arrived');
  c.ws.close();

  const r = await connect();                                     // reattach within the grace period
  for (let i = 0; i < 50 && !r.msgs.some((m) => m.type === 'output'); i++) await new Promise((res) => setTimeout(res, 100));
  const replay = r.msgs.filter((m) => m.type === 'output').map((m) => m.data).join('');
  assert.ok(replay.length > 0 && replay.length <= BUFFER, `replay is ${replay.length} chars, want 1..${BUFFER}`);
  assert.ok(replay.includes('2999') && replay.includes('ENDMARK'), 'replay lost the newest output');
  assert.ok(!/(^|\n)10\r?\n11\r?\n/.test(replay), 'replay still holds the oldest output');

  // Opening the same id elsewhere while r is still connected: r is told and closed (it must not keep typing blind).
  const rClosed = new Promise((res) => r.ws.on('close', (code) => res(code)));
  const t = await connect();
  assert.strictEqual(await rClosed, 4001, 'the old socket is closed on takeover');
  assert.ok(r.msgs.some((m) => m.type === 'taken'), 'the old socket is told why');
  t.ws.send(JSON.stringify({ type: 'input', data: 'echo TAK""EN\r' }));
  for (let i = 0; i < 50 && !t.msgs.some((m) => m.type === 'output' && m.data.includes('TAKEN')); i++) await new Promise((res) => setTimeout(res, 100));
  assert.ok(t.msgs.some((m) => m.type === 'output' && m.data.includes('TAKEN')), 'the new socket drives the shell');
  t.ws.send(JSON.stringify({ type: 'kill' })); t.ws.close();
  console.log('buffer.test: ok');
  done(0);
})().catch((e) => { console.error(e); process.exit(1); });
