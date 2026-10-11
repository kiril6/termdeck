// node scripts/uninstall.test.js — `termdeck uninstall` removes hooks, termdeck's tmux sessions, ~/.termdeck and the
// legacy opt-out flag; keeps other settings, other tmux sessions and the settings backups; does nothing on --dry-run,
// without --yes off a terminal, or while a server runs. Also: `hooks install` keeps only the newest 3 backups.
// Runs on a throwaway HOME and its own tmux socket (TMUX_TMPDIR) — it never touches your real tmux sessions.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-uninstall-'));
const tmuxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-uninstall-tmux-'));
const env = { ...process.env, HOME: home, USERPROFILE: home, TMUX_TMPDIR: tmuxDir, TMUX: '', TD_LOG_DIR: '' };
delete env.TD_LOG_DIR;
const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'server.js'), ...args], { env, encoding: 'utf8', input: '' });
const tmux = (...a) => execFileSync('tmux', a, { env, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const hasTmux = process.platform !== 'win32' && (() => { try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const exists = (p) => fs.existsSync(path.join(home, p));

try {
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ model: 'keep-me' }, null, 2) + '\n');
  for (let i = 0; i < 5; i++) fs.writeFileSync(`${settings}.termdeck-bak-2020010100000${i}`, '{}');   // old backups
  fs.writeFileSync(`${settings}.termdeck-bak-mine`, '{}');                                          // not ours: never pruned

  let r = cli('hooks', 'install', '--agent', 'claude', '--yes');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const baks = () => fs.readdirSync(path.dirname(settings)).filter((f) => f.includes('.termdeck-bak-')).sort();
  assert.strictEqual(baks().length, 4, 'newest 3 backups + the non-matching one: ' + baks());
  assert.ok(baks().includes('settings.json.termdeck-bak-mine'));
  assert.ok(!baks().includes('settings.json.termdeck-bak-20200101000000'), 'oldest backup pruned');

  fs.mkdirSync(path.join(home, '.termdeck'));
  fs.writeFileSync(path.join(home, '.termdeck', 'token'), 'x');
  fs.writeFileSync(path.join(home, '.termdeck-tmux-optout'), '');
  if (hasTmux) { tmux('new-session', '-d', '-s', 'td_test1'); tmux('new-session', '-d', '-s', 'other'); }
  const untouched = () => {
    assert.ok(exists('.termdeck/token') && exists('.termdeck-tmux-optout'));
    assert.ok(fs.readFileSync(settings, 'utf8').includes('$TD_HOOK'));
    if (hasTmux) assert.match(tmux('list-sessions', '-F', '#{session_name}'), /td_test1/);
  };

  r = cli('uninstall', '--dry-run');
  assert.strictEqual(r.status, 0, r.stderr); assert.match(r.stdout, /--dry-run: nothing changed/); untouched();
  if (hasTmux) assert.match(r.stdout, /td_test1/);

  r = cli('uninstall');                                               // not a terminal, no --yes
  assert.strictEqual(r.status, 1); assert.match(r.stdout, /re-run with --yes/); untouched();

  fs.writeFileSync(path.join(home, '.termdeck', 'server.json'), JSON.stringify({ url: 'http://x', pid: process.pid }));
  r = cli('uninstall', '--yes');                                      // a server is running (this process stands in)
  assert.strictEqual(r.status, 1); assert.match(r.stderr, /Stop it first/); untouched();
  fs.unlinkSync(path.join(home, '.termdeck', 'server.json'));

  r = cli('uninstall', '--yes');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(!exists('.termdeck') && !exists('.termdeck-tmux-optout'), 'state removed');
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.strictEqual(after.model, 'keep-me'); assert.strictEqual(after.hooks, undefined, 'hooks removed, other settings kept');
  assert.ok(baks().length >= 3, 'backups kept'); assert.match(r.stdout, /agent settings backups/);
  if (hasTmux) {
    const left = tmux('list-sessions', '-F', '#{session_name}');
    assert.doesNotMatch(left, /td_test1/); assert.match(left, /other/);
  }
  console.log(`uninstall.test: ok${hasTmux ? '' : ' (tmux not installed: session step not exercised)'}`);
} finally {
  if (hasTmux) try { tmux('kill-server'); } catch {}
  fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(tmuxDir, { recursive: true, force: true });
}
