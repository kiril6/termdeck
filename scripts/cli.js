// Command-line handling for server.js (#59). Runs BEFORE the server boots, so flags simply become the
// env vars the rest of server.js already reads (flag wins over an existing env var).
// No argument-parsing dependency; unknown input prints help and exits 2.
const path = require('path');
const { spawnSync } = require('child_process');
const VERSION = require('../package.json').version;

const HELP = `termdeck ${VERSION} — browser cockpit for terminals and AI coding agents

Usage:
  termdeck [options]       start the server
  termdeck open            open the running dashboard in your browser and print its sign-in link (--no-open: print only)
  termdeck doctor          check this machine (offline) and exit; 0 = all good, 1 = warnings/failures
  termdeck hooks install   set up agent hooks for Claude Code / Gemini CLI / Codex / Copilot (also: uninstall, --dry-run, --yes)
  termdeck autostart install   start termdeck at login (launchd / systemd user unit; also: uninstall, --port, --dry-run)
  termdeck uninstall       remove hooks, start-at-login, termdeck's tmux sessions and ~/.termdeck (--dry-run, --yes)

Options:
  --port <n>     port to listen on (same as PORT; if set, never moves to a free one)
  --host <h>     address to bind (same as HOST; non-loopback uses a per-start access token)
  --no-open      don't open the browser (same as NO_OPEN=1)
  -v, --version  print the version
  -h, --help     print this help

Environment: see the README (TD_GRACE_MS, TD_BUFFER, TD_MAX_PANELS, TD_LOG_DIR, TD_ALLOWED_HOSTS, NO_TMUX…).

Feedback, ideas, bugs: https://github.com/kiril6/termdeck/discussions
                       https://github.com/kiril6/termdeck/issues
`;

function fail(msg) { process.stderr.write(`termdeck: ${msg}\n\n${HELP}`); process.exit(2); }

function applyArgs(argv) {
  const sub = { hooks: 'hooks.js', autostart: 'autostart.js', uninstall: 'uninstall.js' }[argv[0]];
  if (sub) {   // `termdeck hooks|autostart install|uninstall …`, `termdeck uninstall` — own flags, run synchronously so the server never starts
    const r = spawnSync(process.execPath, [path.join(__dirname, sub), ...argv.slice(1)], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  let doctor = false, open = false;
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith('--') ? argv[i].split(/=(.*)/s) : [argv[i]];
    const value = () => inline !== undefined ? inline : argv[++i];
    switch (flag) {
      case '-h': case '--help':    process.stdout.write(HELP); process.exit(0); break;
      case '-v': case '--version': process.stdout.write(VERSION + '\n'); process.exit(0); break;
      case '--no-open':            process.env.NO_OPEN = '1'; break;
      case '--port': {
        const v = value(), n = Number(v);
        if (!/^\d+$/.test(v || '') || n < 1 || n > 65535) fail(`--port needs a number from 1 to 65535 (got "${v ?? ''}")`);
        process.env.PORT = String(n); break;
      }
      case '--host': {
        const v = value();
        if (!v || v.startsWith('-')) fail('--host needs an address');
        process.env.HOST = v; break;
      }
      case 'doctor': doctor = true; break;
      case 'open':   open = true; break;
      default: fail(`unknown argument "${argv[i]}"`);
    }
  }
  if (open) openLink();
  if (doctor) {   // synchronous child so server.js never gets to start listening
    const r = spawnSync(process.execPath, [path.join(__dirname, 'doctor.js')], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
}

// `termdeck open`: the browser needs the /?t=… link once (it then keeps a cookie). Read the running server's URL from
// ~/.termdeck/server.json and the local secret from ~/.termdeck/token — both 0600, readable only by you.
function openLink() {
  const fs = require('fs'), os = require('os');
  let cur; try { cur = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.termdeck', 'server.json'), 'utf8')); } catch {}
  const alive = !!cur && (() => { try { process.kill(cur.pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } })();
  const say = (msg, code) => { process.stderr.write(`termdeck: ${msg}\n`); process.exit(code); };
  if (!alive || typeof cur.url !== 'string') say('no running server found — start it with `termdeck` (or `npm start`)', 1);
  if (cur.local === false) say('the server is in remote-access mode — use the link it printed when it started (that token changes on every start)', 1);
  const secret = require('./access').readSecret();
  if (!secret) say(`no access secret at ${require('./access').file()} — restart the server to create it`, 1);
  const link = `${cur.url}/?t=${secret}`;
  process.stdout.write(link + '\n');
  if (!process.env.NO_OPEN) require('./open-browser').openBrowser(link);
  process.exit(0);
}

module.exports = { applyArgs };
