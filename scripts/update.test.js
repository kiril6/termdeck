// node scripts/update.test.js — `termdeck update`: reports a newer release, refuses installs it cannot replace,
// and recognises a global npm install. The registry is a local stub (TD_UPDATE_URL); nothing is installed or restarted.
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { installKind } = require('./update');

const SERVER = path.join(__dirname, '..', 'server.js');
const run = (url, ...args) => new Promise((ok) => {   // async: the stub registry lives in this process
  const child = spawn(process.execPath, [SERVER, 'update', ...args], { env: { ...process.env, TD_UPDATE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => out += d); child.stderr.on('data', (d) => out += d);
  child.on('close', (code) => ok({ code, out }));
});

(async () => {
  const reg = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/new') res.end('{"version":"999.0.0"}');
    else if (req.url === '/same') res.end(JSON.stringify({ version: require('../package.json').version }));
    else { res.statusCode = 500; res.end(); }
  });
  await new Promise((ok) => reg.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${reg.address().port}`;

  let r = await run(base + '/same');
  assert.strictEqual(r.code, 0); assert.match(r.out, /is up to date/);

  r = await run(base + '/new', '--check');
  assert.strictEqual(r.code, 0); assert.match(r.out, /→ 999\.0\.0 is available/);

  r = await run(base + '/new', '--dry-run');   // this checkout is a clone, not a global npm install
  assert.strictEqual(r.code, 1); assert.match(r.out, /not installed with `npm install -g`/);

  r = await run(base + '/broken');
  assert.strictEqual(r.code, 1); assert.match(r.out, /could not ask the npm registry/);

  r = await run(base + '/new', '--nope');
  assert.strictEqual(r.code, 2);
  reg.close();

  const g = path.resolve(path.sep, 'g', 'lib', 'node_modules');
  assert.strictEqual(installKind(path.join(g, '@kiril6', 'termdeck'), g), 'npm');
  assert.strictEqual(installKind(path.resolve(path.sep, 'proj', 'node_modules', '@kiril6', 'termdeck'), g), 'other');   // local install
  assert.strictEqual(installKind(path.resolve(path.sep, 'repo'), g), 'other');
  assert.strictEqual(installKind(path.resolve(path.sep, 'x', '_npx', 'ab', 'node_modules', '@kiril6', 'termdeck'), g), 'npx');
  assert.strictEqual(installKind(path.join(g, '@kiril6', 'termdeck'), null), 'other');
  if (process.platform === 'win32') assert.strictEqual(installKind(path.join(g, '@kiril6', 'termdeck'), g.toUpperCase()), 'npm');
  console.log('update test passed');
})();
