// node scripts/json-store.test.js — two servers sharing one ~/.termdeck file keep each other's updates, see each
// other's writes, an unreadable file is kept aside instead of being overwritten, and a file in a newer format is read
// but never written back.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('./json-store');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-store-'));
const file = path.join(dir, 'items.json');
const opts = {
  parse: (j) => { if (j.items !== undefined && !Array.isArray(j.items)) throw new Error('items is not a list'); return { items: j.items || [] }; },
  serialize: (v) => ({ items: v.items }),
  version: 1,
};
const quiet = console.error; console.error = () => {};
try {
  const a = createStore(file, opts), b = createStore(file, opts);   // two servers, one home
  assert.deepStrictEqual(a.load(), { items: [] });
  assert.deepStrictEqual(b.load(), { items: [] });                  // b has a cached (empty) copy now
  a.update((d) => { d.items.push('from-a'); return true; });
  b.update((d) => { d.items.push('from-b'); return true; });        // must not overwrite a's update with its stale copy
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).items, ['from-a', 'from-b']);
  assert.deepStrictEqual(a.load().items, ['from-a', 'from-b']);     // a sees b's write without a restart
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);

  assert.strictEqual(a.update((d) => { d.items.push('nope'); return null; }), null);   // null cancels the write
  assert.deepStrictEqual(b.load().items, ['from-a', 'from-b']);

  fs.writeFileSync(file, '{"items": [broken');                       // hand-edit gone wrong
  assert.deepStrictEqual(a.load(), { items: [] });
  const kept = fs.readdirSync(dir).filter((f) => f.startsWith('items.json.corrupt-'));
  assert.strictEqual(kept.length, 1, 'corrupt file is kept aside');
  assert.strictEqual(fs.readFileSync(path.join(dir, kept[0]), 'utf8'), '{"items": [broken');
  a.update((d) => { d.items.push('fresh'); return true; });
  assert.deepStrictEqual(b.load().items, ['fresh']);

  fs.writeFileSync(file, '{"items": "not a list"}');                 // valid JSON, wrong shape: also kept aside
  assert.deepStrictEqual(b.load(), { items: [] });
  assert.strictEqual(fs.readdirSync(dir).filter((f) => f.startsWith('items.json.corrupt-')).length, 2);

  a.update((d) => { d.items = ['v1']; return true; });
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1, 'the store writes its format version');
  const newer = JSON.stringify({ version: 2, items: ['from-v2'], extra: { kept: true } });
  fs.writeFileSync(file, newer);                                     // a newer termdeck shares this home
  assert.deepStrictEqual(b.load().items, ['from-v2'], 'read as far as understood');
  assert.throws(() => b.update((d) => { d.items.push('x'); return true; }), (e) => e.code === 'ENEWER' && /newer termdeck/.test(e.message));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), newer, 'never written back');
  assert.strictEqual(fs.readdirSync(dir).filter((f) => f.startsWith('items.json.corrupt-')).length, 2, 'not treated as corrupt');

  const iso = Date.prototype.toISOString; Date.prototype.toISOString = () => '2026-01-01T00:00:00.000Z';   // all in one ms
  try { for (let i = 0; i < 3; i++) { fs.writeFileSync(file, 'x'.repeat(i + 1)); a.load(); } }   // must keep distinct names
  finally { Date.prototype.toISOString = iso; }
  assert.strictEqual(fs.readdirSync(dir).filter((f) => f.startsWith('items.json.corrupt-')).length, 5);
  console.log('json-store.test: ok');
} finally {
  console.error = quiet;
  fs.rmSync(dir, { recursive: true, force: true });
}
