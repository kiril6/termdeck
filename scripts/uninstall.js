#!/usr/bin/env node
// `termdeck uninstall [--dry-run] [--yes]`: remove what termdeck set up and stored, in one step, after one confirmation.
//   1. agent hooks          → `termdeck hooks uninstall --agent all` (backs each settings file up first)
//   2. start at login       → `termdeck autostart uninstall`
//   3. termdeck's own tmux sessions (td_*) — the shells termdeck kept alive
//   4. ~/.termdeck (secret, saved layouts, allow-rules) and the tmux opt-out flag
// Kept, and listed: the agent-settings backups (*.termdeck-bak-*, your recovery copies), TD_LOG_DIR (a folder you
// chose) and browser site data (only the browser can clear it). Refuses while a termdeck server is running.
// Removing the npm package itself stays `npm uninstall -g @kiril6/termdeck`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync, spawnSync } = require('child_process');
const { CLIS } = require('./hooks');

const home = os.homedir();
const tilde = (p) => p.replace(home, '~');
const STATE_DIR = path.join(home, '.termdeck');
const OPTOUT_LEGACY = path.join(home, '.termdeck-tmux-optout');   // before 1.26 the flag lived outside ~/.termdeck

function runningServer() {
  let cur; try { cur = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'server.json'), 'utf8')); } catch { return null; }
  try { process.kill(cur.pid, 0); return cur; } catch (e) { return e.code === 'EPERM' ? cur : null; }
}

function tmuxSessions() {
  if (process.platform === 'win32') return [];
  try {
    return execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().split('\n').filter((s) => /^td_[A-Za-z0-9_]+$/.test(s));
  } catch { return []; }   // no tmux, or no server running
}

function backups() {
  const out = [];
  for (const c of Object.values(CLIS)) {
    const file = path.join(home, c.dir, c.file), dir = path.dirname(file), base = path.basename(file) + '.termdeck-bak-';
    try { for (const f of fs.readdirSync(dir)) if (f.startsWith(base)) out.push(path.join(dir, f)); } catch {}
  }
  return out;
}

const sub = (script, args) => spawnSync(process.execPath, [path.join(__dirname, script), ...args], { stdio: 'inherit' }).status;

async function confirm(q) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(q, r));
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

async function main(argv) {
  let dry = false, yes = false;
  for (const a of argv) {
    if (a === '--dry-run') dry = true;
    else if (a === '--yes' || a === '-y') yes = true;
    else usage(`unknown argument "${a}"`);
  }
  const srv = runningServer();
  if (srv) {
    console.error(`\n  termdeck is running (pid ${srv.pid}, ${srv.url}). Stop it first (Ctrl+C in its terminal, or\n  \`termdeck autostart uninstall\` if it starts at login), then run this again.\n`);
    process.exit(1);
  }
  const sessions = tmuxSessions();
  const files = [STATE_DIR, OPTOUT_LEGACY].filter((p) => fs.existsSync(p));

  console.log('\n  termdeck uninstall will:');
  console.log('    1. remove termdeck\'s agent hooks (each settings file is backed up first)');
  console.log('    2. remove start-at-login, if set up');
  console.log(sessions.length ? `    3. end ${sessions.length} termdeck tmux session${sessions.length === 1 ? '' : 's'} — the shells in them stop: ${sessions.join(', ')}` : '    3. (no termdeck tmux sessions)');
  console.log(files.length ? `    4. delete ${files.map(tilde).join(', ')} — access secret, saved layouts, allow-rules` : '    4. (no ~/.termdeck)');

  if (dry) {
    console.log('\n  Steps 1 and 2 in detail:');
    sub('hooks.js', ['uninstall', '--agent', 'all', '--dry-run']);
    if (process.platform === 'darwin' || process.platform === 'linux') sub('autostart.js', ['uninstall', '--dry-run']);
    console.log('  --dry-run: nothing changed\n');
    process.exit(0);
  }
  if (!yes && !(await confirm('\n  Proceed? This cannot be undone. [y/N] '))) {
    console.log(process.stdin.isTTY ? '  Cancelled — nothing changed.\n' : '\n  Not a terminal — re-run with --yes to apply. Nothing changed.\n');
    process.exit(1);
  }

  let failed = false;
  console.log('\n  1. Agent hooks');
  if (sub('hooks.js', ['uninstall', '--agent', 'all', '--yes'])) failed = true;
  if (process.platform === 'darwin' || process.platform === 'linux') {   // the only platforms autostart supports
    console.log('  2. Start at login');
    if (sub('autostart.js', ['uninstall', '--yes'])) failed = true;
  }
  for (const s of sessions) {
    try { execFileSync('tmux', ['kill-session', '-t', '=' + s], { stdio: 'ignore' }); } catch { console.log(`  ✗ could not end tmux session ${s}`); failed = true; }
  }
  if (sessions.length) console.log(`  3. ✓ ended ${sessions.length} tmux session${sessions.length === 1 ? '' : 's'}`);
  for (const p of files) {
    try { fs.rmSync(p, { recursive: true, force: true }); console.log(`  4. ✓ deleted ${tilde(p)}`); }
    catch (e) { console.log(`  ✗ could not delete ${tilde(p)}: ${e.message}`); failed = true; }
  }

  const kept = backups();
  console.log('\n  Kept (delete them yourself if you no longer need them):');
  if (kept.length) console.log(`    agent settings backups — may contain API keys from those files:\n${kept.map((f) => '      ' + tilde(f)).join('\n')}`);
  if (process.env.TD_LOG_DIR) console.log(`    session logs and the approval audit log in TD_LOG_DIR (${process.env.TD_LOG_DIR})`);
  console.log('    termdeck\'s site data in your browser (layout, snippets, SSH targets): clear it in the browser\'s site settings');
  console.log('    the program itself: npm uninstall -g @kiril6/termdeck (or delete your clone)\n');
  process.exit(failed ? 1 : 0);
}

function usage(msg) {
  process.stderr.write(`termdeck uninstall: ${msg}\n\nUsage:\n  termdeck uninstall [--dry-run] [--yes]\n`);
  process.exit(2);
}

main(process.argv.slice(2)).catch((e) => { console.error('  ✗', e.message); process.exit(1); });
