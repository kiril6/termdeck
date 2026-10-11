// node scripts/output.test.js — live output path: batching keeps every byte in order and typing echo fast; a stalled
// socket (sleeping / slow browser) keeps server memory bounded, and once it drains it gets a reset + ring-buffer
// replay showing the newest output.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-output-'));
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { for (let t = 0; t < ms; t += 50) { if (fn()) return true; await sleep(50); } return false; };

(async () => {
  const port = await free();
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, HOME: home, PORT: String(port), NO_TMUX: '1', NO_OPEN: '1', SHELL: '/bin/bash' }, stdio: 'ignore' });
  const rssMB = () => Math.round(+execFileSync('ps', ['-o', 'rss=', '-p', String(srv.pid)]).toString() / 1024);
  const done = (code) => { srv.once('exit', () => { fs.rmSync(home, { recursive: true, force: true }); process.exit(code); }); srv.kill(); };
  setTimeout(() => { console.error('output.test: timed out'); done(1); }, 90000).unref();

  const connect = (id) => new Promise((ok, fail) => {
    let cookie = ''; try { cookie = 'td_token=' + fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim(); } catch {}
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?id=${id}&cols=120&rows=30`, { headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie } });
    const msgs = []; ws.on('message', (raw) => msgs.push(JSON.parse(raw))); ws.on('open', () => ok({ ws, msgs })); ws.on('error', fail);
  });
  const text = (msgs) => msgs.filter((m) => m.type === 'output').map((m) => m.data).join('');
  try {
    let a; for (let i = 0; i < 50 && !a; i++) a = await connect('out-a').catch(() => sleep(100));
    assert.ok(a, 'server did not start');
    assert.ok(await until(() => a.msgs.some((m) => m.type === 'attach'), 5000));
    await sleep(500);                                                   // let the prompt settle

    // Typing echo is not delayed by batching: a lone keystroke comes back well within one frame budget.
    const before = a.msgs.length, t0 = Date.now();
    a.ws.send(JSON.stringify({ type: 'input', data: 'x' }));
    assert.ok(await until(() => text(a.msgs.slice(before)).includes('x'), 2000), 'echo never arrived');
    const echoMs = Date.now() - t0;
    a.ws.send(JSON.stringify({ type: 'input', data: '\x15' }));          // Ctrl+U: clear the line again

    // Batching: heavy output arrives complete and in order, in fewer messages than lines.
    const mark = a.msgs.length;
    a.ws.send(JSON.stringify({ type: 'input', data: 'seq 1 30000; echo DONE""ONE\r' }));
    assert.ok(await until(() => text(a.msgs.slice(mark)).includes('DONEONE'), 20000), 'seq output never finished');
    // Strip escape codes first: bash 5.1+ writes \x1b[?2004l (bracketed paste off) right before the first output line.
    const nums = text(a.msgs.slice(mark)).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n').filter((l) => /^\d+$/.test(l)).map(Number);
    const missing = nums.length === 30000 ? null : Array.from({ length: 30000 }, (_, i) => i + 1).find((n) => !nums.includes(n));
    assert.strictEqual(nums.length, 30000, `got ${nums.length} lines; first missing: ${missing}`);
    assert.ok(nums.every((n, i) => n === i + 1), 'lines out of order');
    const frames = a.msgs.slice(mark).filter((m) => m.type === 'output').length;
    a.ws.send(JSON.stringify({ type: 'kill' })); a.ws.close();

    // Backpressure: a socket that stops reading keeps server memory bounded, then catches up with a replay.
    const b = await connect('out-b');
    assert.ok(await until(() => b.msgs.some((m) => m.type === 'attach'), 5000));
    await sleep(300);
    const rss0 = rssMB();
    b.ws.send(JSON.stringify({ type: 'input', data: `head -c 300000000 /dev/zero | tr '\\0' a | fold -w 199; echo END""MARK\r` }));
    await sleep(300);
    b.ws._socket.pause();                                               // the browser stops reading
    await sleep(12000);
    const rssStalled = rssMB();
    b.ws._socket.resume();
    const ok = await until(() => { const i = b.msgs.findLastIndex((m) => m.type === 'attach' && m.resumed); return i > 0 && text(b.msgs.slice(i)).includes('ENDMARK'); }, 60000);
    assert.ok(ok, 'stalled socket never caught up with a reset + replay ending in the newest output');
    b.ws.send(JSON.stringify({ type: 'kill' })); b.ws.close();

    console.log(`output.test: ok — echo ${echoMs} ms, 30000 lines in ${frames} frames, stalled server rss ${rss0}→${rssStalled} MB`);
    assert.ok(echoMs < 300, `echo took ${echoMs} ms`);
    assert.ok(frames < 30000 / 5, `${frames} frames for 30000 lines: output is not being batched`);
    // Old behaviour queued all 300 MB for the socket (measured: +1.3 GB and climbing); bounded now (~+110 MB, mostly GC churn).
    assert.ok(rssStalled - rss0 < 250, `server grew ${rssStalled - rss0} MB while the socket was stalled`);
    done(0);
  } catch (e) { console.error(e); done(1); }
})();
