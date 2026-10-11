// node scripts/access.test.js — local access control: the browser signs in once with the /?t=… link and keeps a
// cookie; terminals only get a per-terminal hook credential (TD_HOOK_AUTH). Pins:
//  - no cookie → sign-in page / 401, WS refused; the link sets a persistent HttpOnly cookie
//  - the secret persists in ~/.termdeck/token (0600) and is never written to server.json or a terminal's env
//  - only a trusted hook (TD_HOOK_AUTH) or the browser can hold a permission request for a click; an untrusted
//    event is display-only and cannot clear a held request
//  - `termdeck open` prints the sign-in link
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const WebSocket = require('ws');
const { hookAuth } = require('./access');

const ROOT = path.join(__dirname, '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-access-'));
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((ok, fail) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Origin: `http://127.0.0.1:${port}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (c) => b += c); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', fail); r.end(body);
  });
}
const wsOpen = (port, id, cookie) => new Promise((ok) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?id=${id}`, { headers: { Origin: `http://127.0.0.1:${port}`, ...(cookie ? { Cookie: cookie } : {}) } });
  const msgs = []; ws.on('message', (raw) => msgs.push(JSON.parse(raw)));
  ws.on('open', () => ok({ ws, msgs })); ws.on('unexpected-response', (_q, res) => ok({ status: res.statusCode })); ws.on('error', () => ok({ status: 0 }));
});
const until = async (fn, ms = 5000) => { for (let t = 0; t < ms; t += 50) { if (fn()) return true; await sleep(50); } return false; };

(async () => {
  const port = await free();
  const env = { ...process.env, HOME: home, PORT: String(port), NO_TMUX: '1', NO_OPEN: '1' };
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: 'ignore' });
  const done = (code) => { srv.once('exit', () => { fs.rmSync(home, { recursive: true, force: true }); process.exit(code); }); srv.kill(); };
  setTimeout(() => { console.error('access.test: timed out'); done(1); }, 30000).unref();
  try {
    let up = false; for (let i = 0; i < 100 && !up; i++) { up = await req(port).then(() => true, () => false); if (!up) await sleep(100); }
    assert.ok(up, 'server did not start');

    // Secret file: created, 0600, and not leaked into server.json.
    const tokenFile = path.join(home, '.termdeck', 'token');
    const secret = fs.readFileSync(tokenFile, 'utf8').trim();
    assert.match(secret, /^[0-9a-f]{48}$/);
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(tokenFile).mode & 0o777, 0o600);
    const sj = fs.readFileSync(path.join(home, '.termdeck', 'server.json'), 'utf8');
    assert.ok(!sj.includes(secret), 'server.json must not contain the secret');

    // No cookie: a browser gets the sign-in page, API calls get 401, the WS is refused.
    const page = await req(port, { headers: { Accept: 'text/html' } });
    assert.strictEqual(page.status, 401);
    assert.ok(page.body.includes('termdeck open') && !page.body.includes(secret));
    assert.strictEqual((await req(port, { path: '/api/version' })).status, 401);
    assert.strictEqual((await wsOpen(port, 'nocookie')).status, 401);

    // The link sets a persistent HttpOnly cookie; with it everything works.
    const link = await req(port, { path: '/?t=' + secret });
    assert.strictEqual(link.status, 302);
    const setCookie = String(link.headers['set-cookie']);
    assert.ok(/HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie) && /Max-Age=\d+/.test(setCookie), setCookie);
    const cookie = 'td_token=' + secret;
    assert.strictEqual((await req(port, { path: '/api/version', headers: { Cookie: cookie } })).status, 200);
    assert.strictEqual((await req(port, { path: '/?t=' + 'f'.repeat(48) })).status, 401, 'a wrong link signs nothing in');

    // A terminal's env carries its own hook credential, never the browser secret.
    const id = 'acc' + Date.now();
    const browser = await wsOpen(port, id, cookie);
    assert.ok(browser.ws, 'browser WS should connect');
    await until(() => browser.msgs.some((m) => m.type === 'attach'));
    browser.ws.send(JSON.stringify({ type: 'input', data: 'echo "AUTH=$TD_HOOK_AUTH SECRET_SEEN=$(env | grep -c ' + secret + ')"\r' }));
    assert.ok(await until(() => browser.msgs.some((m) => m.type === 'output' && m.data.includes('SECRET_SEEN=0'))), 'secret must not be in the terminal env');
    const out = browser.msgs.filter((m) => m.type === 'output').map((m) => m.data).join('');
    assert.ok(out.includes('AUTH=' + hookAuth(secret, id)), 'terminal gets TD_HOOK_AUTH for its own id');

    // Hook events: trusted (own credential) can hold a request; untrusted is display-only and can't clear it.
    const event = (extra, headers = {}) => req(port, { method: 'POST', path: '/api/agent-events',
      headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ id, agent: 'claude', tool: 'Bash', ...extra }) });
    const untrusted = await event({ type: 'permission_request', wait: true, command: 'ls' });
    assert.strictEqual(untrusted.status, 204, 'untrusted request is not held');
    const wrong = await event({ type: 'permission_request', wait: true, command: 'ls' }, { 'X-TD-Hook-Auth': hookAuth(secret, 'other-terminal') });
    assert.strictEqual(wrong.status, 204, "another terminal's credential is not trusted");

    const held = event({ type: 'permission_request', wait: true, command: 'ls' }, { 'X-TD-Hook-Auth': hookAuth(secret, id) });
    assert.ok(await until(() => browser.msgs.some((m) => m.type === 'agent' && m.event.reqId)), 'trusted request is held and shown');
    const reqId = browser.msgs.find((m) => m.type === 'agent' && m.event.reqId).event.reqId;
    assert.strictEqual((await event({ type: 'stop' })).status, 204);                       // untrusted: must not release the hold
    browser.ws.send(JSON.stringify({ type: 'approve', reqId, decision: 'deny' }));
    const answered = await held;
    assert.deepStrictEqual([answered.status, JSON.parse(answered.body).decision], [200, 'deny'], 'the click decides');
    const audit = JSON.parse((await req(port, { path: '/api/approvals', headers: { Cookie: cookie } })).body)[0];
    assert.strictEqual(audit.source, 'click');
    browser.ws.send(JSON.stringify({ type: 'kill' })); browser.ws.close();

    // `termdeck open --no-open` prints the sign-in link for the running server.
    const cli = spawnSync(process.execPath, [path.join(ROOT, 'server.js'), 'open', '--no-open'], { env, encoding: 'utf8' });
    assert.strictEqual(cli.status, 0, cli.stderr);
    assert.strictEqual(cli.stdout.trim(), `http://127.0.0.1:${port}/?t=${secret}`);

    console.log('access.test: ok');
    done(0);
  } catch (e) { console.error(e); done(1); }
})();
