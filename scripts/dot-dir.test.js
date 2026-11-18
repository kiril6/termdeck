// node scripts/dot-dir.test.js — termdeck installed under a dot-directory (~/.nvm/..., ~/.npm/_npx/..., a git
// worktree in .claude/worktrees/) still serves its own files. res.sendFile with an absolute path refuses any path
// with a dot-segment (dotfiles: 'ignore'), so Help → What's new said "Changelog unavailable." there.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repo = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'td-dotdir-'));
const home = path.join(tmp, 'home');
const app = path.join(tmp, '.hidden', 'termdeck');
// Lay out the published files (package.json `files`) the way an install does, with the real node_modules.
for (const f of ['package.json', ...require('../package.json').files]) fs.cpSync(path.join(repo, f), path.join(app, f), { recursive: true });
fs.symlinkSync(path.join(repo, 'node_modules'), path.join(app, 'node_modules'), 'junction');
// No public/index.html: '/' falls through express.static to the route that serves a root-level index.html.
fs.renameSync(path.join(app, 'public', 'index.html'), path.join(app, 'index.html'));

const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (port, p, cookie) => new Promise((ok, fail) => {
  http.get({ host: '127.0.0.1', port, path: p, headers: { Cookie: cookie || '', Accept: 'text/html' } }, (res) => {
    let b = ''; res.on('data', (c) => b += c); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b }));
  }).on('error', fail);
});

(async () => {
  const port = await free();
  const s = spawn(process.execPath, [path.join(app, 'server.js')], {
    env: { ...process.env, PORT: String(port), HOME: home, NO_TMUX: '1', NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; s.stdout.on('data', (d) => { out += d; }); s.stderr.on('data', (d) => { out += d; });
  const done = (code) => { s.once('exit', () => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(code); }); s.kill(); };
  setTimeout(() => { console.error('dot-dir.test: timed out\n' + out); done(1); }, 30000).unref();
  try {
    while (!/TermDeck → /.test(out)) await sleep(100);
    const token = fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim();
    const r = await get(port, `/?t=${token}`);
    const cookie = (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

    const log = await get(port, '/api/changelog', cookie);
    assert.strictEqual(log.status, 200, 'changelog served from under a dot-directory');
    assert.strictEqual(log.body, fs.readFileSync(path.join(app, 'CHANGELOG.md'), 'utf8'));

    const index = await get(port, '/', cookie);
    assert.strictEqual(index.status, 200, 'root-level index.html served from under a dot-directory');
    assert.match(index.body, /<html/i);
    console.log('dot-dir.test: ok');
    done(0);
  } catch (e) { console.error(e.message + '\n' + out); done(1); }
})();
