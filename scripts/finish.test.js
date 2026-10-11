// node scripts/finish.test.js — "Finish agent task" (/api/git/finish) on a throwaway repo: refuses with nothing to land,
// a dirty worktree, a conflict (dry run first — the main tree is never touched) or a failing pre-merge check; a clean
// branch merges and cleans up; cleanup never forces (an unmerged branch is kept); the main tree is not a task.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'td-finish-')));
const repo = path.join(home, 'repo');
fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = t\n\temail = t@t\n[init]\n\tdefaultBranch = main\n');
const genv = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: genv, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const write = (f, s) => fs.writeFileSync(f, s);
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(repo);
  git(repo, 'init', '-q'); write(path.join(repo, 'a.txt'), 'one\ntwo\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'init');
  const port = await free();
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...genv, PORT: String(port), NO_TMUX: '1', NO_OPEN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let srvErr = ''; srv.stderr.on('data', (d) => { srvErr += d; });
  const done = (code) => { srv.once('exit', () => { fs.rmSync(home, { recursive: true, force: true }); process.exit(code); }); srv.kill(); };
  setTimeout(() => { console.error('finish.test: timed out'); done(1); }, 60000).unref();
  let cookie = '';
  const call = (method, p, body) => new Promise((ok, fail) => {
    const data = body ? JSON.stringify(body) : undefined;
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie,
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
    (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => ok({ status: res.statusCode, json: /json/.test(res.headers['content-type'] || '') ? JSON.parse(b) : null })); });
    r.on('error', fail); r.end(data);
  });
  try {
    let up = false; for (let i = 0; i < 100 && !up; i++) { up = await call('GET', '/').then(() => true, () => false); if (!up) await sleep(100); }
    assert.ok(up, 'server did not start\n' + srvErr);
    cookie = 'td_token=' + fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim();
    const task = async (branch) => { const r = await call('POST', '/api/git/worktree', { dir: repo, branch }); assert.strictEqual(r.status, 200, JSON.stringify(r.json)); return r.json.path; };
    const finish = (dir, body) => call('POST', '/api/git/finish', { dir, ...body });
    const mainHead = () => git(repo, 'rev-parse', 'HEAD');

    // The main tree is not an agent task.
    assert.match((await finish(repo, { action: 'merge' })).json.error, /main working tree/);

    // Nothing committed yet: nothing to land.
    const ok = await task('agent/ok');
    assert.match((await call('GET', '/api/git/finish?dir=' + encodeURIComponent(ok))).json.merge.reason, /Nothing to land/);

    // Uncommitted work is refused, and stays.
    write(path.join(ok, 'b.txt'), 'new\n');
    let r = await finish(ok, { action: 'merge', cleanup: true });
    assert.strictEqual(r.status, 409); assert.match(r.json.error, /Uncommitted changes/);
    assert.ok(fs.existsSync(path.join(ok, 'b.txt')));
    git(ok, 'add', '.'); git(ok, 'commit', '-qm', 'add b');

    // A failing pre-merge check blocks landing and shows its output.
    r = await finish(ok, { action: 'merge', check: 'echo check-said-no; exit 3' });
    assert.strictEqual(r.status, 409); assert.ok(r.json.checkFailed); assert.match(r.json.output, /check-said-no/);

    // A conflicting branch is refused by the dry run; the main tree is untouched (no merge started).
    const clash = await task('agent/clash');
    write(path.join(clash, 'a.txt'), 'ONE-agent\ntwo\n'); git(clash, 'commit', '-qam', 'agent edit');
    write(path.join(repo, 'a.txt'), 'ONE-main\ntwo\n'); git(repo, 'commit', '-qam', 'main edit');
    const before = mainHead();
    r = await finish(clash, { action: 'merge' });
    assert.strictEqual(r.status, 409); assert.match(r.json.error, /Would conflict in: a\.txt/);
    assert.strictEqual(mainHead(), before); assert.strictEqual(git(repo, 'status', '--porcelain'), '');
    assert.ok(!fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')));

    // Clean branch: merges with --no-ff into the main tree, then removes the worktree and the (merged) branch.
    r = await finish(ok, { action: 'merge', cleanup: true, check: 'true' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual(r.json, { checked: true, merged: true, cleaned: true });
    assert.strictEqual(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'new\n');
    assert.strictEqual(git(repo, 'rev-list', '--count', '--merges', 'HEAD^..HEAD'), '1', 'a merge commit');
    assert.ok(!fs.existsSync(ok)); assert.strictEqual(git(repo, 'branch', '--list', 'agent/ok'), '');

    // Cleanup never forces: an unmerged branch is kept even though its worktree goes.
    r = await finish(clash, { action: 'none', cleanup: true });
    assert.strictEqual(r.status, 200); assert.match(r.json.cleanupError, /branch kept/);
    assert.ok(!fs.existsSync(clash)); assert.notStrictEqual(git(repo, 'branch', '--list', 'agent/clash'), '');

    console.log('finish.test: ok');
    done(0);
  } catch (e) { console.error(e); done(1); }
})();
