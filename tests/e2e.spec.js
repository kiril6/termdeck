const { test, expect, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const AxeBuilder = require('@axe-core/playwright').default;

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
// Keep a handle on the app's xterm instances (the app runs inside an IIFE): window.__terms, in creation order.
const trackTerms = (page) => page.addInitScript(() => {
  let T; Object.defineProperty(window, 'Terminal', { configurable: true, get: () => T,
    set: (v) => { T = class extends v { constructor(o) { super(o); (window.__terms ||= []).push(this); } }; } });
});
const treeMenu = async (page, label) => { await page.locator('#sb-more-btn').click(); await page.locator('.ctxmenu .ctx-item', { hasText: label }).click(); };
const openPalette = async (page) => { await page.keyboard.press('ControlOrMeta+k'); await expect(palette(page)).toHaveClass(/open/); };

test.describe('demo mode (no backend)', () => {
  test('window clocks: one shared tick; a minimized window pauses and catches up when restored', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));        // paused before the app starts: its start time and its 1 s tick are pinned
    await boot(page, '/?demo');
    const up = page.locator('.win .uptime').first();
    await page.clock.runFor(3000);
    await expect(up).toHaveText('00:03');
    await page.locator('.win .wbtn[title="Minimize"]').first().click();
    await page.clock.runFor(5000);
    expect(await up.textContent()).toBe('00:03');                       // hidden: not touched
    await page.locator('.chip').first().click();                        // restore from the dock
    await page.clock.runFor(1000);
    await expect(up).toHaveText('00:09');
  });

  test('loads with no console errors', async ({ page }) => {
    const errors = await boot(page, '/?demo');
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('wide characters use Unicode 11 widths (an emoji takes two cells)', async ({ page }) => {
    await trackTerms(page);
    await boot(page, '/?demo');
    const r = await page.evaluate(() => new Promise((ok) => {
      const t = window.__terms[0];
      t.write('\r\n\u{1F642}', () => ok({ version: t.unicode.activeVersion, x: t.buffer.active.cursorX }));
    }));
    expect(r).toEqual({ version: '11', x: 2 });
  });

  test('xterm 6 scrollbar: thin, under the resize grips, wheel scrolls; resize snaps flush to the last row', async ({ page }) => {
    await trackTerms(page);
    await boot(page, '/?demo');
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(ok)));   // the app fits a new terminal on the next frame; measure after it
    await page.evaluate(() => new Promise((ok) => window.__terms[0].write(Array.from({ length: 200 }, (_, i) => 'line ' + i).join('\r\n'), ok)));
    const win = page.locator('.win').first();
    const bar = win.locator('.xterm-scrollable-element > .scrollbar.vertical');
    expect(await bar.evaluate((e) => e.offsetWidth)).toBe(10);
    const textRight = await page.evaluate(() => {   // the last column ends where the scrollbar starts, not under it
      const t = window.__terms[0];
      return t.element.querySelector('.xterm-screen').getBoundingClientRect().left + t.cols * t._core._renderService.dimensions.css.cell.width;
    });
    expect(textRight).toBeLessThanOrEqual((await bar.boundingBox()).x + 0.5);
    const box = await win.locator('.xterm-screen').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(() => page.evaluate(() => { const b = window.__terms[0].buffer.active; return b.viewportY < b.baseY; })).toBe(true);
    await expect(bar).toHaveClass(/\bvisible\b/);
    // The east grip overlaps the scrollbar's outer edge: there, the grip must win.
    const [g, sb] = [await win.locator('.wgrip-e').boundingBox(), await bar.boundingBox()];
    const x = Math.max(g.x, sb.x) + 0.5, y = g.y + g.height / 2;
    expect(x).toBeLessThan(Math.min(g.x + g.width, sb.x + sb.width));
    expect(await page.evaluate(([px, py]) => document.elementFromPoint(px, py).className, [x, y])).toContain('wgrip-e');
    const se = await win.locator('.wgrip-se').boundingBox();
    await page.mouse.move(se.x + 5, se.y + 5); await page.mouse.down();
    await page.mouse.move(se.x + 45, se.y + 37, { steps: 4 }); await page.mouse.up();   // an arbitrary height: not a whole number of rows
    expect(await win.evaluate((w) => w.querySelector('.xterm-viewport').clientHeight - w.querySelector('.xterm-screen').clientHeight)).toBe(0);
  });

  test('Alt/Option+Left/Right send word jumps (xterm 6 no longer maps them)', async ({ page }) => {
    await trackTerms(page);
    await boot(page, '/?demo');
    await page.locator('.win .xterm').first().click({ force: true });
    const platform = await page.evaluate(() => { window.__out = []; window.__terms[0].onData((d) => window.__out.push(d)); return navigator.userAgentData?.platform || navigator.platform; });
    await page.keyboard.press('Alt+ArrowLeft'); await page.keyboard.press('Alt+ArrowRight');
    const mac = /Mac/i.test(platform);   // same test the app uses: macOS shells want ESC b / ESC f
    expect(await page.evaluate(() => window.__out)).toEqual(mac ? ['\x1bb', '\x1bf'] : ['\x1b[1;5D', '\x1b[1;5C']);
  });

  // A layout saved by an older build must keep loading. If this fails, the saved format changed: add a migration from
  // this shape (and keep this blob) instead of editing it, or every user's layout is dropped on upgrade.
  test('a td.state.v5 layout saved by an older build restores exactly', async ({ page }) => {
    const v5 = {
      activeProject: 'p2',
      projects: [{ id: 'p1', name: 'api', root: null, base: null, baseBranch: null }, { id: 'p2', name: 'web', root: null, base: null, baseBranch: null }],
      sessions: [
        { id: 's1', project: 'p1', name: 'server', cwd: '', themeId: null, isLog: false, left: '40px', top: '30px', width: '500px', height: '300px', minimized: false, maximized: false, prevRect: null, glue: null, tabs: [{ id: 't1', name: 'tab 1', cwd: '', agent: false, shell: '', resume: '', rtpl: '' }] },
        { id: 's2', project: 'p2', name: 'build', cwd: '', themeId: 'nord', isLog: false, left: '120px', top: '60px', width: '520px', height: '320px', minimized: false, maximized: false, prevRect: null, glue: null, tabs: [{ id: 't2', name: 'one', cwd: '', agent: false, shell: '', resume: '', rtpl: '' }, { id: 't3', name: 'two', cwd: '', agent: false, shell: '', resume: '', rtpl: '' }] },
        { id: 's3', project: 'p2', name: 'logs', cwd: '', themeId: null, isLog: true, left: '200px', top: '90px', width: '480px', height: '280px', minimized: true, maximized: false, prevRect: null, glue: null, tabs: [{ id: 't4', name: 'tab 1', cwd: '', agent: false, shell: '', resume: '', rtpl: '' }] },
      ],
    };
    await page.addInitScript((d) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('td.state.v5', JSON.stringify(d)); sessionStorage.setItem('seeded', '1'); } }, v5);
    await page.addInitScript(() => localStorage.setItem('td-tour-done', '1'));
    await page.goto('/?demo');
    await expect(page.locator('.ptab')).toHaveCount(2);
    await expect(page.locator('.ptab.active')).toContainText('web');
    await expect(page.locator('.win:visible')).toHaveCount(1);          // build; logs is minimized
    const win = page.locator('.win:visible');
    expect(await win.evaluate((w) => [w.style.left, w.style.top, w.style.width])).toEqual(['120px', '60px', '520px']);
    await expect(win.locator('.wtab')).toHaveText(['one', 'two']);
    await expect(page.locator('.chip:visible')).toHaveCount(2);         // build + minimized logs
    await page.locator('.ptab', { hasText: 'api' }).click();
    await expect(page.locator('.win:visible')).toHaveCount(1);
  });

  test('old storage key names are carried over once (td-* / td_* → td.<name>.v1)', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('td-follow', '1'); localStorage.setItem('td-pal-recent', '["Tile windows"]'); });
    await boot(page, '/?demo');                                          // boot() also sets the old td-tour-done
    expect(await page.evaluate(() => ['td-follow', 'td-pal-recent', 'td-tour-done', 'td.treeFollow.v1', 'td.palRecent.v1', 'td.tourDone.v1'].map((k) => localStorage.getItem(k))))
      .toEqual([null, null, null, '1', '["Tile windows"]', '1']);
    await openPalette(page);
    await expect(labels(page).first()).toHaveText('Tile windows');     // the migrated Recent list is in use
  });

  test('settings export → import round trip; unknown keys and bad files are refused', async ({ page }, info) => {
    await boot(page, '/?demo');
    const mine = { 'td.font.v1': '{"family":"Menlo","size":15}', 'td.treeFollow.v1': '1', 'td.snippets.v1': '[{"name":"hi","cmd":"echo hi"}]' };
    await page.evaluate((m) => { for (const k in m) localStorage.setItem(k, m[k]); }, mine);
    const runCmd = async (label) => { await openPalette(page); await page.locator('#pal-input').fill(label); await page.keyboard.press('Enter'); };
    const dl = page.waitForEvent('download');
    await runCmd('Export settings');
    const file = info.outputPath('termdeck-settings.json');
    await (await dl).saveAs(file);
    const out = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(out).toMatchObject({ termdeck: 'settings', version: 1, settings: mine });
    expect(Object.keys(out.settings)).not.toContain('td.state.v5');      // the layout is not a setting
    // wipe them, and add a key no settings file may set
    await page.evaluate((m) => { for (const k in m) localStorage.removeItem(k); }, mine);
    out.settings['td.notASetting.v1'] = 'x';
    fs.writeFileSync(file, JSON.stringify(out));
    const chooser = page.waitForEvent('filechooser');
    await runCmd('Import settings');
    await (await chooser).setFiles(file);
    await page.getByRole('dialog', { name: /Import 3 settings/ }).getByRole('button', { name: 'Import' }).click();
    await page.waitForLoadState('load');
    await expect(page.locator('.win')).toHaveCount(1);
    expect(await page.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), [...Object.keys(mine), 'td.notASetting.v1'])).toEqual([...Object.values(mine), null]);
    // not a settings file
    const bad = info.outputPath('bad.json');
    fs.writeFileSync(bad, '{"hello":1}');
    const chooser2 = page.waitForEvent('filechooser');
    await runCmd('Import settings');
    await (await chooser2).setFiles(bad);
    await expect(page.locator('.toast', { hasText: 'not a termdeck settings file' })).toBeVisible();
  });

  test('site storage denied outright (every localStorage access throws): still boots, no errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } }));
    await page.goto('/?demo');
    await expect(page.locator('.win')).toHaveCount(1);
    await page.locator('#new').click();
    await expect(page.locator('.win')).toHaveCount(2);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('full or blocked browser storage: one "Layout not saved" warning, no errors', async ({ page }) => {
    const errors = await boot(page, '/?demo');
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
    await page.keyboard.press('Escape');                                 // (tour, if any)
    await page.locator('#new').click();                             // a layout change → save fails
    await page.locator('#new').click();
    await expect(page.locator('.toast', { hasText: 'Layout not saved' })).toHaveCount(1);
    await page.locator('#sb-btn').click();
    await treeMenu(page, 'Show hidden files');                           // unguarded before: threw in the click handler
    await page.waitForTimeout(800);
    await expect(page.locator('.toast', { hasText: 'Layout not saved' })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('palette shows labels as text, never as markup (with and without a search)', async ({ page }) => {
    const label = '<img src=x onerror="window.__pwned=1">snip';
    await page.addInitScript((l) => localStorage.setItem('td.snippets.v1', JSON.stringify([{ id: 'sn1', label: l, cmd: 'echo hi' }])), label);
    await boot(page, '/?demo');
    for (const q of ['', 'snip']) {
      await openPalette(page);
      await page.locator('#pal-input').fill(q);
      await expect(labels(page).filter({ hasText: label })).toHaveCount(1);   // the raw text is shown
      await expect(page.locator('#pal-list img')).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
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

  test('WebGL budget: at most 12 live contexts; every shown terminal keeps the GPU renderer across a project switch', async ({ page, browserName }) => {
    await page.addInitScript(() => {                    // count every WebGL context the page creates
      const get = HTMLCanvasElement.prototype.getContext; window.__gl = [];
      HTMLCanvasElement.prototype.getContext = function (type, ...a) { const c = get.call(this, type, ...a); if (/webgl/.test(type) && c && !window.__gl.includes(c)) window.__gl.push(c); return c; };
    });
    const warnings = []; page.on('console', (m) => { if (/webgl|context ?lost/i.test(m.text())) warnings.push(m.text()); });
    await boot(page, '/?demo');
    const GPU = '.xterm-screen > canvas:not([class*="-layer"])';   // the WebGL renderer's canvas (its 2D layers are *-layer)
    const gpu = await page.waitForSelector(GPU, { timeout: 3000 }).then(() => true, () => false);
    test.skip(!gpu, 'no WebGL renderer in this browser');
    const newTerm = async () => { const n = await page.locator('.xterm').count(); await page.locator('#new').click(); await expect(page.locator('.xterm')).toHaveCount(n + 1); };
    for (let i = 1; i < 12; i++) await newTerm();        // project 1: 12 terminals (the per-project maximum)
    await page.locator('#padd').click();
    for (let i = 0; i < 8; i++) await newTerm();         // project 2: 8 more — 20 in all, past Chrome's ~16 contexts
    await page.locator('.ptab').first().click();
    const shownOnGpu = () => page.evaluate((sel) => [...document.querySelectorAll('.win')].filter((w) => w.style.display !== 'none')
      .map((w) => { const c = w.querySelector(sel); return !!c && !c.getContext('webgl2').isContextLost(); }), GPU);
    // WebKit keeps counting released contexts until they are garbage-collected, so it may still drop a few on the
    // switch back; those terminals must get WebGL again (xterm waits ~3 s for a restore, then the 2 s retry).
    await expect.poll(shownOnGpu, { timeout: 15000 }).toEqual(Array(12).fill(true));
    expect(await page.evaluate(() => window.__gl.filter((g) => !g.isContextLost()).length)).toBeLessThanOrEqual(12);
    if (browserName === 'chromium') expect(warnings).toEqual([]);   // Chrome frees a released context at once
  });

  test('a tab that stalls past the instance lock lifetime keeps running instead of reloading itself', async ({ page }) => {
    await boot(page, '/?demo');
    await page.evaluate(() => { window.__alive = 1; const end = Date.now() + 6000; while (Date.now() < end); });   // block the main thread > LOCK_TTL (5 s)
    await page.waitForTimeout(2500);                                                                          // one more heartbeat
    expect(await page.evaluate(() => window.__alive)).toBe(1);                                                 // a reload would have cleared it
    await expect(page.getByText('Already open in another tab')).toHaveCount(0);
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
    // A click on the backdrop outside the sheet closes the overview; a click inside it does not.
    await page.locator('#agent-to-grid').click();
    await page.locator('#ov-overlay .ov-foot').click();
    await expect(page.locator('#ov-overlay')).toHaveClass(/open/);
    await page.locator('#ov-overlay').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#ov-overlay')).not.toHaveClass(/open/);
  });

  test('Sessions empty state: "Start an agent" opens the palette on its Agents tab', async ({ page }) => {
    await boot(page, '/?demo');
    await page.locator('#agent-btn').click();
    await expect(page.locator('#agent-pop .agent-empty')).toContainText('No active agents');
    await page.locator('#agent-pop .agent-start').click();
    await expect(page.locator('#agent-pop')).not.toHaveClass(/open/);
    await expect(page.locator('#palette')).toHaveClass(/open/);
    await expect(page.locator('#pal-cats .pal-cat.on')).toHaveText('Agents');
    await expect(page.locator('#pal-input')).toBeFocused();
  });
});

test.describe('tree find (#167)', () => {
  test('/ focuses the box; filters the demo tree by name; Esc restores the tree', async ({ page }) => {
    const errors = await boot(page, '/?demo');
    await page.locator('#sb-btn').click();
    await page.locator('body').press('/');
    await expect(page.locator('#tf-input')).toBeFocused();
    await page.locator('#tf-input').fill('LOG');
    await expect(page.locator('#tree-results .tn-name')).toHaveText(['logger.ts']);
    await expect(page.locator('#tree')).toBeHidden();
    await page.locator('#tf-input').press('Escape');
    await expect(page.locator('#tree-results')).toBeHidden();
    await expect(page.locator('#tree')).toBeVisible();
    expect(errors).toEqual([]);
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
    await expect(page.locator('.pal-item')).toHaveCount(10);          // Tile windows + 5 presets + Toggle directory tree + Move or resize window + Save/Restore layout
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
  test('palette search ranks word-start matches first and layout presets after real commands', async ({ page }) => {
    await boot(page, '/?demo');
    await openPalette(page);
    const input = page.locator('#palette input').first();
    await input.fill('layout');
    await expect(labels(page).first()).toHaveText(/^Save layout/);          // not "Layout 1×1"
    await expect(labels(page).nth(1)).toHaveText(/^Restore layout/);
    await input.fill('2x2');
    await expect(labels(page).first()).toHaveText('Layout 2×2');            // presets still found
    await input.fill('term');
    await expect(labels(page).first()).toHaveText('New terminal');          // list order within a tier
  });
  test('named layouts work in demo mode via localStorage', async ({ page }) => {
    await boot(page, '/?demo');
    await openPalette(page);
    await page.locator('#palette input').first().fill('save layout');
    await labels(page).filter({ hasText: /^Save layout/ }).first().click();
    await page.locator('input[placeholder="e.g. review day"]').fill('Demo one');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.toast', { hasText: 'this browser only' })).toBeVisible();
    await openPalette(page);
    await page.locator('#palette input').first().fill('restore layout');
    await labels(page).filter({ hasText: /^Restore layout/ }).first().click();
    await expect(page.locator('.lay-row', { hasText: 'Demo one' })).toBeVisible();
  });
});

// axe-core's WCAG + best-practice checks; any finding fails, whatever its impact.
async function axeIssues(page, where) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.map((v) => `${where}: ${v.id} — ${v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} (${(n.failureSummary || '').split('\n')[1]?.trim() || ''})`).join(', ')}`);
}

test.describe('accessibility', () => {
  for (const theme of ['console', 'solarizedLight']) {
    test(`no axe findings on the main surfaces (${theme})`, async ({ page }) => {
      test.setTimeout(60000);
      await page.addInitScript((t) => localStorage.setItem('td.theme.v2', t), theme);
      await boot(page, '/?demo');
      const found = await axeIssues(page, 'desktop');
      await openPalette(page);
      await page.keyboard.press('ArrowDown');   // the highlighted row is announced through aria-activedescendant
      expect(await page.locator('#pal-input').getAttribute('aria-activedescendant')).toBe(await page.locator('#pal-list .pal-item.hi').getAttribute('id'));
      found.push(...await axeIssues(page, 'palette')); await page.keyboard.press('Escape');
      for (const [btn, where] of [['#sc-btn', 'help'], ['#agent-btn', 'sessions'], ['#theme-btn', 'theme picker'], ['#search-btn', 'session search'], ['#sb-btn', 'directory tree']]) {
        await page.locator(btn).click(); await page.waitForTimeout(250);
        found.push(...await axeIssues(page, where)); await page.keyboard.press('Escape');
      }
      await page.locator('#agent-btn').click(); await page.locator('#agent-to-grid').click(); await page.waitForTimeout(250);
      found.push(...await axeIssues(page, 'live overview'));
      expect(found).toEqual([]);
    });
  }

  test('dialogs: focus moves in, Tab stays inside, Escape gives focus back', async ({ page }) => {
    await boot(page, '/?demo');
    const help = page.locator('#sc-overlay[role="dialog"][aria-modal="true"]');
    const inside = () => help.evaluate((d) => d.contains(document.activeElement));
    await page.locator('#sc-btn').focus();
    await page.keyboard.press('Enter');
    await expect(help).toHaveClass(/open/);
    await expect.poll(inside).toBe(true);
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      expect(await inside(), `focus left the dialog after ${key}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(help).not.toHaveClass(/open/);
    await expect(page.locator('#sc-btn')).toBeFocused();
  });

  test('confirm dialog: Tab cycles its buttons; Enter on Cancel cancels', async ({ page }) => {
    await boot(page, '/?demo');
    await page.locator('#padd').click();                                // a second project, so the first can be deleted
    await expect(page.locator('.ptab')).toHaveCount(2);
    await page.locator('.ptab').first().locator('.pdel').click({ force: true });   // its window makes it ask first
    const dlg = page.getByRole('dialog', { name: /Delete this project/ });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Delete' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();   // wrapped, still inside
    await page.keyboard.press('Shift+Tab');
    await expect(dlg.getByRole('button', { name: 'Delete' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');                                 // on Cancel: must not delete
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('.ptab')).toHaveCount(2);
  });

  test('palette: Escape gives focus back; a command that opens a terminal still focuses it (focus return does not take over)', async ({ page }) => {
    await boot(page, '/?demo');
    await page.locator('#pal-btn').focus();
    await page.keyboard.press('Enter');
    await expect(palette(page)).toHaveClass(/open/);
    await page.keyboard.press('Escape');                                // closed with nothing run: focus goes back to the button
    await expect(page.locator('#pal-btn')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(palette(page)).toHaveClass(/open/);
    await page.keyboard.type('New terminal');
    await page.keyboard.press('Enter');
    await expect(page.locator('.win')).toHaveCount(2);
    await page.waitForTimeout(150);                                     // past the dialog's deferred focus return
    expect(await page.evaluate(() => { const w = [...document.querySelectorAll('.win')].find((x) => x.contains(document.activeElement)); return !!w && document.activeElement.classList.contains('xterm-helper-textarea'); })).toBe(true);
  });

  test('keyboard move / resize: arrows move, Shift+arrows resize, Esc puts it back, Enter keeps it', async ({ page }) => {
    await trackTerms(page);
    await boot(page, '/?demo');
    const win = page.locator('.win').first();
    await win.locator('.xterm').click({ force: true });                 // focus the window
    const box = () => win.evaluate((w) => ({ x: parseFloat(w.style.left), y: parseFloat(w.style.top), w: w.offsetWidth }));
    const typed = [];                                                   // nothing may reach the shell while the mode is on
    await page.exposeFunction('__typed', (d) => typed.push(d));
    await page.evaluate(() => window.__terms[0].onData((d) => window.__typed(d)));
    const enter = async () => {
      await openPalette(page);
      await page.locator('#pal-input').fill('move or resize');
      await page.keyboard.press('Enter');
      await expect(win).toHaveClass(/kbd-move/);
    };
    const b0 = await box();
    await enter();
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'Alt+ArrowRight']) await page.keyboard.press(k);
    expect(await box()).toEqual({ x: b0.x + 21, y: b0.y + 10, w: b0.w });
    await page.keyboard.press('Escape');
    await expect(win).not.toHaveClass(/kbd-move/);
    expect(await box()).toEqual(b0);
    await enter();
    await page.keyboard.press('Shift+ArrowLeft');                      // right edge in: 10 px narrower
    await page.keyboard.press('Enter');
    await expect(win).not.toHaveClass(/kbd-move/);
    expect(await box()).toEqual({ x: b0.x, y: b0.y, w: b0.w - 10 });
    expect(typed).toEqual([]);
  });

  test('phone width: the page fits 390 px, the window fills the window area, every control is at least 24×24', async ({ browser, browserName }) => {
    test.skip(browserName === 'firefox', 'Playwright has no mobile emulation for Firefox');
    const { defaultBrowserType, ...phone } = devices['iPhone 13'];   // eslint-disable-line no-unused-vars
    const ctx = await browser.newContext({ ...phone, baseURL: test.info().project.use.baseURL });
    try {
      const page = await ctx.newPage();
      await boot(page, '/?demo');
      const r = await page.evaluate(() => {
        const box = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
        const small = [...document.querySelectorAll('button,a[href],[role="button"],[role="tab"],input,select,summary')]
          .filter((e) => { const [w, h] = box(e); return w && h && !e.classList.contains('xterm-helper-textarea') && (w < 24 || h < 24); })
          .map((e) => `${e.id || e.className} ${box(e).join('x')}`);
        return { page: document.documentElement.scrollWidth, desktop: box(document.getElementById('desktop')), win: box(document.querySelector('.win')), small };
      });
      expect(r).toEqual({ page: 390, desktop: r.desktop, win: r.desktop, small: [] });
    } finally { await ctx.close(); }
  });

  test('every theme keeps UI text at WCAG AA (4.5:1) on its surfaces; theme cards are buttons', async ({ page }) => {
    await boot(page, '/?demo');
    await page.locator('#theme-btn').click();
    const cards = page.locator('#theme-grid button.tcard');
    const n = await cards.count();
    expect(n).toBeGreaterThan(20);
    const low = [];
    for (let i = 0; i < n; i++) {
      await cards.nth(i).click();
      await expect(cards.nth(i)).toHaveAttribute('aria-pressed', 'true');
      low.push(...await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement), v = (k) => css.getPropertyValue(k).trim();
        const lum = (h) => { const c = [1, 3, 5].map((j) => { const x = parseInt(h.slice(j, j + 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
        const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const out = [];
        for (const fg of ['--text', '--muted', '--accent-text']) for (const bg of ['--bg', '--panel', '--panel-2', '--win-body', '--btn-bg', '--chip-bg', '--chip-active']) {
          if (!/^#[0-9a-f]{6}$/i.test(v(bg))) continue;
          const r = cr(v(fg), v(bg)); if (r < 4.5) out.push(`${document.querySelector('#theme-grid .tcard.current .tname').textContent} ${fg} on ${bg}: ${r.toFixed(2)}`);
        }
        return out;
      }));
    }
    expect(low).toEqual([]);
  });
});

test('hosted demo copy matches a fresh npm run build:demo', () => {
  const dir = path.join(ROOT, 'docs', 'app');
  const names = () => ['index.html', 'app.css', 'app.js', ...(fs.existsSync(path.join(dir, 'js')) ? fs.readdirSync(path.join(dir, 'js')).map((n) => 'js/' + n) : [])];
  const snap = () => new Map(names().filter((n) => fs.existsSync(path.join(dir, n))).map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')]));
  const before = snap();
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-demo.js')], { stdio: 'ignore' });
  const after = snap();
  for (const n of after.keys()) if (!before.has(n)) fs.unlinkSync(path.join(dir, n));   // leave the tree as we found it
  for (const [n, v] of before) if (after.get(n) !== v) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), v); }
  const same = before.size === after.size && [...after].every(([n, v]) => before.get(n) === v);
  expect(same, 'docs/app is stale — run npm run build:demo').toBe(true);
});

test.describe('live backend', () => {
  test('PWA manifest loads with the sign-in cookie and the app is installable (#1)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP (getAppManifest) is Chromium-only');
    await boot(page, '/');
    const cdp = await page.context().newCDPSession(page);
    const { data, errors } = await cdp.send('Page.getAppManifest');
    expect(errors).toEqual([]);
    expect(JSON.parse(data).display).toBe('standalone');
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    expect(installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito')).toEqual([]);
  });

  test('/api/find: nested case-insensitive match; skips node_modules/.git; dotfiles only on request; result cap', async ({ request }) => {
    const root = fs.mkdtempSync(path.join(process.env.TD_E2E_HOME, 'find-'));
    for (const f of ['a/deep/NeedleFile.txt', 'node_modules/needle.js', '.git/needle', '.hid/needle.txt']) {
      fs.mkdirSync(path.join(root, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(root, f), '');
    }
    for (let i = 0; i < 205; i++) fs.writeFileSync(path.join(root, `bulk${i}.log`), '');
    const find = async (q, extra = '') => (await request.get(`/api/find?dir=${encodeURIComponent(root)}&q=${q}${extra}`)).json();
    expect((await find('NEEDLE')).results).toEqual([{ path: 'a/deep/NeedleFile.txt', dir: false }]);
    expect((await find('needle', '&all=1')).results.map((r) => r.path).sort()).toEqual(['.hid/needle.txt', 'a/deep/NeedleFile.txt']);
    const bulk = await find('bulk');
    expect([bulk.results.length, bulk.truncated]).toEqual([200, true]);
    expect((await request.get('/api/find?dir=/nonexistent-td-path&q=x')).status()).toBe(404);
    fs.rmSync(root, { recursive: true, force: true });
  });

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
    await expect(page.locator('.win .foot-port').first()).toBeVisible();
    await expect(page.locator('.win .foot-port').first()).toHaveAttribute('title', /localhost:4321/);
    await Promise.all([page.waitForEvent('popup'), page.locator('.win .foot-port').first().click()]);   // click → new tab
    await expect(page.locator('.win .foot-port').first()).toBeHidden({ timeout: 8000 });   // prompt back → server gone
    await page.keyboard.type('echo hi'); await page.keyboard.press('Backspace');             // backspace edits are honoured
    await page.keyboard.type('ey\n');                                                     // (a real key: Firefox drops a typed \x7f)
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

  test('opening a terminal elsewhere parks it here; ⟳ takes it back', async ({ page }) => {
    const ids = [];
    page.on('websocket', (ws) => { const m = /[?&]id=([^&]+)/.exec(ws.url()); if (m) ids.push(decodeURIComponent(m[1])); });
    await boot(page, '/');
    await expect.poll(() => ids.length).toBe(1);
    await expect(page.locator('.win.dead')).toHaveCount(0);
    await page.evaluate((id) => { window.__other = new WebSocket('ws://' + location.host + '/?id=' + encodeURIComponent(id)); }, ids[0]);   // "another device"
    await expect(page.locator('.win.dead')).toHaveCount(1);              // parked, and it does not reconnect on its own
    await page.waitForTimeout(1500);
    await expect(page.locator('.win.dead')).toHaveCount(1);
    await page.locator('.win .wbtn.restart').click();
    await expect(page.locator('.win.dead')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__other.readyState)).toBe(3);   // and the other one is closed now
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

  test('new agent task: works from a non-repo folder, errors stay in the dialog, the project remembers the repo', async ({ page }) => {
    const plain = fs.mkdtempSync(path.join(require('os').tmpdir(), 'td-plain-'));   // outside the HOME repo: not a git repository
    const repo = fs.realpathSync(process.env.TD_E2E_HOME);                         // git reports the resolved path (/var → /private/var on macOS)
    await boot(page, '/');
    await page.locator('#folder').click();                       // first shell with a cwd anchors the project root
    await page.locator('#cwd-input').fill(plain);
    await page.keyboard.press('Enter');
    await expect(page.locator('.win')).toHaveCount(2);
    const open = async () => {
      await openPalette(page);
      await page.locator('#pal-input').fill('New agent task');
      await page.locator('.pal-item', { hasText: 'New agent task' }).first().click();
    };
    const repoField = page.getByPlaceholder('~/code/my-app'), branchField = page.getByPlaceholder('agent/fix-login');
    const create = page.getByRole('button', { name: 'Create' }), alert = page.getByRole('alert');
    await open();
    await expect(repoField).toHaveValue('');                      // nothing to guess from, but the dialog still opens
    await branchField.fill('agent/e2e-x');
    await create.click();
    await expect(alert).toHaveText('Pick the repository to cut the worktree from');
    await repoField.fill(plain);
    await create.click();
    await expect(alert).toContainText('not a git repository');
    await repoField.fill(process.env.TD_E2E_HOME);
    await branchField.fill('bad name..x');
    await create.click();
    await expect(alert).toContainText('Couldn’t create worktree: invalid branch name');
    await expect(repoField).toHaveValue(process.env.TD_E2E_HOME);  // what was typed is kept
    await branchField.fill('agent/e2e-' + Date.now().toString(36));   // unique: the shared test repo keeps branches across --repeat-each runs
    await create.click();
    await expect(page.getByText('Worktree ready')).toBeVisible();
    await open();                                                 // from the new task's project: defaults to the main repo, not the worktree
    await expect(repoField).toHaveValue(repo);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.locator('.ptab').first().click();                  // the project it was started from is now bound to that repo too
    await open();
    await expect(repoField).toHaveValue(repo);
    await page.getByRole('button', { name: 'Cancel' }).click();
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
    await page.locator('#sb-btn').click(); await page.locator('#sb-btn').click();   // close + reopen the tree: highlight is re-applied
    await expect(here).toHaveAttribute('data-path', /follow-proj\/beta$/);
    await page.locator('#sb-refresh-btn').click();                                  // ↻ keeps it too
    await expect(here).toHaveAttribute('data-path', /follow-proj\/beta$/);
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
  test('re-clicking the focused window does not re-render the tree', async ({ page }) => {
    await boot(page, '/');
    await page.locator('#sb-btn').click();
    await expect(page.locator('#tree .tn').first()).toBeVisible();
    await page.locator('#tree .tn').first().evaluate((n) => n.setAttribute('data-keep', '1'));
    await page.locator('.win .xterm').first().click({ force: true });
    await page.locator('.win .xterm').first().click({ force: true });
    await page.waitForTimeout(400);
    await expect(page.locator('#tree .tn[data-keep="1"]')).toHaveCount(1);   // same DOM node → no refresh/flash
  });
  test('tree resizes by dragging its edge and returns to the default width on reopen', async ({ page }) => {
    await boot(page, '/');
    await page.locator('#sb-btn').click();
    const sb = page.locator('#sidebar');
    await expect(sb).toHaveCSS('width', '240px');
    await page.waitForTimeout(400);   // let the slide-in finish so the handle is where we measure it
    const h = await page.locator('#sb-resize').boundingBox();
    await page.mouse.move(h.x + 3, h.y + 100);
    await page.mouse.down();
    await page.mouse.move(h.x + 163, h.y + 100, { steps: 5 });
    await page.mouse.up();
    await expect(sb).toHaveCSS('width', '400px');
    await page.locator('#sb-close-btn').click();
    await page.locator('#sb-btn').click();
    await expect(sb).toHaveCSS('width', '240px');   // width is not remembered
  });
  test('Cast (broadcast) reaches only the active project\'s shells and turns off on a project switch', async ({ page }) => {
    const sent = [];                                                   // [{ id, input }] in socket-creation order
    page.on('websocket', (ws) => {
      const s = { id: /[?&]id=([^&]+)/.exec(ws.url())?.[1], input: '' }; sent.push(s);
      ws.on('framesent', (f) => { try { const m = JSON.parse(String(f.payload)); if (m.type === 'input') s.input += m.data; } catch {} });
    });
    await boot(page, '/');
    await page.locator('#new').click();                                 // project A: two shells
    await page.locator('#padd').click(); await page.locator('#new').click();   // project B: one shell
    await expect.poll(() => sent.length).toBe(3);
    await page.locator('.ptab').first().click();                        // back to A
    await page.locator('#bcast').click();
    await expect(page.locator('#bcast')).toHaveClass(/active/);
    await page.locator('.win:visible .xterm').first().click({ force: true });
    await page.keyboard.type('echo cast-42');
    await expect.poll(() => sent.filter((s) => s.input.includes('echo cast-42')).length).toBe(2);   // both of A's shells
    expect(sent[2].input).not.toContain('cast-42');                     // B's shell got nothing
    await page.locator('.ptab').nth(1).click();
    await expect(page.locator('#bcast')).not.toHaveClass(/active/);     // never carried into another project
  });
  test('dock "move to project" is disabled with one project and enabled with two', async ({ page }) => {
    await boot(page, '/');
    const mv = page.locator('.chip .cmove').first();
    await expect(mv).toBeDisabled();
    await page.locator('#padd').click();
    await expect(mv).toBeEnabled();
  });
  test('Terminal font… sets family + size live on open terminals and persists', async ({ page }) => {
    await trackTerms(page);
    await boot(page, '/');
    await openPalette(page);
    await page.locator('#palette input').first().fill('terminal font');
    await labels(page).filter({ hasText: /^Terminal font/ }).first().click();
    const dlg = page.locator('input[placeholder="JetBrains Mono"]');
    await dlg.fill('Courier New');
    await page.locator('input[placeholder="13"]').fill('17');
    await page.getByRole('button', { name: 'Save' }).click();
    const font = () => page.evaluate(() => { const o = window.__terms[0].options; return { size: o.fontSize, family: o.fontFamily }; });
    await expect.poll(font).toEqual({ size: 17, family: expect.stringMatching(/Courier New/) });   // applied live
    await page.reload();
    await expect.poll(font).toEqual({ size: 17, family: expect.stringMatching(/Courier New/) });   // persisted
  });
  test('API guard: baseline headers, one cross-site check for every route, launch routes are POST-only', async ({ request }) => {
    const home = await request.get('/');
    expect(home.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(home.headers()['x-frame-options']).toBe('SAMEORIGIN');
    expect(home.headers()['x-content-type-options']).toBe('nosniff');
    expect(home.headers()['referrer-policy']).toBe('no-referrer');
    const q = encodeURIComponent(process.env.TD_E2E_HOME);
    for (const p of [`/api/ls?dir=${q}`, `/api/read?path=${q}/README.md`, `/api/stat?path=${q}/README.md`, `/api/find?dir=${q}&q=readme`, '/api/layouts', '/api/shells', '/debug']) {
      expect((await request.get(p)).status(), p).toBe(200);
      expect((await request.get(p, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status(), p + ' cross-site').toBe(403);
    }
    for (const p of ['/api/reveal', '/api/open', '/api/open-editor']) {
      expect((await request.get(`${p}?path=${q}`)).status(), 'GET ' + p).toBe(404);   // launching needs a POST
      expect((await request.post(p, { data: { path: '/nonexistent-td-path' }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status(), p + ' cross-site').toBe(403);
      expect((await request.post(p, { data: { path: '/nonexistent-td-path' } })).status(), 'POST ' + p).toBe(404);   // reaches the route
    }
  });

  test('CSP: the app runs under the full policy, inline boot script allowed by hash, no violations', async ({ page, request }) => {
    const csp = (await request.get('/')).headers()['content-security-policy'];
    expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/]+=*'/);
    for (const d of ["default-src 'self'", "connect-src 'self';", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'self'"]) expect(csp).toContain(d);
    await page.addInitScript(() => {
      window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
      localStorage.setItem('td.themevars.v1', JSON.stringify({ '--td-csp-probe': '1' }));   // only the inline boot script reads this
    });
    await trackTerms(page);
    const errors = await boot(page, '/');
    await page.locator('.win .xterm').first().click({ force: true });
    await page.keyboard.type('echo csp-$((40+2))\n');
    const screen = () => page.evaluate(() => { const b = window.__terms[0].buffer.active, out = [];
      for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true)); return out.join('\n'); });
    await expect.poll(screen).toContain('csp-42');                                      // WebSocket + shell work
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--td-csp-probe'))).toBe('1');
    expect(await page.evaluate(() => window.__csp)).toEqual([]);
    expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
  });

  test('rendered markdown: a link URL cannot break out of href', async ({ page }) => {
    const dir = fs.mkdtempSync(path.join(process.env.TD_E2E_HOME, 'md-'));
    fs.writeFileSync(path.join(dir, 'evil.md'), '[docs](https://a"onmouseover="window.__pwned=1"x=")\n\n[ok](https://example.com/a?b=1&c=2)\n');
    await boot(page, '/');
    await openPalette(page);
    await page.locator('#palette input').first().fill('open file');
    await labels(page).filter({ hasText: /^Open file/ }).first().click();
    await page.locator('input[placeholder="README.md"]').fill(path.join(dir, 'evil.md'));
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    const links = page.locator('#fv-body a');
    await expect(links).toHaveCount(2);
    const attrs = await links.evaluateAll((as) => as.map((a) => a.getAttributeNames().sort().join(',')));
    expect(attrs).toEqual(['href,rel,target', 'href,rel,target']);
    expect(await links.nth(1).getAttribute('href')).toBe('https://example.com/a?b=1&c=2');   // normal links unchanged
    await links.first().hover();
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test('file viewer previews images, CSV, PDF and falls back for binaries; /api/raw is locked down', async ({ page, request }) => {
    const dir = fs.mkdtempSync(path.join(process.env.TD_E2E_HOME, 'preview-'));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(dir, 'dot.png'), png);
    fs.writeFileSync(path.join(dir, 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>alert(1)</script></svg>');
    fs.writeFileSync(path.join(dir, 'x.pdf'), '%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
    fs.writeFileSync(path.join(dir, 'data.csv'), 'name,qty\n"Smith, J",3\n"say ""hi""",4\n');
    fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([1, 0, 2, 0, 3]));
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'nope');
    await boot(page, '/');
    const open = async (f) => {
      await openPalette(page);
      await page.locator('#palette input').first().fill('open file');
      await labels(page).filter({ hasText: /^Open file/ }).first().click();
      await page.locator('input[placeholder="README.md"]').fill(path.join(dir, f));
      await page.getByRole('button', { name: 'Open', exact: true }).click();
    };
    await open('dot.png');
    await expect(page.locator('#fv-body img.fv-img')).toBeVisible();
    await expect.poll(() => page.locator('#fv-body img.fv-img').evaluate((i) => i.naturalWidth)).toBe(1);   // really decoded
    await page.keyboard.press('Escape');
    await open('x.pdf');
    await expect(page.locator('#fv-body iframe.fv-pdf')).toBeVisible();
    await page.keyboard.press('Escape');
    await open('data.csv');
    const cells = page.locator('#fv-body table td, #fv-body table th');
    await expect(cells).toHaveText(['name', 'qty', 'Smith, J', '3', 'say "hi"', '4']);   // quoted comma + escaped quote
    await page.locator('#fv-tog').click();                                              // Raw
    await expect(page.locator('#fv-body')).toContainText('"Smith, J",3');
    await page.keyboard.press('Escape');
    await open('blob.bin');
    await expect(page.getByRole('button', { name: 'Open in default app' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Reveal in/ })).toBeVisible();
    await page.keyboard.press('Escape');
    // endpoint rules
    const raw = (f, headers) => request.get('/api/raw?path=' + encodeURIComponent(path.join(dir, f)), { headers });
    const ok = await raw('dot.png');
    expect(ok.status()).toBe(200); expect(ok.headers()['content-type']).toBe('image/png'); expect(ok.headers()['x-content-type-options']).toBe('nosniff');
    expect((await raw('x.svg')).headers()['content-security-policy']).toContain('sandbox');
    expect((await raw('secret.txt')).status()).toBe(415);                                // not on the allowlist
    expect((await raw('dot.png', { 'Sec-Fetch-Site': 'cross-site' })).status()).toBe(403);
    expect((await raw('dot.png', { Origin: 'http://evil.example' })).status()).toBe(403);
    const open2 = await request.post('/api/open', { data: { path: path.join(dir, 'run.sh') } });
    expect(open2.status()).toBe(404);                                                    // missing file
    fs.writeFileSync(path.join(dir, 'run.sh'), 'echo hi');
    expect((await request.post('/api/open', { data: { path: path.join(dir, 'run.sh') } })).status()).toBe(403);   // executables are never launched
  });
  test('named layouts: save, restore (replaces windows), delete; /api/layouts is guarded', async ({ page, request }) => {
    await boot(page, '/');
    await page.locator('#new').click(); await page.locator('#new').click();
    await expect(page.locator('.win')).toHaveCount(3);
    const runCmd = async (re) => {
      await openPalette(page);
      await page.locator('#palette input').first().fill('layout');
      await labels(page).filter({ hasText: re }).first().click();
    };
    await runCmd(/^Save layout/);
    await page.locator('input[placeholder="e.g. review day"]').fill('E2E three');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.toast', { hasText: 'Layout saved' })).toBeVisible();
    const list = await (await request.get('/api/layouts')).json();
    const mine = list.find((l) => l.name === 'E2E three');
    expect(mine).toMatchObject({ windows: 3, projects: 1 });
    await page.locator('#new').click();
    await expect(page.locator('.win')).toHaveCount(4);
    await runCmd(/^Restore layout/);
    await page.locator('.lay-row', { hasText: 'E2E three' }).click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();   // confirm: open windows are replaced
    await expect(page.locator('.toast', { hasText: 'Layout restored' })).toBeVisible();
    await expect(page.locator('.win')).toHaveCount(3);
    // saved data holds no agent / resume commands
    const full = await (await request.get('/api/layouts/' + mine.id)).json();
    expect(JSON.stringify(full.data)).not.toMatch(/"agent":true/);
    // delete
    await runCmd(/^Restore layout/);
    await page.locator('.lay-row', { hasText: 'E2E three' }).locator('.lay-del').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await (await request.get('/api/layouts')).json()).find((l) => l.name === 'E2E three')).toBeUndefined();
    // guard + validation
    const post = (data, headers) => request.post('/api/layouts', { data, headers });
    expect((await post({ name: 'x', data: { projects: [], sessions: [] } })).status()).toBe(400);   // not a layout
    expect((await post({ name: '', data: full.data })).status()).toBe(400);                           // no name
    expect((await post({ name: 'x', data: full.data }, { Origin: 'http://evil.example' })).status()).toBe(403);
    expect((await post({ name: 'x', data: full.data }, { 'Sec-Fetch-Site': 'cross-site' })).status()).toBe(403);
  });
});
