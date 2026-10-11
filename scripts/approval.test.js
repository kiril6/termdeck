// node scripts/approval.test.js — the approval round trip with the REAL helper (scripts/td-hook.js) and the captured
// CLI payloads in scripts/fixtures/hooks: what the agent CLI receives on Allow / Deny (each CLI's own format), and that
// every other ending prints nothing so the CLI asks as usual — hold timeout, typing in the terminal. Also: the helper
// finds a restarted server via ~/.termdeck/server.json, and the audit log in TD_LOG_DIR is written and rotated.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { hookAuth } = require('./access');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-approval-'));
const logDir = path.join(home, 'logs');
const HOLD_MS = 1500;
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { for (let t = 0; t < ms; t += 50) { if (fn()) return true; await sleep(50); } return false; };
const fixture = (agent, name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'hooks', agent, name), 'utf8');

(async () => {
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'approvals.jsonl'), 'x'.repeat(10 * 1024 * 1024 + 1));   // over the rotation size
  const port = await free(), url = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, HOME: home, PORT: String(port), NO_TMUX: '1', NO_OPEN: '1', TD_LOG_DIR: logDir, TD_APPROVAL_HOLD_MS: String(HOLD_MS) },
    stdio: ['ignore', 'ignore', 'pipe'] });
  let srvErr = ''; srv.stderr.on('data', (d) => { srvErr += d; });
  const done = (code) => { srv.once('exit', () => { fs.rmSync(home, { recursive: true, force: true }); process.exit(code); }); srv.kill(); };
  setTimeout(() => { console.error('approval.test: timed out'); done(1); }, 60000).unref();
  try {
    const id = 'appr' + Date.now();
    let browser;
    for (let i = 0; i < 100 && !browser; i++) {
      let secret = ''; try { secret = fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim(); } catch {}
      browser = await new Promise((ok) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?id=${id}`, { headers: { Origin: url, Cookie: 'td_token=' + secret } });
        const msgs = []; ws.on('message', (raw) => msgs.push(JSON.parse(raw)));
        ws.on('open', () => ok({ ws, msgs, secret })); ws.on('error', () => ok(null)); ws.on('unexpected-response', () => ok(null));
      });
      if (!browser) await sleep(100);
    }
    assert.ok(browser, 'server did not start\n' + srvErr);
    assert.ok(await until(() => browser.msgs.some((m) => m.type === 'attach')));
    const auth = hookAuth(browser.secret, id);

    // Run the helper as the CLI would: payload on stdin, decision (if any) on stdout.
    const hook = (agent, payload, tdUrl = url) => new Promise((ok) => {
      const p = spawn(process.execPath, [path.join(__dirname, 'td-hook.js'), agent], { env: { ...process.env, HOME: home, TD_ID: id, TD_URL: tdUrl, TD_HOOK_AUTH: auth } });
      let out = ''; p.stdout.on('data', (d) => { out += d; });
      p.on('exit', (code) => ok({ code, out }));
      p.stdin.end(payload);
    });
    const nextRequest = async () => {
      const seen = browser.msgs.length;
      assert.ok(await until(() => browser.msgs.slice(seen).some((m) => m.type === 'agent' && m.event.reqId)), 'request reached the browser');
      return browser.msgs.slice(seen).find((m) => m.type === 'agent' && m.event.reqId).event.reqId;
    };
    const click = (reqId, decision) => browser.ws.send(JSON.stringify({ type: 'approve', reqId, decision }));

    // Allow, Claude Code: the decision comes back wrapped in hookSpecificOutput.
    let h = hook('claude', fixture('claude', 'permission-request-bash.json'));
    click(await nextRequest(), 'allow');
    let r = await h;
    assert.strictEqual(r.code, 0);
    assert.deepStrictEqual(JSON.parse(r.out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });

    // Deny, Copilot CLI (camelCase payload): the decision at the top level, with a message.
    h = hook('copilot', fixture('copilot', 'permission-request-bash.json'));
    click(await nextRequest(), 'deny');
    r = await h;
    assert.deepStrictEqual(JSON.parse(r.out), { behavior: 'deny', message: 'Denied from termdeck' });

    // No click: the hold times out and the helper prints nothing (the CLI shows its own prompt).
    const t0 = Date.now();
    r = await hook('claude', fixture('claude', 'permission-request-bash.json'));
    assert.strictEqual(r.out, '', 'timeout: no decision printed');
    assert.ok(Date.now() - t0 >= HOLD_MS - 100, 'held until the timeout');

    // Typing in the terminal releases the hold (you're answering there), again with no decision.
    h = hook('claude', fixture('claude', 'permission-request-bash.json'));
    await nextRequest();
    browser.ws.send(JSON.stringify({ type: 'input', data: 'y' }));
    r = await h;
    assert.strictEqual(r.out, '', 'typed in terminal: no decision printed');

    // A stale TD_URL (server restarted on another port, tmux kept the old env): the helper uses server.json.
    h = hook('claude', fixture('claude', 'permission-request-bash.json'), 'http://127.0.0.1:1');
    click(await nextRequest(), 'allow');
    r = await h;
    assert.strictEqual(JSON.parse(r.out).hookSpecificOutput.decision.behavior, 'allow', 'reached the server via server.json');

    // Audit: every ending is recorded with who decided; the oversized log was rotated first.
    const lines = fs.readFileSync(path.join(logDir, 'approvals.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(lines.map((l) => [l.decision, l.source]),
      [['allow', 'click'], ['deny', 'click'], [null, 'timeout'], [null, 'terminal'], ['allow', 'click']]);
    assert.strictEqual(fs.statSync(path.join(logDir, 'approvals.1.jsonl')).size, 10 * 1024 * 1024 + 1, 'old log kept as approvals.1.jsonl');
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(logDir, 'approvals.jsonl')).mode & 0o777, 0o600);

    browser.ws.send(JSON.stringify({ type: 'kill' })); browser.ws.close();
    console.log('approval.test: ok');
    done(0);
  } catch (e) { console.error(e); done(1); }
})();
