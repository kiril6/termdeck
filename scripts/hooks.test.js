// node scripts/hooks.test.js — Copilot's flat hook file: install is idempotent, keeps foreign entries, uninstall removes only ours (#139)
const assert = require('assert');
const { plan, isOurs } = require('./hooks');

const first = plan({}, 'copilot', 'install');
assert.strictEqual(first.added.length, 6);
assert.strictEqual(Object.keys(first.next)[0], 'version');
assert.strictEqual(first.next.hooks.PermissionRequest[0].timeoutSec, 130);   // must outlive the ~125 s approval hold
assert.strictEqual(first.next.hooks.PreToolUse[0].timeoutSec, 5);
assert.deepStrictEqual(plan(first.next, 'copilot', 'install').added, []);    // idempotent

const foreign = { version: 1, hooks: { PreToolUse: [{ type: 'command', command: 'rtk hook copilot' }] } };
const merged = plan(foreign, 'copilot', 'install').next;
assert.strictEqual(merged.hooks.PreToolUse.length, 2);
const back = plan(merged, 'copilot', 'uninstall').next;
assert.deepStrictEqual(back.hooks.PreToolUse, foreign.hooks.PreToolUse);     // theirs untouched
assert.strictEqual(Object.keys(back.hooks).length, 1);
assert(!isOurs(foreign.hooks.PreToolUse[0]));
console.log('hooks ok');
