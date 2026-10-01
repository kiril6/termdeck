#!/usr/bin/env node
// `termdeck hooks install|uninstall` (#63): set up the agent hooks (docs/agent-hooks.md) without hand-editing JSON.
//   termdeck hooks install   [--agent claude|gemini|codex|all] [--dry-run] [--yes]
//   termdeck hooks uninstall [--agent …] [--dry-run] [--yes]
// MERGES into the CLI's config (never overwrites), is idempotent, shows only OUR entries (other settings may hold
// secrets), backs the file up and writes atomically. Only ever touches the three known paths, only on this command.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

// One table drives install, uninstall and the docs check (scripts/check-hooks-docs.js).
const CLIS = {
  claude: { dir: '.claude', file: 'settings.json', events: ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop'] },
  gemini: { dir: '.gemini', file: 'settings.json', events: ['BeforeAgent', 'BeforeTool', 'AfterTool', 'Notification', 'AfterAgent'] },
  codex:  { dir: '.codex',  file: 'hooks.json',    events: ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop'] },
};
const MARK = '$TD_HOOK';                                   // identifies our entries
const commandFor = (agent) => `node "${MARK}" ${agent}`;   // fixed string — nothing user-supplied is interpolated
const isOurs = (h) => h && typeof h.command === 'string' && h.command.includes(MARK);

class Abort extends Error {}

function parseJson(file, raw) {
  try { return JSON.parse(raw); }
  catch (e) { throw new Abort(`${file} is not valid JSON (${e.message}) — left untouched`); }
}

// Pure: returns { next, added:[event], present:[event], removed:[event] } without mutating `obj`.
function plan(obj, agent, action) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Abort('config is not a JSON object — left untouched');
  const next = JSON.parse(JSON.stringify(obj));
  const added = [], present = [], removed = [];
  if (next.hooks !== undefined && (next.hooks === null || typeof next.hooks !== 'object' || Array.isArray(next.hooks)))
    throw new Abort('"hooks" is not an object — left untouched');
  if (action === 'install') {
    next.hooks = next.hooks || {};
    for (const ev of CLIS[agent].events) {
      if (next.hooks[ev] !== undefined && !Array.isArray(next.hooks[ev])) throw new Abort(`hooks.${ev} is not a list — left untouched`);
      const groups = next.hooks[ev] = next.hooks[ev] || [];
      if (groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs))) { present.push(ev); continue; }
      groups.push({ hooks: [{ type: 'command', command: commandFor(agent) }] });
      added.push(ev);
    }
    return { next, added, present, removed };
  }
  for (const ev of Object.keys(next.hooks || {})) {          // uninstall: scan every event, not just the table's
    if (!Array.isArray(next.hooks[ev])) continue;
    const before = next.hooks[ev].length;
    next.hooks[ev] = next.hooks[ev].map((g) => {
      if (!Array.isArray(g?.hooks)) return g;
      return { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) };
    }).filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
    if (next.hooks[ev].length !== before || JSON.stringify(next.hooks[ev]) !== JSON.stringify(obj.hooks[ev])) removed.push(ev);
    if (next.hooks[ev].length === 0) delete next.hooks[ev];
  }
  if (next.hooks && Object.keys(next.hooks).length === 0 && removed.length) delete next.hooks;
  return { next, added, present, removed };
}

function serialize(obj, raw) {                              // keep the file's own indent and trailing newline
  const indent = /^([ \t]+)"/m.exec(raw || '')?.[1] || '  ';
  return JSON.stringify(obj, null, indent) + (raw === undefined || raw.endsWith('\n') ? '\n' : '');
}

function writeAtomic(target, text) {
  const real = fs.existsSync(target) ? fs.realpathSync(target) : target;   // dotfile managers symlink these
  const mode = fs.existsSync(real) ? fs.statSync(real).mode & 0o777 : 0o600;
  const tmp = `${real}.termdeck-tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, real);
}

const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);

async function confirm(q) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(q, r));
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

async function main(argv) {
  const action = argv[0];
  if (action !== 'install' && action !== 'uninstall') usage('expected "install" or "uninstall"');
  let agent = 'all', dry = false, yes = false;
  for (let i = 1; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith('--') ? argv[i].split(/=(.*)/s) : [argv[i]];
    if (flag === '--dry-run') dry = true;
    else if (flag === '--yes' || flag === '-y') yes = true;
    else if (flag === '--agent') agent = inline !== undefined ? inline : argv[++i];
    else usage(`unknown argument "${argv[i]}"`);
  }
  if (agent !== 'all' && !CLIS[agent]) usage(`--agent must be claude, gemini, codex or all (got "${agent ?? ''}")`);
  const explicit = agent !== 'all';
  const targets = explicit ? [agent] : Object.keys(CLIS);
  const home = os.homedir();
  let failed = false;
  const work = [];

  for (const a of targets) {
    const c = CLIS[a], dir = path.join(home, c.dir), file = path.join(dir, c.file);
    const label = `${a} (${file.replace(home, '~')})`;
    if (!fs.existsSync(dir) && !explicit) { console.log(`  · ${a}: not installed (no ~/${c.dir}) — skipped`); continue; }
    try {
      const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
      const obj = raw === undefined || raw.trim() === '' ? {} : parseJson(file.replace(home, '~'), raw);
      const p = plan(obj, a, action);
      console.log(`\n  ${label}`);
      if (action === 'install') {
        p.added.forEach((e) => console.log(`    + ${e}  ${commandFor(a)}`));
        p.present.forEach((e) => console.log(`    = ${e}  already installed`));
        if (!p.added.length) { console.log('    nothing to do'); continue; }
      } else {
        p.removed.forEach((e) => console.log(`    - ${e}`));
        if (!p.removed.length) { console.log('    nothing to remove'); continue; }
      }
      work.push({ a, file, raw, p, label });
    } catch (e) {
      if (!(e instanceof Abort)) throw e;
      console.log(`\n  ${a}: ✗ ${e.message}`); failed = true;
    }
  }

  if (!work.length) { console.log(''); process.exit(failed ? 1 : 0); }
  if (dry) { console.log('\n  --dry-run: nothing written\n'); process.exit(failed ? 1 : 0); }
  if (!yes && !(await confirm(`\n  Apply to ${work.length} file${work.length === 1 ? '' : 's'}? A timestamped backup is made first. [y/N] `))) {
    console.log(process.stdin.isTTY ? '  Cancelled — nothing written.\n' : '\n  Not a terminal — re-run with --yes to apply. Nothing written.\n');
    process.exit(1);
  }
  for (const w of work) {
    fs.mkdirSync(path.dirname(w.file), { recursive: true });
    if (w.raw !== undefined) fs.copyFileSync(fs.realpathSync(w.file), `${w.file}.termdeck-bak-${stamp()}`);
    writeAtomic(w.file, serialize(w.p.next, w.raw));
    console.log(`  ✓ ${w.label} updated`);
  }
  console.log(action === 'install' ? '\n  Open a NEW termdeck terminal (older shells lack TD_ID) and start your agent there.\n' : '');
  process.exit(failed ? 1 : 0);
}

function usage(msg) {
  process.stderr.write(`termdeck hooks: ${msg}\n\nUsage:\n  termdeck hooks install   [--agent claude|gemini|codex|all] [--dry-run] [--yes]\n  termdeck hooks uninstall [--agent claude|gemini|codex|all] [--dry-run] [--yes]\n`);
  process.exit(2);
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error('  ✗', e.message); process.exit(1); });
module.exports = { CLIS, plan, commandFor, isOurs };
