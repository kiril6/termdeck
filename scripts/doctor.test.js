// node scripts/doctor.test.js — `termdeck doctor` checks the port the last run used (~/.termdeck/last-port) when PORT
// is unset, the pinned PORT when set, and 3000 otherwise, and says which one it checked.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-doctor-'));
fs.mkdirSync(path.join(home, '.termdeck'));
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const portLine = (env) => {
  let out;   // exits 1 on any warning (e.g. no tmux on CI), which is not what this test checks
  try { out = execFileSync(process.execPath, [path.join(__dirname, 'doctor.js')], { env: { ...process.env, HOME: home, HOST: '', NO_COLOR: '1', ...env }, encoding: 'utf8' }); }
  catch (e) { out = e.stdout; }
  return out.split('\n').find((l) => /\bPort\b/.test(l));
};

(async () => {
  const last = await free();
  fs.writeFileSync(path.join(home, '.termdeck', 'last-port'), `${last}\n`);
  assert.match(portLine({ PORT: '' }), new RegExp(`127\\.0\\.0\\.1:${last} \\(last run\\) is free`));

  const pinned = await free();
  assert.match(portLine({ PORT: String(pinned) }), new RegExp(`127\\.0\\.0\\.1:${pinned} \\(PORT\\) is free`));

  // The last run's port is busy (termdeck running there): a warning, not a failure.
  const busy = net.createServer();
  await new Promise((ok) => busy.listen(last, '127.0.0.1', ok));
  assert.match(portLine({ PORT: '' }), new RegExp(`! Port +127\\.0\\.0\\.1:${last} \\(last run\\) is in use`));
  busy.close();

  for (const bad of ['0', '70000', 'abc', '']) {   // invalid → ignored, default port
    fs.writeFileSync(path.join(home, '.termdeck', 'last-port'), bad);
    assert.match(portLine({ PORT: '' }), /127\.0\.0\.1:3000 \(default\)/);
  }
  fs.rmSync(home, { recursive: true, force: true });
  console.log('doctor port test passed');
})();
