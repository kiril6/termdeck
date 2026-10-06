// Builds the README scene: a shop-api project + three agent worktrees with real changes.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO_DIR, evt, palette, typeIn, sleep } = require('./lib');
const WT = REPO_DIR + '-worktrees';
const GENV = { ...process.env, GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'dev@example.com' };
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, env: GENV, stdio: 'pipe' }).toString();
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

const AGENTS = [
  { branch: 'agent/retry-backoff', agent: 'claude' },
  { branch: 'agent/webhook-signing', agent: 'codex' },
  { branch: 'agent/rate-limit', agent: 'gemini' },
];

async function newTask(page, branch) {
  await palette(page, 'New agent task');
  await page.getByPlaceholder('agent/fix-login').fill(branch);
  await page.locator('select').last().selectOption({ label: 'demo agent' });
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByText('Worktree ready').last().waitFor();
  await sleep(600);
}

function edits() {
  const r = WT + '/agent-retry-backoff', w = WT + '/agent-webhook-signing', l = WT + '/agent-rate-limit';
  write(r + '/src/backoff.js', `// Exponential backoff with full jitter.
export function delay(attempt, base = 200, cap = 5000) {
  return Math.min(cap, base * 2 ** attempt);
}
`);
  write(r + '/src/client.js', fs.readFileSync(r + '/src/client.js', 'utf8').replace(
`  const res = await fetch(PROVIDER_URL + '/charges', {
    method: 'POST',
    body: JSON.stringify({ amount: order.total, currency: order.currency }),
  });
  if (!res.ok) throw new Error('charge failed: ' + res.status);
  return res.json();`,
`  for (let attempt = 0; ; attempt++) {
    const res = await fetch(PROVIDER_URL + '/charges', {
      method: 'POST',
      headers: { 'Idempotency-Key': order.id },
      body: JSON.stringify({ amount: order.total, currency: order.currency }),
    });
    if (res.ok) return res.json();
    if (res.status < 500 || attempt === 4) throw new Error('charge failed: ' + res.status);
    await new Promise((ok) => setTimeout(ok, delay(attempt)));
  }`).replace('// HTTP client', "import { delay } from './backoff.js';\n\n// HTTP client"));
  write(r + '/test/backoff.test.js', `import { test } from 'node:test';
import assert from 'node:assert';
import { delay } from '../src/backoff.js';
test('backoff doubles each attempt', () => assert.deepEqual([0, 1, 2].map((a) => delay(a)), [200, 400, 800]));
test('backoff is capped', () => assert.equal(delay(10), 5000));
`);
  git(r, 'add', '.'); git(r, 'commit', '-qm', 'Retry failed charges with exponential backoff');
  write(w + '/src/webhooks.js', `import { createHmac, timingSafeEqual } from 'node:crypto';

// Incoming provider webhooks — rejected unless the signature matches.
export function handleWebhook(req, secret) {
  const sig = Buffer.from(req.headers['x-signature'] || '', 'hex');
  const want = createHmac('sha256', secret).update(req.body).digest();
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) throw new Error('bad signature');
  const event = JSON.parse(req.body);
  return { type: event.type, id: event.id };
}
`);
  write(l + '/src/client.js', fs.readFileSync(l + '/src/client.js', 'utf8').replace(
`  const res = await fetch(PROVIDER_URL + '/charges', {`,
`  await limiter.take();   // provider allows 25 req/s
  const res = await fetch(PROVIDER_URL + '/charges', {`).replace('// HTTP client', "import { limiter } from './limiter.js';\n\n// HTTP client"));
  write(l + '/src/limiter.js', `// Token bucket: 25 requests per second.
export const limiter = { take: async () => {} };
`);
}

async function build(page, ids) {
  // shop-api project via the Dir popover, then drop the default one.
  await page.locator('#folder').click();
  await page.locator('#cwd-input').fill(REPO_DIR);
  await page.locator('#cwd-proj').click();
  await sleep(800);
  await page.locator('.ptab', { hasText: 'default' }).locator('.pdel').click({ force: true });
  await page.locator('.cm-ok').click();
  await sleep(500);
  for (const a of AGENTS) await newTask(page, a.branch);
  edits();
  const idOf = (branch) => ids.find((x) => x.cwd === WT + '/' + branch.replace('/', '-')).id;
  for (const a of AGENTS) a.id = idOf(a.branch);
  return AGENTS;
}
module.exports = { build, AGENTS, WT, git, sleep };

// Terminal content + agent state. Returns a function that fires the held approval (resolves with the decision).
async function stage(page, A) {
  const [retry, hook, rate] = A;
  await page.locator('#sb-btn').click();   // tree first, so Tile lays out around it
  await sleep(400);
  const proj = (name) => page.locator('.ptab', { hasText: name }).click();
  const shell = async (name, cmd, tabName) => {
    await proj(name); await sleep(300); await page.locator('#tile').click(); await sleep(300);
    const win = page.locator('.win:visible').first();
    if (tabName) { await win.locator('.wt-name').first().dblclick(); await page.keyboard.type(tabName); await page.keyboard.press('Enter'); }
    await typeIn(page, win, cmd + '\n'); await sleep(900);
  };
  await shell('shop-api', 'git log --oneline --graph --all', 'main');
  await shell('agent/webhook-signing', 'git diff --stat && git diff src/webhooks.js | head -20', 'codex');
  await shell('agent/rate-limit', 'git diff', 'gemini');
  await shell('agent/retry-backoff', 'git log --oneline -3 && npm test 2>&1 | head -12', 'claude');
  await evt(hook.id, { type: 'prompt_submit', agent: 'codex' });
  await evt(hook.id, { type: 'stop', agent: 'codex', tokens: 184200, cacheTokens: 2210000 });
  await evt(hook.id, { type: 'tool_start', agent: 'codex', tool: 'apply_patch', files: ['src/webhooks.js'] });
  await evt(rate.id, { type: 'prompt_submit', agent: 'gemini' });
  await evt(rate.id, { type: 'stop', agent: 'gemini' });
  await evt(retry.id, { type: 'prompt_submit', agent: 'claude' });
  await evt(retry.id, { type: 'stop', agent: 'claude', tokens: 361400, cacheTokens: 5120000 });
  await evt(retry.id, { type: 'tool_start', agent: 'claude', tool: 'Bash', detail: 'npm test' });
  return () => evt(retry.id, { type: 'permission_request', agent: 'claude', tool: 'Bash', detail: 'npm install p-retry@6', command: 'npm install p-retry@6', cwd: WT + '/agent-retry-backoff', wait: true }).then((r) => r.status === 200 ? r.json() : r.status);
}
module.exports.stage = stage;

const clearToasts = (page) => page.evaluate(() => document.querySelectorAll('.toast .t-close').forEach((x) => x.click()));
// Full scene, settled: radar has polled, stray nudges have fired and been dismissed. Active project = retry-backoff, tree open.
async function prepare(page, ids) {
  const A = await build(page, ids);
  const ask = await stage(page, A);
  await sleep(22000);
  await clearToasts(page);
  await sleep(400);
  return { A, ask };
}
Object.assign(module.exports, { prepare, clearToasts });
