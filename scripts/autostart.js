#!/usr/bin/env node
// `termdeck autostart install|uninstall` (#64): run termdeck at login via a user-level launchd agent (macOS) or
// systemd user unit (Linux). Replaces hand-editing docs/autostart/. No root; never writes a secret into the file.
//   termdeck autostart install   [--port <n>] [--host <addr>] [--dry-run] [--yes]
//   termdeck autostart uninstall [--dry-run] [--yes]
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const LABEL = 'com.termdeck';
const UNIT = 'termdeck';
const SERVER = path.resolve(__dirname, '..', 'server.js');
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
const OWNED = /com\.termdeck|termdeck terminal dashboard/;   // our files, and the hand-copied docs templates

class Abort extends Error {}
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sdq = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`;

function which(cmd) { try { return execFileSync('which', [cmd], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch { return null; } }

// launchd/systemd start with a minimal PATH; give the service node's dir plus where tmux/git live (shells need them).
function servicePath() {
  const dirs = [path.dirname(process.execPath), ...['tmux', 'git'].map(which).filter(Boolean).map((p) => path.dirname(p)),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  return [...new Set(dirs)].join(':');
}

function renderPlist({ node, server, dir, port, host, log, svcPath }) {
  const env = [['NO_OPEN', '1'], ['PORT', String(port)], ...(host ? [['HOST', host]] : []), ['PATH', svcPath]]
    .map(([k, v]) => `    <key>${k}</key><string>${xml(v)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Managed by \`termdeck autostart\` — remove with \`termdeck autostart uninstall\` -->
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(server)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(dir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

function renderUnit({ node, server, dir, port, host, svcPath }) {
  const env = [['NO_OPEN', '1'], ['PORT', String(port)], ...(host ? [['HOST', host]] : []), ['PATH', svcPath]]
    .map(([k, v]) => sdq(`${k}=${v}`)).join(' ');
  return `# Managed by \`termdeck autostart\` — remove with \`termdeck autostart uninstall\`
[Unit]
Description=termdeck terminal dashboard
After=network.target

[Service]
ExecStart=${sdq(node)} ${sdq(server)}
WorkingDirectory=${dir.replace(/%/g, '%%')}
Environment=${env}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;
}

// The whole job as data: where the file goes, what it contains, and which commands run after (install) / before (uninstall).
function buildPlan(action, opts) {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const file = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    const domain = `gui/${process.getuid()}`;
    return {
      kind: 'launchd', file, logFile: path.join(home, 'Library', 'Logs', 'termdeck.log'),
      content: action === 'install' ? renderPlist({ ...opts, log: path.join(home, 'Library', 'Logs', 'termdeck.log') }) : null,
      before: [['launchctl', ['bootout', `${domain}/${LABEL}`], true]],                    // [cmd, args, ignoreFailure]
      after:  [['launchctl', ['bootstrap', domain, file], false]],
      hint: `Logs: ~/Library/Logs/termdeck.log`,
    };
  }
  if (process.platform === 'linux') {
    const file = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'systemd', 'user', `${UNIT}.service`);
    return {
      kind: 'systemd', file,
      content: action === 'install' ? renderUnit(opts) : null,
      before: [['systemctl', ['--user', 'disable', '--now', UNIT], true]],
      after:  [['systemctl', ['--user', 'daemon-reload'], false], ['systemctl', ['--user', 'enable', '--now', UNIT], false]],
      afterUninstall: [['systemctl', ['--user', 'daemon-reload'], true]],
      hint: `Logs: journalctl --user -u ${UNIT} -f   (start at boot, not just login: loginctl enable-linger "$USER")`,
    };
  }
  throw new Abort(`autostart supports macOS and Linux only — see docs/autostart/README.md for a manual setup`);
}

function exec([cmd, args, ignore]) {
  console.log(`    $ ${cmd} ${args.join(' ')}`);
  try { execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { if (!ignore) throw new Abort(`${cmd} failed: ${(e.stderr || e.message).toString().trim().split('\n')[0]}`); }
}

async function confirm(q) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(q, r));
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

function usage(msg) {
  process.stderr.write(`termdeck autostart: ${msg}\n\nUsage:\n  termdeck autostart install   [--port <n>] [--host <addr>] [--dry-run] [--yes]\n  termdeck autostart uninstall [--dry-run] [--yes]\n`);
  process.exit(2);
}

async function main(argv) {
  const action = argv[0];
  if (action !== 'install' && action !== 'uninstall') usage('expected "install" or "uninstall"');
  let port = 3000, host = null, dry = false, yes = false;
  for (let i = 1; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith('--') ? argv[i].split(/=(.*)/s) : [argv[i]];
    const value = () => inline !== undefined ? inline : argv[++i];
    if (flag === '--dry-run') dry = true;
    else if (flag === '--yes' || flag === '-y') yes = true;
    else if (flag === '--port' && action === 'install') { const v = value(); if (!/^\d+$/.test(v || '') || +v < 1 || +v > 65535) usage(`--port needs 1-65535 (got "${v ?? ''}")`); port = +v; }
    else if (flag === '--host' && action === 'install') { host = value(); if (!host || host.startsWith('-')) usage('--host needs an address'); }
    else usage(`unknown argument "${argv[i]}"`);
  }

  try {
    const node = process.execPath, server = SERVER, dir = path.dirname(SERVER);
    for (const p of [node, server, dir]) if (/[\n\r\0]/.test(p)) throw new Abort('a path contains a control character — refusing');
    if (action === 'install' && /[\\/]_npx[\\/]/.test(server))
      throw new Abort('this copy of termdeck lives in the temporary npx cache, which can be deleted. Install it first (npm i -g @kiril6/termdeck, or clone the repo) and run this from there.');

    const plan = buildPlan(action, { node, server, dir, port, host, svcPath: servicePath() });
    const shown = plan.file.replace(os.homedir(), '~');
    const exists = fs.existsSync(plan.file);
    const current = exists ? fs.readFileSync(plan.file, 'utf8') : null;
    if (exists && !OWNED.test(current)) throw new Abort(`${shown} exists but wasn't created for termdeck — move it aside first`);

    if (action === 'install') {
      if (host && !LOOPBACK.includes(host))
        console.log(`\n  ⚠ HOST=${host} exposes shells to the network. The access token is regenerated on every start and printed to the log,\n    so unattended remote use is fragile — prefer the loopback bind plus a tunnel (docs/remote-access.md).`);
      console.log(`\n  ${plan.kind}: ${shown}${current === plan.content ? '  (already up to date)' : exists ? '  (will be replaced)' : ''}\n`);
      console.log(plan.content.split('\n').map((l) => '    ' + l).join('\n'));
      console.log('  Then runs:');
      [...plan.before, ...plan.after].forEach(([c, a]) => console.log(`    $ ${c} ${a.join(' ')}`));
    } else {
      if (!exists) { console.log(`\n  Nothing to remove — ${shown} does not exist.\n`); process.exit(0); }
      console.log(`\n  ${plan.kind}: will stop the service and delete ${shown}\n`);
      plan.before.forEach(([c, a]) => console.log(`    $ ${c} ${a.join(' ')}`));
    }
    if (dry) { console.log('\n  --dry-run: nothing written, nothing run\n'); process.exit(0); }
    if (!yes && !(await confirm(`\n  Proceed? [y/N] `))) {
      console.log(process.stdin.isTTY ? '  Cancelled.\n' : '\n  Not a terminal — re-run with --yes to apply. Nothing changed.\n');
      process.exit(1);
    }

    console.log('');
    if (action === 'install') {
      fs.mkdirSync(path.dirname(plan.file), { recursive: true });
      if (current !== plan.content) fs.writeFileSync(plan.file, plan.content);
      if (plan.logFile) {                                // launchd would create it world-readable; a non-loopback start logs the token URL
        fs.mkdirSync(path.dirname(plan.logFile), { recursive: true });
        fs.closeSync(fs.openSync(plan.logFile, 'a', 0o600)); fs.chmodSync(plan.logFile, 0o600);
      }
      plan.before.forEach(exec);                       // reload cleanly so a changed file takes effect; failure = wasn't loaded
      plan.after.forEach(exec);
      console.log(`\n  ✓ termdeck will start at login → http://127.0.0.1:${port}\n    ${plan.hint}\n`);
    } else {
      plan.before.forEach(exec);
      fs.rmSync(plan.file);
      (plan.afterUninstall || []).forEach(exec);
      console.log(`\n  ✓ removed ${shown}\n`);
    }
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    console.error(`\n  ✗ ${e.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error('  ✗', e.message); process.exit(1); });
module.exports = { renderPlist, renderUnit };
