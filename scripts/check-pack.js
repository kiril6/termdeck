// node scripts/check-pack.js — the npm package lists its runtime scripts one by one (no tests, fixtures or dev
// tools). Fail if a shipped file requires or names a scripts/*.js file that is not shipped, or ships a dev file.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packed = new Set(JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, shell: process.platform === 'win32' }))[0].files.map((f) => f.path));
const problems = [];
for (const f of packed) {
  if (/\.test\.js$|^scripts\/(check-|build-demo|release|fixtures\/)/.test(f)) problems.push(`dev file shipped: ${f}`);
  if (!f.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(root, f), 'utf8'), dir = path.posix.dirname(f);
  // require('./x') and bare 'x.js' literals (spawned / path.join'd helpers, e.g. { hooks: 'hooks.js' })
  const refs = [...src.matchAll(/require\(\s*'(\.{1,2}\/[^']+)'\s*\)/g)].map((m) => path.posix.join(dir, m[1]))
    .concat([...src.matchAll(/'([\w-]+\.js)'/g)].map((m) => path.posix.join(dir === '.' ? 'scripts' : dir, m[1])));
  for (let r of refs) {
    if (!r.endsWith('.js') && !r.endsWith('.json')) r += '.js';
    if (fs.existsSync(path.join(root, r)) && !packed.has(r)) problems.push(`${f} needs ${r}, which is not in package.json "files"`);
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`check-pack: ok — ${packed.size} files`);
