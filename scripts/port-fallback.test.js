// node scripts/port-fallback.test.js — an unpinned run whose default port (3000) is busy moves to another port, which
// is a new browser origin: the banner says so and /api/version reports movedFrom so the app can warn (#245).
// Not on the very first run (nothing saved anywhere yet), and never for a pinned PORT, which doesn't move.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_PORT = 3000;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-port-'));
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (port, p, cookie) => new Promise((ok, fail) => {
  http.get({ host: '127.0.0.1', port, path: p, headers: { Cookie: cookie || '' } }, (res) => {
    let b = ''; res.on('data', (c) => b += c); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b }));
  }).on('error', fail);
});

(async () => {
  const servers = [];
  // Hold the default port. If something else already owns it, that blocks it just as well.
  const blocker = net.createServer();
  await new Promise((ok) => { blocker.once('error', ok); blocker.listen(DEFAULT_PORT, '127.0.0.1', ok); });
  const start = (env) => {
    const s = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: '', HOME: home, NO_TMUX: '1', NO_OPEN: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    s.out = ''; s.stdout.on('data', (d) => { s.out += d; }); s.stderr.on('data', (d) => { s.out += d; });
    servers.push(s); return s;
  };
  // The banner prints the sign-in link (stdout is a pipe, so only the base URL) — read the port from it.
  const portOf = async (s) => { for (let i = 0; i < 100; i++) { const m = /TermDeck → http:\/\/127\.0\.0\.1:(\d+)/.exec(s.out); if (m) return Number(m[1]); await sleep(100); } return null; };
  // Sign in with the local token, as `termdeck open` does, to read /api/version.
  const version = async (port) => {
    const token = fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim();
    const r = await get(port, `/?t=${token}`);
    const cookie = (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    return JSON.parse((await get(port, '/api/version', cookie)).body);
  };
  const done = (code) => {
    blocker.close(); let left = servers.length;
    const end = () => { fs.rmSync(home, { recursive: true, force: true }); process.exit(code); };
    if (!left) end();
    for (const s of servers) { s.once('exit', () => { if (!--left) end(); }); s.kill(); }
  };
  setTimeout(() => { console.error('port-fallback.test: timed out'); done(1); }, 30000).unref();
  try {
    // First run on this account (no ~/.termdeck/token yet): moves, but there is no saved workspace to warn about.
    const first = start({});
    const firstPort = await portOf(first);
    assert.ok(firstPort && firstPort !== DEFAULT_PORT, 'first run moved off the busy default port\n' + first.out);
    assert.match(first.out, new RegExp(`\\(port ${DEFAULT_PORT} was busy\\)`), 'first run keeps the short note');
    assert.doesNotMatch(first.out, /different browser address/, 'no workspace warning on a first run');
    assert.strictEqual((await version(firstPort)).movedFrom, undefined, 'no movedFrom on a first run');

    // Later runs: the workspace saved on the default port's origin isn't visible on the new one.
    const moved = start({});
    const port = await portOf(moved);
    assert.ok(port && port !== DEFAULT_PORT, 'unpinned run moved off the busy default port\n' + moved.out);
    assert.match(moved.out, new RegExp(`Port ${DEFAULT_PORT} was busy, so termdeck is on ${port}`), 'banner warns about the new origin');
    assert.match(moved.out, /Export settings/, 'banner says how to get the workspace back');
    assert.strictEqual((await version(port)).movedFrom, DEFAULT_PORT, '/api/version reports movedFrom');

    const pinnedPort = await free();
    const pinned = start({ PORT: String(pinnedPort) });
    assert.strictEqual(await portOf(pinned), pinnedPort, 'pinned run binds its port\n' + pinned.out);
    assert.doesNotMatch(pinned.out, /was busy/, 'no note on a pinned port');
    assert.strictEqual((await version(pinnedPort)).movedFrom, undefined, 'no movedFrom on a pinned port');
    console.log('port-fallback.test: ok');
    done(0);
  } catch (e) { console.error(e); done(1); }
})();
