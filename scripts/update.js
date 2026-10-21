#!/usr/bin/env node
// `termdeck update`: the "new package → restart → reload" path in one command. Installs the latest release with npm
// (only a global npm install — a clone or another package manager is told how to update itself) and restarts the
// start-at-login service in place. The service file points at the package directory, so a restart is enough: it keeps
// its port and host, and nothing has to be re-typed.
//   termdeck update [--check] [--dry-run] [--yes]
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync, spawnSync } = require('child_process');
const { createChecker } = require('./update-check');
const { buildPlan } = require('./autostart');

const PKG = require('../package.json');
const ROOT = path.resolve(__dirname, '..');
const WIN = process.platform === 'win32';

class Abort extends Error {}

// npm = a global `npm install -g` (the only copy `npm install -g` can replace); npx = temporary cache; other = clone, pnpm, yarn, local install.
function installKind(root, globalRoot) {
  if (/[\\/]_npx[\\/]/.test(root)) return 'npx';
  const norm = (p) => (WIN ? p.toLowerCase() : p);   // Windows paths: drive letter and folder case vary
  return globalRoot && norm(path.resolve(globalRoot, ...PKG.name.split('/'))) === norm(path.resolve(root)) ? 'npm' : 'other';
}

function npmGlobalRoot() {
  try { return execFileSync('npm', ['root', '-g'], { stdio: ['ignore', 'pipe', 'ignore'], shell: WIN }).toString().trim(); } catch { return null; }
}

async function confirm(q) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(q, r));
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

function usage(msg) {
  process.stderr.write(`termdeck update: ${msg}\n\nUsage:\n  termdeck update [--check] [--dry-run] [--yes]\n`);
  process.exit(2);
}

async function main(argv) {
  let check = false, dry = false, yes = false;
  for (const a of argv) {
    if (a === '--check') check = true;
    else if (a === '--dry-run') dry = true;
    else if (a === '--yes' || a === '-y') yes = true;
    else usage(`unknown argument "${a}"`);
  }
  try {
    let r;
    try { r = await createChecker(PKG.version, process.env.TD_UPDATE_URL || undefined)(); }
    catch (e) { throw new Abort(`could not ask the npm registry for the latest release (${e.message})`); }
    if (!r.updateAvailable) { console.log(`\n  termdeck ${PKG.version} is up to date.\n`); process.exit(0); }
    console.log(`\n  termdeck ${PKG.version} → ${r.latest} is available.`);
    if (check) { console.log('  Run `termdeck update` to install it.\n'); process.exit(0); }

    const kind = installKind(ROOT, npmGlobalRoot());
    if (kind === 'npx') throw new Abort('this copy runs from the temporary npx cache — stop it and start it again with `npx -y @kiril6/termdeck@latest` (plain `npx` may reuse an old cached copy)');
    if (kind === 'other') throw new Abort('this copy was not installed with `npm install -g` (a git clone, pnpm, yarn or a project install?) — update it the way you installed it, e.g. `git pull && npm install`');

    let svc = null;   // the start-at-login service, when there is one (macOS and Linux only)
    try { const p = buildPlan('restart', {}); if (fs.existsSync(p.file)) svc = p; } catch { /* unsupported platform */ }

    const install = ['npm', ['install', '-g', `${PKG.name}@${r.latest}`]];
    console.log('\n  Will run:');
    console.log(`    $ ${install[0]} ${install[1].join(' ')}`);
    if (svc) svc.restart.forEach(([c, a]) => console.log(`    $ ${c} ${a.join(' ')}`));
    console.log(svc
      ? '\n  The service restarts: terminals not running under tmux end, tmux ones come back when you reload.'
      : '\n  No start-at-login service found: restart the running termdeck yourself afterwards.');
    if (dry) { console.log('\n  --dry-run: nothing run\n'); process.exit(0); }
    if (!yes && !(await confirm('\n  Proceed? [y/N] '))) {
      console.log(process.stdin.isTTY ? '  Cancelled.\n' : '\n  Not a terminal — re-run with --yes to apply. Nothing changed.\n');
      process.exit(1);
    }

    console.log('');
    const res = spawnSync(install[0], install[1], { stdio: 'inherit', shell: WIN });
    if (res.status !== 0) throw new Abort(`npm install failed (exit ${res.status ?? 'signal'}) — nothing was restarted`);
    console.log(`\n  ✓ termdeck ${r.latest} installed. ${svc ? 'Restarting the service — then reload the TermDeck window.' : 'Restart termdeck, then reload the window.'}\n`);
    for (const [c, a] of svc?.restart || []) {   // last: when run from a TermDeck terminal this may end this very process
      try { execFileSync(c, a, { stdio: 'ignore' }); } catch (e) { throw new Abort(`${c} failed — restart termdeck yourself (${e.message.split('\n')[0]})`); }
    }
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    console.error(`\n  ✗ ${e.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error('  ✗', e.message); process.exit(1); });
module.exports = { installKind };
