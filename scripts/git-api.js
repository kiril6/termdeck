// /api/git — worktree-per-agent + read-only diff review.
// Same Origin+Host guard as /api/ls. Worktree creation writes to the user's repo,
// but grants no capability a shell in that repo doesn't already have (`git worktree
// add` is one typed command) — so the trust model is unchanged. Nothing here ever
// deletes except "Finish task" (#83): explicit opt-in cleanup of a termdeck-made worktree, never --force,
// never `branch -D`, never reset. Review is read-only.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const isWindows = process.platform === 'win32';
const GIT_BRANCH_RE = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,99}$/;   // no leading '-', no spaces/globs
const GIT_TIMEOUT_MS = 60000;                                    // a held index lock or a huge repo must not hang a route forever
function gitP(args, cwd) {                                       // execFile (no shell) → args can't inject
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr: String(stderr || '') })) : resolve(String(stdout)));
  });
}
const GIT_MISSING = 'git is not installed';
const gitFail = (e) => e.code === 'ENOENT' ? GIT_MISSING
  : e.killed ? 'git took longer than ' + GIT_TIMEOUT_MS / 1000 + ' s'
  : (e.stderr || e.message || 'git failed').trim().split('\n')[0];

// Finish task (#83): land an agent worktree — merge locally or open a PR — then optionally remove it.
// GET previews (read-only) and computes what is allowed + why not; POST re-runs the SAME preview and only
// acts if the chosen action is allowed. Cleanup is the one delete in /api/git: `git worktree remove` and
// `git branch -d` WITHOUT force (git itself refuses dirty trees / unmerged branches), only for a worktree that
// is listed by `git worktree list` AND sits directly inside <main>-worktrees/. No shell: execFile + arg arrays.
const run = (cmd, args, cwd, timeout = 120000) => new Promise((resolve) => {
  execFile(cmd, args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});
const lines = (s) => s.split('\n').map((l) => l.trimEnd()).filter(Boolean);
async function finishPreview(dir, baseBranch) {
  const top = (await gitP(['rev-parse', '--show-toplevel'], dir)).trim();
  const main = (await gitP(['worktree', 'list', '--porcelain'], top)).split('\n')
                 .find((l) => l.startsWith('worktree '))?.slice(9).trim();
  const real = (p) => fs.realpathSync(p);
  if (!main || real(main) === real(top)) throw new Error('this is the main working tree, not an agent worktree');
  if (path.dirname(real(top)) !== real(path.join(path.dirname(main), path.basename(main) + '-worktrees')))
    throw new Error('not a worktree created by termdeck');
  const branch = (await gitP(['rev-parse', '--abbrev-ref', 'HEAD'], top)).trim();
  if (!GIT_BRANCH_RE.test(branch)) throw new Error('worktree is on a detached HEAD');
  const mainBranch = (await gitP(['rev-parse', '--abbrev-ref', 'HEAD'], main)).trim();
  const target = baseBranch || mainBranch;
  if (!GIT_BRANCH_RE.test(target)) throw new Error('base branch is unknown (main tree is on a detached HEAD)');
  await gitP(['rev-parse', '--verify', 'refs/heads/' + target], main).catch(() => { throw new Error('base branch “' + target + '” no longer exists'); });
  const [dirty, mainDirty, ahead, origin] = await Promise.all([
    gitP(['status', '--porcelain'], top).then(lines),
    gitP(['status', '--porcelain', '--untracked-files=no'], main).then(lines),
    gitP(['rev-list', '--count', target + '..' + branch], main).then((s) => +s.trim()),
    gitP(['remote', 'get-url', 'origin'], main).then(() => true, () => false),
  ]);
  const out = { top, main, branch, target, mainBranch, ahead, dirty, merge: { ok: false }, pr: { ok: false } };
  const why = dirty.length ? 'Uncommitted changes in the worktree — commit or discard first'
            : !ahead      ? 'Nothing to land — the branch has no commits beyond ' + target : '';
  // merge: lands in the MAIN tree, so it must already be on the target branch and clean
  out.merge.reason = why
    || (mainBranch !== target ? 'The main working tree is on “' + mainBranch + '” — check out “' + target + '” there first' : '')
    || (mainDirty.length ? 'The main working tree has uncommitted changes' : '');
  if (!out.merge.reason) {                                        // dry run: exit 1 = conflicts, names listed after the tree id
    const m = await run('git', ['merge-tree', '--write-tree', '--name-only', target, branch], main);
    if (m.err && m.err.code === 1) out.merge.reason = 'Would conflict in: ' + lines(m.stdout.split('\n\n')[0]).slice(1, 6).join(', ');
    else if (m.err) out.merge.reason = 'Conflict check failed: ' + (m.stderr.trim().split('\n')[0] || 'git ≥ 2.38 required');
  }
  out.merge.ok = !out.merge.reason;
  const gh = await run('gh', ['auth', 'status'], top, 15000);
  out.pr.reason = why
    || (gh.err && gh.err.code === 'ENOENT' ? 'GitHub CLI (gh) is not installed' : gh.err ? 'gh is not signed in — run `gh auth login`' : '')
    || (!origin ? 'No “origin” remote' : '');
  out.pr.ok = !out.pr.reason;
  return out;
}
// Pre-merge check (#119): a command the user typed in the Finish dialog (never read from the repo — same trust as
// "Run command on start"), run in the worktree before Merge / PR. Non-zero exit or timeout blocks landing; the
// client may resubmit with skipCheck after an explicit "Land anyway". CI=1 keeps test runners out of watch mode.
const CHECK_TIMEOUT_MS = (+process.env.TD_CHECK_TIMEOUT || 600) * 1000;
const runCheck = (cmd, cwd) => new Promise((resolve) => {
  const child = spawn(cmd, { cwd, shell: true, detached: !isWindows, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', GIT_TERMINAL_PROMPT: '0' } });
  let tail = '', timedOut = false;
  const keep = (b) => { tail = (tail + b).slice(-8000); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  const timer = setTimeout(() => {                                // kill the whole tree, not just the shell
    timedOut = true;
    if (isWindows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }, CHECK_TIMEOUT_MS);
  const done = (r) => { clearTimeout(timer); resolve(r); };
  child.on('error', (e) => done({ ok: false, error: 'check could not start: ' + e.message, output: '' }));
  child.on('close', (code) => done({
    ok: code === 0 && !timedOut,
    error: timedOut ? 'Check timed out after ' + CHECK_TIMEOUT_MS / 1000 + 's' : 'Check failed (exit ' + code + ')',
    output: lines(tail.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')).slice(-15).join('\n'),
  }));
});

// Conflict radar (#43): which files are changed in more than one agent worktree of the same repo? Read-only,
// informational. The client posts its agent worktrees {dir, base}; we diff each against its base (committed +
// uncommitted + untracked), intersect per repo, and for shared files compare the changed line ranges (-U0).
// Bounded: <=16 trees, <=500 files per tree, <=50 shared files, 4 git processes at a time.
const OVERLAP_TREES = 16, OVERLAP_FILES = 500, OVERLAP_SHARED = 50, BASE_RE = /^[A-Za-z0-9._/-]{1,100}$/;
async function inBatches(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
}
const hunkRanges = (diff) => [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)]   // old-side lines; a pure insertion (count 0) is the point after line a
  .map(([, a, b]) => [+a, +a + Math.max(b === undefined ? 1 : +b, 1) - 1]);
const rangesCollide = (A, B) => A.some(([a1, a2]) => B.some(([b1, b2]) => a1 <= b2 && b1 <= a2));

function gitApi({ apiGuard, expandDir, safeDir }) {
  const r = express.Router();
  r.get('/api/git/root', apiGuard, async (req, res) => {         // is this dir a repo? → toplevel
    const dir = expandDir(req.query.dir);
    if (!safeDir(dir)) return res.status(404).json({ error: 'not a directory' });
    try {
      const root = (await gitP(['rev-parse', '--show-toplevel'], dir)).trim();
      const branch = (await gitP(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim();
      res.json({ root, branch });
    } catch (e) { res.status(404).json({ error: e.code === 'ENOENT' ? GIT_MISSING : 'not a git repository' }); }
  });

  // POST: creates a sibling worktree `<main-repo>-worktrees/<branch>` off the given dir's current HEAD,
  // so each agent gets an isolated checkout instead of three agents racing on one tree.
  r.post('/api/git/worktree', apiGuard, async (req, res) => {
    const dir    = expandDir(req.body?.dir);
    const branch = String(req.body?.branch || '').trim();
    if (!safeDir(dir))              return res.status(400).json({ error: 'not a directory' });
    if (!GIT_BRANCH_RE.test(branch))return res.status(400).json({ error: 'invalid branch name' });
    try {
      const top    = (await gitP(['rev-parse', '--show-toplevel'], dir)).trim();
      const base   = (await gitP(['rev-parse', 'HEAD'], top)).trim();
      const bb     = (await gitP(['rev-parse', '--abbrev-ref', 'HEAD'], top)).trim();
      const baseBranch = bb === 'HEAD' ? '' : bb;                  // '' = detached; "Finish task" then falls back to the main tree's branch
      // First `worktree list` entry is always the MAIN tree, so tasks started from inside an
      // agent worktree still land in <main>-worktrees/ instead of nesting (#39).
      const root   = (await gitP(['worktree', 'list', '--porcelain'], top)).split('\n')
                       .find((l) => l.startsWith('worktree '))?.slice(9).trim() || top;
      const wtHome = path.join(path.dirname(root), path.basename(root) + '-worktrees');
      const wtPath = path.join(wtHome, branch.replace(/\//g, '-'));
      if (fs.existsSync(wtPath))    return res.status(409).json({ error: 'worktree path already exists', path: wtPath });
      fs.mkdirSync(wtHome, { recursive: true });
      await gitP(['worktree', 'add', '-b', branch, wtPath, base], root);
      res.json({ path: wtPath, branch, base, baseBranch, root });
    } catch (e) { res.status(400).json({ error: gitFail(e) }); }
  });

  // Read-only: what has the agent changed since the worktree was cut? Diffs the working
  // tree against the base commit, so it covers both committed and uncommitted work.
  r.get('/api/git/diff', apiGuard, async (req, res) => {
    const dir  = expandDir(req.query.dir);
    const base = String(req.query.base || 'HEAD').trim();
    if (!safeDir(dir)) return res.status(404).json({ error: 'not a directory' });
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(base)) return res.status(400).json({ error: 'invalid base' });
    try {
      const [names, diff, untracked] = await Promise.all([
        gitP(['diff', '--name-status', base], dir),
        gitP(['diff', base], dir),
        gitP(['ls-files', '--others', '--exclude-standard'], dir),
      ]);
      const files = names.trim() ? names.trim().split('\n').map((l) => {
        const [status, ...rest] = l.split('\t');
        return { status: status[0], path: rest.join('\t') };
      }) : [];
      const newFiles = untracked.trim() ? untracked.trim().split('\n') : [];
      newFiles.forEach((p) => files.push({ status: '?', path: p }));
      res.json({ dir, base, files, diff, untracked: newFiles });
    } catch (e) { res.status(400).json({ error: gitFail(e) }); }
  });

  const finishing = new Set();                                      // main trees with a finish in flight (double-click guard)
  r.get('/api/git/finish', apiGuard, async (req, res) => {
    const dir = expandDir(req.query.dir);
    const baseBranch = String(req.query.baseBranch || '').trim();
    if (!safeDir(dir)) return res.status(404).json({ error: 'not a directory' });
    if (baseBranch && !GIT_BRANCH_RE.test(baseBranch)) return res.status(400).json({ error: 'invalid base branch' });
    try { res.json(await finishPreview(dir, baseBranch)); }
    catch (e) { res.status(400).json({ error: gitFail(e) }); }
  });
  r.post('/api/git/finish', apiGuard, async (req, res) => {
    const dir = expandDir(req.body?.dir);
    const baseBranch = String(req.body?.baseBranch || '').trim();
    const action = String(req.body?.action || '');
    if (!safeDir(dir)) return res.status(400).json({ error: 'not a directory' });
    if (baseBranch && !GIT_BRANCH_RE.test(baseBranch)) return res.status(400).json({ error: 'invalid base branch' });
    if (!['merge', 'pr', 'none'].includes(action)) return res.status(400).json({ error: 'invalid action' });
    const check = String(req.body?.check || '').trim();
    if (check.length > 500) return res.status(400).json({ error: 'check command too long' });
    let p;
    try { p = await finishPreview(dir, baseBranch); } catch (e) { return res.status(400).json({ error: gitFail(e) }); }
    if (finishing.has(p.main)) return res.status(409).json({ error: 'another finish is already running for this repo' });
    finishing.add(p.main);
    try {
      const out = {};
      if (action !== 'none') {
        const gate = action === 'merge' ? p.merge : p.pr;
        if (!gate.ok) return res.status(409).json({ error: gate.reason });
        if (check && !req.body?.skipCheck) {
          const c = await runCheck(check, p.top);
          if (!c.ok) return res.status(409).json({ error: c.error, checkFailed: true, output: c.output });
          out.checked = true;
        }
      }
      if (action === 'merge') {
        const m = await run('git', ['merge', '--no-ff', '--no-edit', p.branch], p.main);
        if (m.err) { await run('git', ['merge', '--abort'], p.main); return res.status(409).json({ error: 'merge failed: ' + (lines(m.stderr)[0] || lines(m.stdout)[0] || 'unknown') }); }
        out.merged = true;
      } else if (action === 'pr') {
        const push = await run('git', ['push', '-u', 'origin', p.branch], p.top);
        if (push.err) return res.status(409).json({ error: 'push failed: ' + (lines(push.stderr).pop() || 'unknown') });
        const args = ['pr', 'create', '--fill', '--head', p.branch, ...(baseBranch ? ['--base', baseBranch] : [])];
        const pr = await run('gh', args, p.top);
        if (pr.err) return res.status(409).json({ error: 'gh pr create failed: ' + (lines(pr.stderr).pop() || 'unknown') });
        out.url = lines(pr.stdout).pop();
      } else if (p.dirty.length) return res.status(409).json({ error: 'Uncommitted changes in the worktree — commit or discard first' });   // 'none' + cleanup still needs a clean tree
      if (req.body?.cleanup) {
        const rm = await run('git', ['worktree', 'remove', p.top], p.main);                // no --force: git refuses a dirty tree
        if (rm.err) out.cleanupError = lines(rm.stderr)[0] || 'git worktree remove failed';
        else {
          const br = await run('git', ['branch', '-d', p.branch], p.main);                 // -d, never -D: git refuses unmerged
          if (br.err) out.cleanupError = 'worktree removed, branch kept: ' + (lines(br.stderr)[0] || 'git branch -d failed');
          else out.cleaned = true;
        }
      }
      res.json(out);
    } finally { finishing.delete(p.main); }
  });

  r.post('/api/git/overlaps', apiGuard, async (req, res) => {
    const trees = (Array.isArray(req.body?.trees) ? req.body.trees : []).slice(0, OVERLAP_TREES)
      .map((t, idx) => ({ idx, dir: expandDir(t?.dir), base: String(t?.base || 'HEAD').trim() }))
      .filter((t) => safeDir(t.dir) && BASE_RE.test(t.base));
    try {
      await inBatches(trees, 4, async (t) => {
        try {
          const common = fs.realpathSync(path.resolve(t.dir, (await gitP(['rev-parse', '--git-common-dir'], t.dir)).trim()));   // relative to t.dir; realpath = same key for all worktrees
          const [changed, untracked] = await Promise.all([
            gitP(['diff', '--name-only', t.base], t.dir), gitP(['ls-files', '--others', '--exclude-standard'], t.dir)]);
          t.common = common;
          t.untracked = new Set(untracked.split('\n').filter(Boolean));
          t.files = new Set([...changed.split('\n'), ...t.untracked].filter(Boolean).slice(0, OVERLAP_FILES));
        } catch { t.files = null; }   // not a repo / bad base / git missing: skip this tree
      });
      const byRepo = new Map();
      trees.filter((t) => t.files).forEach((t) => byRepo.set(t.common, [...(byRepo.get(t.common) || []), t]));
      const overlaps = [];
      for (const group of byRepo.values()) {
        if (group.length < 2) continue;
        const owners = new Map();
        group.forEach((t) => t.files.forEach((f) => owners.set(f, [...(owners.get(f) || []), t])));
        const shared = [...owners].filter(([, ts]) => ts.length > 1).slice(0, OVERLAP_SHARED);
        await inBatches(shared, 4, async ([file, ts]) => {
          let collide = null;                                          // null = can't tell (different bases / unreadable)
          if (new Set(ts.map((t) => t.base)).size === 1 && !ts.some((t) => t.untracked.has(file))) {
            try {
              const rs = await Promise.all(ts.map(async (t) => hunkRanges(await gitP(['diff', '-U0', t.base, '--', file], t.dir))));
              collide = rs.some((a, i) => rs.slice(i + 1).some((b) => rangesCollide(a, b)));
            } catch {}
          } else if (ts.every((t) => t.untracked.has(file))) collide = true;   // both created the same new file
          overlaps.push({ path: file, trees: ts.map((t) => t.idx), collide });
        });
      }
      res.json({ overlaps });
    } catch (e) { res.status(400).json({ error: gitFail(e) }); }
  });
  return r;
}

module.exports = { gitApi, gitP };
