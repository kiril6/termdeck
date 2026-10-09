const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STATE = 'td.state.v5';
const palette = (page) => page.locator('#palette');
const labels = (page) => page.locator('#pal-list .pi-label');

// Skip the first-run tour.
async function boot(page, url) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('td-tour-done', '1'));
  await page.goto(url);
  await expect(page.locator('.win')).toHaveCount(1);   // a fresh visit opens one terminal
  return errors;
}
const treeMenu = async (page, label) => { await page.locator('#sb-more-btn').click(); await page.locator('.ctxmenu .ctx-item', { hasText: label }).click(); };
const openPalette = async (page) => { await page.keyboard.press('ControlOrMeta+k'); await expect(palette(page)).toHaveClass(/open/); };

test.describe('demo mode (no backend)', () => {
  test('loads with no console errors', async ({ page }) => {
    const errors = await boot(page, '/?demo');
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('palette: opens, category chips filter, agent task needs a backend in demo', async ({ page }) => {
    await boot(page, '/?demo');
    await openPalette(page);
    await expect(labels(page).filter({ hasText: 'New terminal' })).toHaveCount(1);
    await page.locator('#pal-cats .pal-cat', { hasText: /^Agents$/ }).click();
    await expect(labels(page).filter({ hasText: 'New agent task' })).toHaveCount(1);
    await expect(labels(page).filter({ hasText: /^New terminal$/ })).toHaveCount(0);
    await page.locator('#pal-input').fill('agent task');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Agent worktrees need a backend')).toBeVisible();
  });

  test('two terminals: tile, close one, layout survives reload', async ({ page }) => {
    await boot(page, '/?demo');
    await page.locator('#new').click();
    await expect(page.locator('.win')).toHaveCount(2);
    await page.locator('#tile').click();
    const [a, b] = await page.locator('.win').evaluateAll((w) => w.map((x) => x.getBoundingClientRect().toJSON()));
    expect(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1).toBe(true);   // tiled = no overlap
    await page.locator('.win').first().locator('.win-ctrls .wbtn.close').click();
    await expect(page.locator('.win')).toHaveCount(1);   // idle demo shell: no confirm dialog
    await page.waitForTimeout(500);                      // saveState is debounced 300ms
    await page.reload();
    await expect(page.locator('.win')).toHaveCount(1);
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).sessions.length, STATE)).toBe(1);
  });

  test('Layout ▾ menu arranges windows; empty palette is short and remembers recent', async ({ page }) => {
    await boot(page, '/?demo');
    await page.locator('#new').click();
    await expect(page.locator('.win')).toHaveCount(2);
    await page.locator('#layout-caret').click();
    await page.locator('.ctxmenu .ctx-item', { hasText: /^1×1$/ }).click();
    await expect(page.locator('.win:visible')).toHaveCount(1);         // extra window minimized
    await openPalette(page);
    await expect(labels(page).filter({ hasText: /^Layout / })).toHaveCount(0);   // layouts aren't in the empty palette
    await expect(page.locator('#pal-list .pal-group', { hasText: 'Recent' })).toHaveCount(0);
    await page.locator('#pal-input').fill('2x2');                       // "x" finds "×"
    await expect(labels(page)).toHaveText(['Layout 2×2']);
    await page.keyboard.press('Enter');
    await expect(page.locator('.win:visible')).toHaveCount(1);         // 2×2 doesn't un-minimize
    await openPalette(page);
    await expect(page.locator('#pal-list .pal-group').first()).toHaveText('Recent');
    await expect(labels(page).first()).toHaveText('Layout 2×2');
  });

  test('Sessions button: Queue | Grid toggle', async ({ page }) => {
    await boot(page, '/?demo');
    await page.locator('#agent-btn').click();
    await expect(page.locator('#agent-pop')).toHaveClass(/open/);
    await page.locator('#agent-to-grid').click();
    await expect(page.locator('#ov-overlay')).toHaveClass(/open/);
    await expect(page.locator('#agent-pop')).not.toHaveClass(/open/);
    await page.locator('#ov-to-queue').click();
    await expect(page.locator('#ov-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#agent-pop')).toHaveClass(/open/);
  });
});

test.describe('layout presets + Alt+N (#51)', () => {
  test('1×1 minimizes extras; Alt+2 restores/focuses the 2nd window', async ({ page }) => {
    await boot(page, '/?demo');
    await page.locator('#new').click();
    await page.locator('#new').click();
    await expect(page.locator('.win')).toHaveCount(3);
    await openPalette(page);
    await page.locator('.pal-cat', { hasText: 'Layout' }).click();
    await expect(page.locator('.pal-item')).toHaveCount(6);           // Tile windows + 5 presets
    await page.keyboard.type('Layout 2×2');
    await page.keyboard.press('Enter');
    await expect(page.locator('.win:visible')).toHaveCount(3);        // 3 windows fit a 2×2
    await openPalette(page);
    await page.keyboard.type('Layout 1×1');
    await page.keyboard.press('Enter');
    await expect(page.locator('.win:visible')).toHaveCount(1);        // extras minimized, not closed
    await expect(page.locator('.win')).toHaveCount(3);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Alt+2');
    await expect(page.locator('.win:visible')).toHaveCount(2);        // Alt+2 restored the 2nd window
  });
});

test('hosted demo copy matches a fresh npm run build:demo', () => {
  const f = path.join(ROOT, 'docs', 'app', 'index.html');
  const before = fs.readFileSync(f, 'utf8');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-demo.js')], { stdio: 'ignore' });
  const after = fs.readFileSync(f, 'utf8');
  if (after !== before) fs.writeFileSync(f, before);   // leave the tree as we found it
  expect(after === before, 'docs/app/index.html is stale — run npm run build:demo').toBe(true);
});

test.describe('live backend', () => {
  test('agent queue: red → amber → working, badge follows', async ({ page, request }) => {
    const ids = [];
    page.on('websocket', (ws) => { const m = /[?&]id=([^&]+)/.exec(ws.url()); if (m) ids.push(decodeURIComponent(m[1])); });
    await boot(page, '/');
    await expect.poll(() => ids.length).toBe(1);
    const id = ids[0];                                           // the first event tags this terminal as an agent
    const badge = page.locator('#agent-badge');
    const send = async (type, extra = {}) => expect((await request.post('/api/agent-events', { data: { id, type, agent: 'claude', ...extra } })).status()).toBe(204);

    await send('tool_start', { tool: 'Bash', detail: 'ls' });
    await expect(badge).toHaveClass(/(^|\s)working(\s|$)/);
    await send('permission_request', { tool: 'Bash', detail: 'rm -rf build' });
    await expect(badge).toHaveClass(/(^|\s)approval(\s|$)/);
    await send('tool_start', { tool: 'Bash', detail: 'ls' });   // you answered in the terminal → agent moved on
    await expect(badge).toHaveClass(/(^|\s)working(\s|$)/);
    await send('stop');
    await expect(badge).toHaveClass(/(^|\s)waiting(\s|$)/);
    await send('tool_start', { tool: 'Read' });
    await expect(badge).toHaveClass(/(^|\s)working(\s|$)/);

    await page.locator('#agent-btn').click();                    // queue lists the tab
    await expect(page.locator('.agent-row')).toHaveCount(1);
  });

  test('#t=<id> deep link focuses that terminal', async ({ page }) => {
    const ids = [];
    page.on('websocket', (ws) => { const m = /[?&]id=([^&]+)/.exec(ws.url()); if (m) ids.push(decodeURIComponent(m[1])); });
    await boot(page, '/');
    await expect.poll(() => ids.length).toBe(1);
    await page.evaluate((id) => { location.hash = '#t=' + id; }, ids[0]);
    await expect(page.locator('.win.blink')).toHaveCount(1);
  });

  test('footer shows the last command and a detected localhost port (#22)', async ({ page }) => {
    await boot(page, '/');
    await page.locator('.win .xterm').first().click({ force: true });
    await page.keyboard.type("node -e \"console.log('listening on http://localhost:4321');setTimeout(()=>{},3000)\"\n");
    await expect(page.locator('.win .badge.cmd').first()).toContainText('listening on');
    await expect(page.locator('.win .badge.port').first()).toHaveText(':4321');
    await expect(page.locator('.win .badge.port').first()).toHaveText('', { timeout: 8000 });   // prompt back → server gone
    await page.keyboard.type('echo hi\x7fey\n');                                           // backspace edits are honoured
    await expect(page.locator('.win .badge.cmd').first()).toHaveText('$ echo hey');
  });

  test('version shown; no toast on first visit; "Updated" toast once per version opens What\'s new (#88)', async ({ page, request }) => {
    const { version } = await (await request.get('/api/version')).json();
    await boot(page, '/');
    await expect(page.locator('.hint .copyr')).toContainText('v' + version);
    await page.waitForTimeout(500);
    await expect(page.locator('.toast', { hasText: 'Updated to' })).toHaveCount(0);        // first visit stays quiet
    expect(await page.evaluate(() => localStorage.getItem('td.seenVersion.v1'))).toBe(version);

    await page.evaluate(() => localStorage.setItem('td.seenVersion.v1', '0.0.1'));         // simulate an upgrade
    await page.reload();
    await page.locator('.toast', { hasText: 'Updated to v' + version }).click();
    await expect(page.locator('#sc-overlay.open')).toBeVisible();
    await expect(page.locator('#sc-whatsnew')).toHaveJSProperty('open', true);
    await expect(page.locator('#wn-body')).toContainText('Phone notifications');           // bundled CHANGELOG.md, no network
    await page.reload();
    await page.waitForTimeout(500);
    await expect(page.locator('.toast', { hasText: 'Updated to' })).toHaveCount(0);        // once per version
  });

  test('Help → Check for updates reports available / current / unreachable (#88)', async ({ page }) => {
    await boot(page, '/');
    await page.locator('#sc-btn').click();
    const res = page.locator('#upd-res');
    const reply = (body, status = 200) => page.route('**/api/update-check', (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
    await reply({ current: '1.18.0', latest: '9.9.9', updateAvailable: true });
    await page.locator('#upd-btn').click();
    await expect(res).toContainText('v9.9.9 is available');
    await expect(res).toContainText('npx @kiril6/termdeck@latest');
    await page.unroute('**/api/update-check');
    await reply({ current: '1.18.0', latest: '1.18.0', updateAvailable: false });
    await page.locator('#upd-btn').click();
    await expect(res).toContainText('up to date');
    await page.unroute('**/api/update-check');
    await reply({ error: 'x' }, 502);
    await page.locator('#upd-btn').click();
    await expect(res).toContainText('Couldn');
  });

  test('live overview shows each session\'s output as a tile; click jumps; Esc closes (#25)', async ({ page }) => {
    await boot(page, '/');
    await page.locator('.win .xterm').first().click({ force: true });
    await page.keyboard.type('echo OVERVIEW_$((6*7))\n');
    await openPalette(page);
    await page.locator('#pal-input').fill('Live overview');
    await expect(page.locator('.pal-item.hi', { hasText: 'Live overview' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#ov-overlay.open .ov-tile')).toHaveCount(1);
    await expect(page.locator('.ov-out').first()).toContainText('OVERVIEW_42', { timeout: 5000 });
    await page.locator('.ov-tile').first().click();
    await expect(page.locator('#ov-overlay.open')).toHaveCount(0);
    await openPalette(page);
    await page.locator('#pal-input').fill('Live overview');
    await expect(page.locator('.pal-item.hi', { hasText: 'Live overview' })).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('#ov-overlay.open')).toHaveCount(0);
  });

  test('terminal runs a command; reload reattaches and replays the buffer', async ({ page }) => {
    const frames = [];
    page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
    await boot(page, '/');
    await expect.poll(() => frames.length).toBeGreaterThan(0);
    await page.locator('.win .xterm').first().click({ force: true });   // the link layer canvas sits on top
    await page.keyboard.type('echo ok-$((20+22))\n');
    await expect.poll(() => frames.join('').includes('ok-42')).toBe(true);
    await page.waitForTimeout(500);                             // let the layout save so the reload reuses the same terminal id
    frames.length = 0;
    await page.reload();
    await expect.poll(() => frames.join('').includes('ok-42')).toBe(true);   // replayed from the server's ring buffer, not re-run
  });

  test('prompt returning is detected: a finished command in an unwatched window toasts "Done"', async ({ page }) => {
    await boot(page, '/');
    await page.waitForTimeout(3500);                            // let the first prompt's 3 s notification cooldown pass
    await page.locator('.win .xterm').first().click({ force: true });
    await page.keyboard.type('sleep 2\n');
    await page.locator('#new').click();                         // focus moves to a new window, so the first is unwatched
    await expect(page.locator('.toast', { hasText: 'Done' })).toContainText('finished in', { timeout: 8000 });   // zsh/bash wrap the prompt in escape codes
  });

  test('new agent task: bad branch name is rejected, a good one creates a worktree project', async ({ page }) => {
    await boot(page, '/');
    await page.locator('#folder').click();                       // pick the repo dir → becomes the project's cwd
    await page.locator('#cwd-input').fill(process.env.TD_E2E_HOME);
    await page.keyboard.press('Enter');
    await expect(page.locator('.win')).toHaveCount(2);
    const ask = async (branch) => {
      await openPalette(page);
      await page.locator('#pal-input').fill('New agent task');
      await expect(page.locator('.pal-item.hi', { hasText: 'New agent task' })).toBeVisible();   // Enter only runs the highlighted row once filtering has settled (slow CI)
      await page.keyboard.press('Enter');
      await page.getByPlaceholder('agent/fix-login').fill(branch);
      await page.getByRole('button', { name: 'Create' }).click();
    };
    await ask('bad name..x');
    await expect(page.getByText('Couldn’t create worktree')).toBeVisible();
    await ask('agent/e2e');
    await expect(page.getByText('Worktree ready')).toBeVisible();
  });
  test('tree follows the focused terminal when "Follow" is on (reveal only, no re-root)', async ({ page }) => {
    const proj = path.join(fs.realpathSync(process.env.TD_E2E_HOME), 'follow-proj');   // real path: the live-cwd poll (lsof) reports resolved paths, /var → /private/var on macOS
    for (const d of ['alpha/inner', 'beta']) fs.mkdirSync(path.join(proj, d), { recursive: true });
    await boot(page, '/');                                        
    const spawnAt = async (dir, n) => {
      await page.locator('#folder').click();
      await page.locator('#cwd-input').fill(dir);
      await page.keyboard.press('Enter');
      await expect(page.locator('.win')).toHaveCount(n);
    };
    await spawnAt(proj, 2);                                       // first shell with a cwd anchors the tree root
    await spawnAt(path.join(proj, 'alpha/inner'), 3);
    await spawnAt(path.join(proj, 'beta'), 4);
    await page.locator('#sb-btn').click();
    await treeMenu(page, 'Follow focused terminal');
    const here = page.locator('.tn.here');
    await page.locator('.chip').nth(2).click();                     // alpha/inner
    await expect(here).toHaveAttribute('data-path', /follow-proj\/alpha\/inner$/);
    await page.locator('.chip').nth(3).click();                     // beta
    await expect(here).toHaveAttribute('data-path', /follow-proj\/beta$/);
    await expect(here).toHaveCount(1);
    await treeMenu(page, 'Follow focused terminal');                 // off → highlight gone, auto-opened folders collapse
    await expect(here).toHaveCount(0);
    await expect(page.locator('.tn.dir-node.open')).toHaveCount(0);   // folders follow opened are collapsed again
  });
  test('tree ↑ goes up one level; ⌂ returns to the project root', async ({ page }) => {
    await boot(page, '/');
    await page.locator('#folder').click();                       // first shell with a cwd anchors the project root
    await page.locator('#cwd-input').fill(process.env.TD_E2E_HOME);
    await page.keyboard.press('Enter');
    await expect(page.locator('.win')).toHaveCount(2);
    await page.locator('#sb-btn').click();
    const crumbs = page.locator('#sb-title .crumb');
    await expect(crumbs.last()).toHaveText(path.basename(process.env.TD_E2E_HOME));
    const n = await crumbs.count();
    await page.locator('#sb-up-btn').click();
    await expect(crumbs).toHaveCount(n - 1);
    await treeMenu(page, 'Back to project root');           // ⌂ → project root again
    await expect(crumbs).toHaveCount(n);
  });
});
