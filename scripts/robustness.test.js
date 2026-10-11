// node scripts/robustness.test.js — one malformed message must not take the server (and, without tmux, every shell)
// down. Each of these WebSocket messages used to crash the process; the shell must keep working after them. A malformed
// JSON body gets a plain JSON 400, not Express's error page with a stack trace and server paths.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-robust-'));
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { for (let t = 0; t < ms; t += 50) { if (fn()) return true; await sleep(50); } return false; };

(async () => {
  const port = await free(), origin = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, HOME: home, PORT: String(port), NO_TMUX: '1', NO_OPEN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let srvErr = ''; srv.stderr.on('data', (d) => { srvErr += d; });
  let exited = null; srv.on('exit', (c) => { exited = c; });
  const done = (code) => { const end = () => { fs.rmSync(home, { recursive: true, force: true }); process.exit(code); }; if (exited === null) { srv.once('exit', end); srv.kill(); } else end(); };
  setTimeout(() => { console.error('robustness.test: timed out'); done(1); }, 30000).unref();
  try {
    let c, secret = '';
    for (let i = 0; i < 100 && !c; i++) {
      try { secret = fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim(); } catch {}
      c = await new Promise((ok) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?id=robust`, { headers: { Origin: origin, Cookie: 'td_token=' + secret } });
        const msgs = []; ws.on('message', (raw) => msgs.push(JSON.parse(raw)));
        ws.on('open', () => ok({ ws, msgs })); ws.on('error', () => ok(null)); ws.on('unexpected-response', () => ok(null));
      });
      if (!c) await sleep(100);
    }
    assert.ok(c, 'server did not start\n' + srvErr);
    assert.ok(await until(() => c.msgs.some((m) => m.type === 'attach')));

    for (const bad of ['null', 'true', '{"type":"input"}', '{"type":"input","data":123}', '{"type":"input","data":{"a":1}}', '{"type":"approve","reqId":{}}']) c.ws.send(bad);
    await sleep(500);
    assert.strictEqual(exited, null, 'server crashed on a malformed message\n' + srvErr);
    c.ws.send(JSON.stringify({ type: 'input', data: 'echo still-$((40+2))\r' }));
    assert.ok(await until(() => c.msgs.some((m) => m.type === 'output' && m.data.includes('still-42'))), 'the shell still works');

    const r = await new Promise((ok) => {
      const q = http.request({ host: '127.0.0.1', port, path: '/api/layouts', method: 'POST', headers: { Origin: origin, Cookie: 'td_token=' + secret, 'Content-Type': 'application/json' } },
        (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, type: res.headers['content-type'], body: b })); });
      q.end('{bad');
    });
    assert.strictEqual(r.status, 400); assert.match(r.type, /json/);
    assert.deepStrictEqual(JSON.parse(r.body), { error: 'bad request' }, 'no stack trace or server paths');

    c.ws.send(JSON.stringify({ type: 'kill' })); c.ws.close();
    console.log('robustness.test: ok');
    done(0);
  } catch (e) { console.error(e); done(1); }
})();
