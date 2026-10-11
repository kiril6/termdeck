// node scripts/secret-race.test.js — servers starting at the same moment on a fresh home all end up with the one
// secret in ~/.termdeck/token (a server holding a different one would reject every signed-in browser).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const N = 8, ROUNDS = 25;
const child = `const s = require(${JSON.stringify(path.join(__dirname, 'access'))}).loadOrCreateSecret(); process.stdout.write(s);`;
(async () => {
  for (let round = 0; round < ROUNDS; round++) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'td-race-'));
    try {
      const got = await Promise.all(Array.from({ length: N }, () => new Promise((ok, fail) => {
        const p = spawn(process.execPath, ['-e', child], { env: { ...process.env, HOME: home, USERPROFILE: home } });
        let out = ''; p.stdout.on('data', (d) => out += d); p.on('error', fail); p.on('exit', (c) => c ? fail(new Error('exit ' + c)) : ok(out));
      })));
      const onDisk = fs.readFileSync(path.join(home, '.termdeck', 'token'), 'utf8').trim();
      assert.ok(got.every((s) => s === onDisk), `round ${round}: ${new Set(got).size} different secrets for one home`);
      assert.deepStrictEqual(fs.readdirSync(path.join(home, '.termdeck')), ['token'], 'no temp files left');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }
  console.log(`secret-race.test: ok — ${ROUNDS} rounds × ${N} processes`);
})().catch((e) => { console.error(e); process.exit(1); });
