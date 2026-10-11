// node scripts/shared-home.test.js — two termdeck servers on one HOME (easy with the auto port fallback) keep each
// other's saved layouts and rule settings, and each sees the other's changes without a restart.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-shared-'));
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
const call = (port, method, p, body) => new Promise((ok, fail) => {
  const data = body ? JSON.stringify(body) : undefined;
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie,
    ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
  (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => ok({ status: res.statusCode, json: /json/.test(res.headers['content-type'] || '') ? JSON.parse(b) : null })); });
  r.on('error', fail); r.end(data);
});
const layout = { projects: [{ id: 'p1', name: 'x' }], sessions: [] };

(async () => {
  const ports = [await free(), await free()];
  const servers = ports.map((port) => spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, HOME: home, PORT: String(port), NO_TMUX: '1', NO_OPEN: '1' }, stdio: 'ignore' }));
  const done = (code) => { let left = servers.length; for (const s of servers) { s.once('exit', () => { if (!--left) { fs.rmSync(home, { recursive: true, force: true }); process.exit(code); } }); s.kill(); } };
  setTimeout(() => { console.error('shared-home.test: timed out'); done(1); }, 30000).unref();
  try {
    for (const port of ports) { let up = false; for (let i = 0; i < 100 && !up; i++) { up = await call(port, 'GET', '/').then(() => true, () => false); if (!up) await sleep(100); } assert.ok(up); }
    cookie = 'td_token=' + fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim();   // both servers share it
    const [A, B] = ports;

    assert.strictEqual((await call(A, 'POST', '/api/layouts', { name: 'from A', data: layout })).status, 200);
    assert.strictEqual((await call(B, 'POST', '/api/layouts', { name: 'from B', data: layout })).status, 200);
    for (const port of ports) {
      const names = (await call(port, 'GET', '/api/layouts')).json.map((l) => l.name).sort();
      assert.deepStrictEqual(names, ['from A', 'from B'], `server :${port} lists both layouts`);
    }
    const onDisk = JSON.parse(fs.readFileSync(path.join(home, '.termdeck', 'layouts.json'), 'utf8')).layouts.map((l) => l.name).sort();
    assert.deepStrictEqual(onDisk, ['from A', 'from B']);

    const idA = (await call(A, 'GET', '/api/layouts')).json.find((l) => l.name === 'from A').id;
    await call(B, 'DELETE', '/api/layouts/' + idA);                       // B deletes A's layout
    assert.deepStrictEqual((await call(A, 'GET', '/api/layouts')).json.map((l) => l.name), ['from B'], 'A sees the delete');

    await call(A, 'POST', '/api/approval-rules/enabled', { enabled: true });
    assert.strictEqual((await call(B, 'GET', '/api/approval-rules')).json.enabled, true, 'B sees A resume rules');
    await call(B, 'POST', '/api/approval-rules/enabled', { enabled: false });
    assert.strictEqual((await call(A, 'GET', '/api/approval-rules')).json.enabled, false, 'A sees B pause rules');

    console.log('shared-home.test: ok');
    done(0);
  } catch (e) { console.error(e); done(1); }
})();
