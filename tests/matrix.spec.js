// Matrix rain, focus veil and privacy shield (public/js/matrix.js). Same server and setup as e2e.spec.js.
// The shield is checked by geometry and computed style (the cover is a pointer-events:none ::after, so hit-testing
// can't see it); fps and CPU numbers live in tools/soak, these tests only check behaviour.
const { test, expect } = require('@playwright/test');
/* global focusedId, projects, toggleMax, THEMES, THEME_ORDER, tabTail, mxCovered, mxDraw, mxRains, petsMode, setBg, tileAll, openThemePop, activeProject, activeTab, addProject, closeOverview, contrast, lum, minimize, mx, mxMix, mxVeilNow, openFileViewer, openOverview, sessions, setGlobalTheme, setShield, setWaiting, settingsKeys, toggleProjectShield, updateAgentOverview -- the app's page globals, used inside page.evaluate() */

const MX = 'td.matrix.v1';
const SHIELD_KEY = 'ControlOrMeta+Alt+KeyX';

// Skip the first-run tour; optionally seed td.matrix.v1 once per page (not on reloads, so a reload test sees what the app saved).
async function boot(page, url, mx) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(([key, val]) => {
    localStorage.setItem('td-tour-done', '1');
    if (val && !sessionStorage.getItem('mx-seeded')) { localStorage.setItem(key, val); sessionStorage.setItem('mx-seeded', '1'); }
  }, [MX, mx ? JSON.stringify(mx) : '']);
  await page.goto(url);
  await expect(page.locator('.win')).toHaveCount(1);
  return errors;
}
const stats = (page) => page.evaluate(() => window.mxStats());
// Is this pane covered? The ::after cover spans the pane and the xterm screen under it is transparent (solid style).
const covered = (pane) => pane.evaluate((p) => {
  const a = getComputedStyle(p, '::after'), r = p.getBoundingClientRect();
  return a.content !== 'none' && a.position === 'absolute' && Math.abs(parseFloat(a.width) - r.width) < 2 && Math.abs(parseFloat(a.height) - r.height) < 2
    && getComputedStyle(p.querySelector('.xterm-screen')).opacity === '0';
});
const firstPane = (page) => page.locator('.win-pane.active').first();
// Live terminals: collect their WS ids, then drive agent state through the real hook endpoint.
function wsIds(page) { const ids = []; page.on('websocket', (ws) => { const m = /[?&]id=([^&]+)/.exec(ws.url()); if (m) ids.push(decodeURIComponent(m[1])); }); return ids; }
const agentSend = (request, id) => async (type, extra = {}) =>
  expect((await request.post('/api/agent-events', { data: { id, type, agent: 'claude', ...extra } })).status()).toBe(204);

test.describe('privacy shield', () => {
  test('off by default costs nothing: no rain canvases, no veil, no cover', async ({ page }) => {
    const errors = await boot(page, '/?demo');
    await page.waitForTimeout(800);
    expect(await stats(page)).toEqual([]);
    await expect(page.locator('.mx-bg, .mx-veil, .mx-srain')).toHaveCount(0);
    expect(await covered(firstPane(page))).toBe(false);
    await expect(page.locator('#shield-ind')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('⌘⌥X covers every pane, the overview and the file viewer; the indicator turns it off', async ({ page }) => {
    await boot(page, '/?demo');
    await page.keyboard.press('ControlOrMeta+Alt+KeyT');
    await expect(page.locator('.win')).toHaveCount(2);
    await page.keyboard.press(SHIELD_KEY);
    await expect(page.locator('html')).toHaveClass(/td-shield/);
    for (const p of await page.locator('.win-pane.active').all()) expect(await covered(p)).toBe(true);
    await expect(page.locator('#privacy-btn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.toast.t-safe', { hasText: 'Privacy shield on' })).toBeVisible();   // our own toast stays readable

    await page.evaluate(() => openFileViewer('/tmp/secret.txt', 'secret.txt', 'API_KEY=hunter2'));
    await expect(page.locator('#fv-body')).toHaveCSS('visibility', 'hidden');
    await page.keyboard.press('Escape');

    await page.evaluate(() => openOverview());   // a covered tile says why it is empty
    await expect(page.locator('.ov-out.mx-hid').first()).toHaveText('Hidden by the privacy shield');
    await page.evaluate(() => closeOverview());
    await page.locator('#privacy-btn').click();
    await expect(page.locator('html')).not.toHaveClass(/td-shield/);
    expect(await covered(firstPane(page))).toBe(false);
  });

  test('palette Privacy tab toggles it; snippets and SSH targets show labels only while shielded', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('td.snippets.v1', JSON.stringify([{ id: 'sn1', label: 'deploy', cmd: 'TOKEN=abc ./deploy.sh' }]));
    });
    await boot(page, '/?demo');
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#pal-input').fill('privacy shield');
    await page.locator('#pal-list .pal-item', { hasText: 'Privacy shield' }).first().click();
    await expect(page.locator('html')).toHaveClass(/td-shield/);
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#pal-input').fill('deploy');
    await expect(page.locator('#pal-list .pi-sub', { hasText: 'Command hidden by the privacy shield' })).toBeVisible();
    await expect(page.locator('#pal-list')).not.toContainText('TOKEN=abc');
    await page.locator('#pal-input').fill('TOKEN');   // the hidden command is not searchable either
    await expect(page.locator('#pal-list .pi-sub', { hasText: 'hidden by the privacy shield' })).toHaveCount(0);
  });

  test('every quick toggle in the palette\'s Privacy tab does what it says, and its subtitle shows the new state', async ({ page }) => {
    const errors = await boot(page, '/?demo');
    await page.locator('.win .xterm').first().click();                            // a focused tab for the tab commands
    const item = (label) => page.locator('#pal-list .pal-item', { has: page.locator('.pi-label', { hasText: new RegExp(`^${label}$`) }) });
    const run = async (label) => {
      await page.keyboard.press('ControlOrMeta+k');
      await page.locator('#pal-cats .pal-cat', { hasText: 'Privacy' }).click();
      await item(label).click();
      await expect(page.locator('#palette')).not.toHaveClass(/open/);
    };
    const sub = async (label) => {
      await page.keyboard.press('ControlOrMeta+k');
      await page.locator('#pal-cats .pal-cat', { hasText: 'Privacy' }).click();
      const t = await item(label).locator('.pi-sub').innerText();
      await page.keyboard.press('Escape');
      return t;
    };
    const state = () => page.evaluate(() => { const s = sessions.get(focusedId), t = activeTab(s); return { shield: mx.shield, tab: !!t.shield, project: !!projects.get(activeProject).shield, bg: mx.bg, lock: t.pane.classList.contains('mx-lock') }; });
    const cases = [
      ['Privacy shield', { shield: true, lock: true }, 'Privacy shield on'],
      ['Shield this tab', { tab: true, lock: true }, 'Tab shielded'],
      ['Shield this project', { project: true, lock: true }, 'Project always shielded'],
      ['Matrix rain background', { bg: true }, 'Matrix rain on'],
    ];
    const off = { shield: false, tab: false, project: false, bg: false, lock: false };
    for (const [label, on, toastTitle] of cases) {
      expect(await sub(label)).toMatch(/^Off \u2014 /);
      await run(label);
      expect(await state()).toEqual({ ...off, ...on });
      await expect(page.locator('.toast', { hasText: toastTitle })).toBeVisible();
      expect(await sub(label)).toMatch(/^On \u2014 /);
      await run(label);
      expect(await state()).toEqual(off);
    }
    await run('Cover this tab now');
    await expect(firstPane(page)).toHaveClass(/mx-veiled/);
    await expect(firstPane(page).locator('.xterm-helper-textarea')).toBeFocused();   // the palette hands the keyboard back
    await page.keyboard.press('a');                                               // any key ends it
    await expect(firstPane(page)).not.toHaveClass(/mx-veiled/);
    expect(errors).toEqual([]);
  });

  test('a tab lock covers only that tab; it survives a reload and the shield blocks find', async ({ page }) => {
    await boot(page, '/?demo');
    await page.keyboard.press('ControlOrMeta+Alt+KeyT');
    await expect(page.locator('.win')).toHaveCount(2);
    const btn = page.locator('.win').nth(1).locator('.wbtn.shield');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(await covered(page.locator('.win').nth(1).locator('.win-pane.active'))).toBe(true);
    expect(await covered(page.locator('.win').nth(0).locator('.win-pane.active'))).toBe(false);
    await expect(page.locator('html')).not.toHaveClass(/td-shield/);

    await page.locator('.win').nth(1).locator('.xterm').click({ force: true });
    await page.keyboard.press('ControlOrMeta+f');
    await expect(page.locator('.findbar.open')).toHaveCount(0);
    await expect(page.locator('.toast', { hasText: 'Find is off' })).toBeVisible();

    await page.waitForTimeout(400);   // the layout save is debounced
    await page.reload();
    await expect(page.locator('.win')).toHaveCount(2);
    await expect.poll(async () => (await page.locator('.win-pane.mx-lock').count())).toBe(1);
  });

  test('a saved shield paints before the app scripts load, and ?shield opens covered', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('td-tour-done', '1'));
    await page.route(/\/js\/[a-z-]+\.js$/, (r) => r.abort());   // no app at all: only the <head> script runs
    await page.goto('/?demo&shield');
    await expect(page.locator('html')).toHaveClass(/td-shield/);
    await page.unroute(/\/js\/[a-z-]+\.js$/);
    await page.goto('/?demo&shield');
    await expect(page.locator('.win')).toHaveCount(1);
    expect(await covered(firstPane(page))).toBe(true);
    expect(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), MX)).shield).toBe(true);   // remembered
    await page.goto('/?demo');
    await expect(page.locator('html')).toHaveClass(/td-shield/);
  });

  test('"Shield this project": its new terminals open covered, other projects don\'t; titles & paths blur', async ({ page }) => {
    await boot(page, '/?demo');
    await page.evaluate(() => toggleProjectShield(activeProject));
    expect(await covered(firstPane(page))).toBe(true);
    await page.keyboard.press('ControlOrMeta+Alt+KeyT');
    await expect(page.locator('.win-pane.mx-lock')).toHaveCount(2);
    await page.evaluate(() => addProject('other'));
    await page.keyboard.press('ControlOrMeta+Alt+KeyT');
    const visibleWin = page.locator('.win:visible');
    await expect(visibleWin).toHaveCount(1);
    expect(await covered(visibleWin.locator('.win-pane.active'))).toBe(false);

    await page.evaluate(() => { mx.titles = true; setShield(true); });
    await expect(page.locator('.win:visible .wt-name').first()).toHaveCSS('filter', /blur/);
    await expect(page.locator('.win:visible .badge.cwd').first()).toHaveCSS('filter', /blur/);
  });

  test('settings: exported with the others, and a second browser tab follows the shield', async ({ page, context }) => {
    await boot(page, '/?demo');
    expect(await page.evaluate(() => settingsKeys())).toContain(MX);
    const other = await context.newPage();
    await other.goto('/?demo');
    await page.keyboard.press(SHIELD_KEY);
    await expect(other.locator('html')).toHaveClass(/td-shield/);
    await other.close();
  });

  test('hold ⌥ peeks; any other key ends the peek', async ({ page }) => {
    await boot(page, '/?demo');
    await page.keyboard.press(SHIELD_KEY);
    await page.keyboard.down('Alt');
    await expect(page.locator('html')).toHaveClass(/mx-peek/);
    expect(await covered(firstPane(page))).toBe(false);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('html')).not.toHaveClass(/mx-peek/);
    await page.keyboard.up('Alt');
    expect(await covered(firstPane(page))).toBe(true);
  });

  test('live: typing reaches the shell under the cover; an approval still flags while the toast text is blurred', async ({ page, request }) => {
    const ids = wsIds(page);
    await boot(page, '/');
    await expect.poll(() => ids.length).toBe(1);
    await page.locator('.win .xterm').first().click({ force: true });
    await page.keyboard.press(SHIELD_KEY);
    await page.keyboard.type('echo under-the-shield\n');
    await expect(page.locator('.win .badge.cmd').first()).toContainText('under-the-shield');
    expect(await covered(firstPane(page))).toBe(true);

    const send = agentSend(request, ids[0]);
    await send('permission_request', { tool: 'Bash', detail: 'rm -rf build' });
    await expect(page.locator('.wtab.approval')).toHaveCount(1);
    expect(await covered(firstPane(page))).toBe(true);
    const toast = page.locator('.toast', { hasText: 'Needs approval' });
    if (await toast.count()) await expect(toast.locator('.t-msg')).toHaveCSS('filter', /blur/);
  });

  test('live: OSC 7777;shield from the shell locks its tab; no sequence can unlock it', async ({ page }) => {
    await boot(page, '/');
    await page.locator('.win .xterm').first().click({ force: true });
    await page.keyboard.type("printf '\\033]7777;shield\\007'\n");
    await expect(page.locator('.win-pane.mx-lock')).toHaveCount(1);
    await expect(page.locator('html')).not.toHaveClass(/td-shield/);
    await page.waitForTimeout(1100);   // past the rate limit
    await page.keyboard.type("printf '\\033]7777;off\\007'; printf '\\033]7777;unshield\\007'\n");
    await page.waitForTimeout(500);
    await expect(page.locator('.win-pane.mx-lock')).toHaveCount(1);
  });

  test('walk-away: pets at 45s, the shield after the set minutes; moving the mouse is not enough, a click is', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await boot(page, '/?demo', { away: 2 });
    await page.clock.runFor(50000);
    await expect(page.locator('#petfield .pet').first()).toBeAttached();
    await expect(page.locator('html')).not.toHaveClass(/td-shield/);
    await page.clock.runFor(75000);
    await expect(page.locator('html')).toHaveClass(/td-shield/);
    await page.mouse.move(200, 200);
    await page.clock.runFor(2500);
    await expect(page.locator('html')).toHaveClass(/td-shield/);
    await page.mouse.click(300, 300);
    await expect(page.locator('html')).not.toHaveClass(/td-shield/);
  });

  test('walk-away: losing focus alone never shields', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await boot(page, '/?demo', { away: 2 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.clock.runFor(60000);   // pets come out on focus loss; the shield waits for real idle minutes
    await expect(page.locator('html')).not.toHaveClass(/td-shield/);
  });
});

  test('top-bar Privacy button: one click hides all, the caret holds the narrower choices', async ({ page }) => {
    await boot(page, '/?demo');
    const btn = page.locator('#privacy-btn');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('html')).toHaveClass(/td-shield/);
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(btn).toHaveClass(/active/);
    await page.locator('#privacy-caret').click();
    await expect(page.locator('.ctxmenu .ctx-item')).toHaveText([/Show all terminals/, /Hide this project/, /Show the focused tab/, /Cover the focused tab for now/, /Privacy & effects/]);   // the shield covers the focused tab: the item offers to show it
    await page.locator('.ctxmenu .ctx-item', { hasText: 'Show all terminals' }).click();
    await expect(page.locator('html')).not.toHaveClass(/td-shield/);
    await page.locator('#privacy-caret').click();
    await page.locator('.ctxmenu .ctx-item', { hasText: 'Hide this project' }).click();
    expect(await covered(firstPane(page))).toBe(true);
  });

  test('the palette finds it by the words people type', async ({ page }) => {
    await boot(page, '/?demo');
    const first = async (q) => { await page.locator('#pal-input').fill(q); return page.locator('#pal-list .pi-label').first().textContent(); };
    await page.keyboard.press('ControlOrMeta+k');
    expect(await first('screen share')).toBe('Privacy shield');
    expect(await first('streaming')).toBe('Privacy shield');
    await page.locator('#pal-input').fill('blur');
    await expect(page.locator('#pal-list .pi-label', { hasText: 'Privacy & effects…' })).toHaveCount(1);
  });

  test('"Shield this tab" under the global shield shows just that tab, and hides it again; the next ⌘⌥X hides it too', async ({ page }) => {
    await boot(page, '/?demo');
    await page.keyboard.press('ControlOrMeta+Alt+KeyT');
    await expect(page.locator('.win')).toHaveCount(2);
    const btn = page.locator('.win .wbtn.shield').first();
    const panes = page.locator('.win-pane.active');
    const shown = async () => [await covered(panes.nth(0)), await covered(panes.nth(1))];
    const sub = async () => {
      await page.locator('.win .xterm').first().click({ force: true });       // the second window overlaps it
      await page.keyboard.press('ControlOrMeta+k');
      await page.locator('#pal-input').fill('shield this tab');
      const t = await page.locator('#pal-list .pal-item', { hasText: 'Shield this tab' }).locator('.pi-sub').innerText();
      await page.keyboard.press('Escape');
      return t;
    };
    await page.keyboard.press(SHIELD_KEY);
    expect(await shown()).toEqual([true, true]);
    await expect(btn).toHaveAttribute('title', /^Hidden by the privacy shield/);
    expect(await sub()).toMatch(/^On \u2014 hidden by the privacy shield/);

    await btn.click();                                                           // let this one tab through
    expect(await shown()).toEqual([false, true]);
    await expect(page.locator('.toast', { hasText: 'Showing this tab' })).toContainText('still covers the rest');
    await expect(page.locator('html')).toHaveClass(/td-shield/);
    expect(await sub()).toMatch(/^Off \u2014 shown while the shield covers the rest/);
    expect(await page.evaluate(() => activeTab([...sessions.values()][0]).shield)).toBe(false);   // not a saved tab lock

    await btn.click();                                                           // and back under
    expect(await shown()).toEqual([true, true]);
    await expect(page.locator('.toast', { hasText: 'Tab hidden again' })).toBeVisible();

    await btn.click();                                                           // through again, then shield off and on:
    await page.keyboard.press(SHIELD_KEY);
    await page.keyboard.press(SHIELD_KEY);
    expect(await shown()).toEqual([true, true]);                                 // a fresh shield hides everything
  });

test.describe('focus veil', () => {
  test('live: waits 3s, then veils a working agent with name + time only; stays ≥1.5s; approval lifts it at once', async ({ page, request }) => {
    const ids = wsIds(page);
    await boot(page, '/', { veil: 'agents', veilStyle: 'blur' });
    await expect.poll(() => ids.length).toBe(1);
    const send = agentSend(request, ids[0]), veil = page.locator('.mx-veil');
    await send('tool_start', { tool: 'Bash', detail: 'cat /etc/secret' });
    await page.waitForTimeout(1500);
    await expect(veil).toHaveCount(0);
    await expect(veil).toHaveCount(1, { timeout: 4000 });
    await page.mouse.move(5, 5);                // off the pane: hovering peeks
    await expect(page.locator('.mx-pill-name')).toHaveText(/session .* · tab/);
    await expect(page.locator('.mx-pill')).not.toContainText('secret');
    await expect(page.locator('.win-pane.mx-veil-blur .xterm-screen')).toHaveCSS('filter', /blur/);
    await send('stop');                         // just shown: the min on-time keeps it a moment
    await expect(veil).toHaveCount(1);
    await expect(veil).toHaveCount(0, { timeout: 3000 });

    await send('tool_start', { tool: 'Read' });
    await expect(veil).toHaveCount(1, { timeout: 6000 });
    await send('permission_request', { tool: 'Bash', detail: 'rm -rf build' });
    await expect(veil).toHaveCount(0, { timeout: 1000 });
  });

  test('live: hover peeks, a key ends it for this run (and still reaches the shell), the eye button opts the tab out', async ({ page, request }) => {
    const ids = wsIds(page);
    await boot(page, '/', { veil: 'agents', veilStyle: 'solid' });
    await expect.poll(() => ids.length).toBe(1);
    const send = agentSend(request, ids[0]), veil = page.locator('.mx-veil');
    await send('tool_start', { tool: 'Bash' });
    await expect(veil).toHaveCount(1, { timeout: 5000 });
    await page.locator('.win-pane.active').hover();
    await expect(veil).toHaveCSS('opacity', '0.15');
    await page.locator('.win .xterm').first().click({ force: true, position: { x: 20, y: 20 } });   // a click ends it too (the pill in the middle is its own button)
    await expect(veil).toHaveCount(0);
    await send('tool_start', { tool: 'Edit' });                          // same run: stays off
    await page.waitForTimeout(3500);
    await expect(veil).toHaveCount(0);

    await send('stop'); await send('tool_start', { tool: 'Bash' });      // new run → veiled again
    await expect(veil).toHaveCount(1, { timeout: 5000 });
    await page.keyboard.type('x');
    await expect(veil).toHaveCount(0);
    await send('stop'); await send('tool_start', { tool: 'Bash' });
    await expect(veil).toHaveCount(1, { timeout: 5000 });
    await page.locator('.mx-pill-off').click();
    await send('stop'); await send('tool_start', { tool: 'Bash' });
    await page.waitForTimeout(3500);
    await expect(veil).toHaveCount(0);
  });

  test('live: "rain behind the text" keeps the terminal readable and usable, and restores its background when the agent stops', async ({ page, request }) => {
    const ids = wsIds(page);
    await boot(page, '/', { veil: 'agents', veilStyle: 'behind' });
    await expect.poll(() => ids.length).toBe(1);
    const send = agentSend(request, ids[0]), pane = firstPane(page);
    await send('tool_start', { tool: 'Bash' });
    await expect(pane).toHaveClass(/mx-veil-behind/, { timeout: 5000 });
    await expect(page.locator('.mx-pill')).toHaveCount(0);                        // nothing on top of the text
    await expect(pane.locator('.xterm-screen')).toHaveCSS('opacity', '1');
    await expect(pane.locator('.xterm-screen')).toHaveCSS('filter', 'none');
    expect(await pane.evaluate((p) => { const v = p.querySelector('.mx-veil'), x = p.querySelector('.xterm');
      return +getComputedStyle(v).zIndex < +getComputedStyle(x).zIndex; })).toBe(true);   // rain under the terminal
    expect(await page.evaluate(() => { const t = activeTab([...sessions.values()][0]); return [t.term.options.allowTransparency, t.term.options.theme.background]; }))
      .toEqual([true, expect.stringMatching(/^#(?!000000)[0-9a-f]{6}00$/i)]);   // the theme's colour at alpha 0: dim text gets no black box
    const behind = (await stats(page)).filter((r) => r.kind === 'behind');
    expect(behind).toHaveLength(1);
    expect(behind[0].alpha).toBeLessThanOrEqual(0.35);                             // visible, but text keeps AA: the 'every theme' test checks it

    await page.locator('.win .xterm').first().click({ force: true, position: { x: 20, y: 20 } });
    await page.keyboard.type('echo still-working\n');                              // typing and clicking don't end it
    await expect.poll(() => page.evaluate(() => tabTail(activeTab([...sessions.values()][0]), 6))).toMatch(/\nstill-working/);
    await expect(pane).toHaveClass(/mx-veil-behind/);

    await page.evaluate(() => setGlobalTheme('dracula'));                          // a theme switch keeps the text background clear
    expect(await page.evaluate(() => activeTab([...sessions.values()][0]).term.options.theme.background)).toBe(await page.evaluate(() => THEMES.dracula.xterm.background + '00'));
    await send('stop');
    await expect(pane).not.toHaveClass(/mx-veiled/, { timeout: 3000 });
    expect(await page.evaluate(() => { const t = activeTab([...sessions.values()][0]); return [t.term.options.allowTransparency, t.term.options.theme.background]; }))
      .toEqual([false, await page.evaluate(() => THEMES.dracula.xterm.background)]);
  });

  test('live: "Cover this tab now" over rain-behind-text covers it, and a key goes back to the rain', async ({ page, request }) => {
    const ids = wsIds(page);
    await boot(page, '/', { veil: 'agents', veilStyle: 'behind' });
    await expect.poll(() => ids.length).toBe(1);
    const send = agentSend(request, ids[0]), pane = firstPane(page);
    await send('tool_start', { tool: 'Bash' });
    await expect(pane).toHaveClass(/mx-veil-behind/, { timeout: 5000 });
    await page.evaluate(() => { const s = [...sessions.values()][0]; mxVeilNow(s, activeTab(s)); });
    await expect(pane).toHaveClass(/mx-veil-blur/);
    await expect(page.locator('.mx-pill')).toHaveCount(1);
    await page.locator('.win .xterm').first().click({ force: true, position: { x: 20, y: 20 } });
    await expect(pane).toHaveClass(/mx-veil-behind/);
    await expect(page.locator('.mx-pill')).toHaveCount(0);
  });

  test('theme menu: app-wide switches in the top bar\'s, a per-window override in a window\'s own', async ({ page, request }) => {
    const ids = wsIds(page);
    await boot(page, '/');
    await page.keyboard.press('ControlOrMeta+Alt+KeyT');
    await expect.poll(() => ids.length).toBe(2);
    await page.locator('#theme-btn').click();
    const sw = page.locator('#theme-fx .tfx');
    await expect(sw).toHaveCount(2);
    await expect(sw.nth(0)).toHaveAttribute('aria-checked', 'false');
    await sw.nth(0).click();
    await expect(sw.nth(0)).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => mx.bg)).toBe(true);
    await sw.nth(0).click();
    await page.keyboard.press('Escape');

    await page.evaluate(() => { const s = [...sessions.values()][0]; openThemePop(s, s.bShield); });
    await expect(sw).toHaveCount(1);
    await expect(page.locator('#theme-fx .tfx-note')).toContainText('follows the default');
    await sw.click();
    await expect(page.locator('#theme-fx .tfx-note')).toContainText('This window only');
    await page.keyboard.press('Escape');
    for (const id of ids) await agentSend(request, id)('tool_start', { tool: 'Bash' });
    await expect(page.locator('.win').nth(0).locator('.win-pane.mx-veil-behind')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.win').nth(1).locator('.win-pane.mx-veiled')).toHaveCount(0);   // the default is still off
    expect(await page.evaluate(() => mx.veil)).toBe('off');

    await page.waitForTimeout(400);
    await page.reload();                                                                          // the override is saved with the window
    await expect.poll(() => page.evaluate(() => [...sessions.values()][0]?.fx)).toBe(true);
    await page.evaluate(() => { const s = [...sessions.values()][0]; openThemePop(s, s.bShield); });
    await page.locator('#theme-fx .tfx-link', { hasText: 'Use default' }).click();
    expect(await page.evaluate(() => [...sessions.values()][0].fx)).toBe(null);
  });

  test('turning the rain on leaves "always on" pets as they are, and both show', async ({ page }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem('pets-seeded')) { localStorage.setItem('td.pets.v1', 'on'); sessionStorage.setItem('pets-seeded', '1'); } });
    await boot(page, '/?demo');
    await page.evaluate(() => setBg(true));
    expect(await page.evaluate(() => petsMode())).toBe('on');
    await expect(page.locator('.toast', { hasText: 'Pixel pets' })).toHaveCount(0);
    await expect(page.locator('#petfield .pet').first()).toBeAttached();
    expect(await page.locator('.mx-bg').evaluate((c) => +c.style.opacity)).toBeGreaterThan(0);
  });

  test('"Privacy & effects…" is one plain-words dialog; Save applies it; the palette lists the quick toggles', async ({ page }) => {
    await boot(page, '/?demo');
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#pal-cats .pal-cat', { hasText: 'Privacy' }).click();
    await expect(page.locator('#pal-list .pi-label')).toHaveText(['Privacy shield', 'Shield this tab', 'Shield this project', 'Matrix rain background', 'Cover this tab now', 'Privacy & effects…']);
    await page.locator('#pal-list .pal-item', { hasText: 'Privacy & effects…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Privacy & effects' });
    await expect(dlg).toBeVisible();
    const sel = dlg.locator('select');
    await expect(sel).toHaveCount(5);
    await sel.nth(0).selectOption({ label: 'Matrix rain behind the text' });
    await sel.nth(1).selectOption('on');
    await sel.nth(2).selectOption('blur');
    await sel.nth(3).selectOption('on');
    await sel.nth(4).selectOption('5');
    await dlg.getByRole('button', { name: 'Save' }).click();
    expect(await page.evaluate(() => ({ ...mx }))).toMatchObject({ veil: 'agents', veilStyle: 'behind', bg: true, shieldStyle: 'blur', titles: true, away: 5 });
    await expect(page.locator('.toast', { hasText: 'Privacy & effects saved' })).toContainText('rain behind text');
    await expect(page.locator('.mx-bg')).toHaveCount(1);

    await page.keyboard.press('ControlOrMeta+k');                                  // Cancel changes nothing
    await page.locator('#pal-input').fill('privacy & effects');
    await page.locator('#pal-list .pal-item', { hasText: 'Privacy & effects…' }).click();
    await page.getByRole('dialog', { name: 'Privacy & effects' }).locator('select').nth(0).selectOption('off');
    await page.getByRole('dialog', { name: 'Privacy & effects' }).getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => mx.veil)).toBe('agents');
  });

  test('rain veils: 4 animate and the rest are still; ≤4 pane draws per frame; own seeds; hidden panes stop drawing', async ({ page }) => {
    await boot(page, '/?demo', { veilStyle: 'rain' });
    for (let i = 0; i < 5; i++) await page.keyboard.press('ControlOrMeta+Alt+KeyT');
    await expect(page.locator('.win')).toHaveCount(6);
    await page.evaluate(() => sessions.forEach((s) => mxVeilNow(s, activeTab(s))));
    const veils = (await stats(page)).filter((r) => r.kind === 'veil');
    expect(veils).toHaveLength(6);
    expect(veils.filter((r) => r.static)).toHaveLength(2);
    expect(new Set(veils.map((r) => r.seed)).size).toBe(6);

    const r = await page.evaluate(() => new Promise((ok) => {
      const sum = () => window.mxStats().filter((x) => x.kind === 'veil').reduce((a, x) => a + x.draws, 0);
      const d0 = sum(); let frames = 0; const t0 = performance.now();
      const f = () => { frames++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else ok({ draws: sum() - d0, frames }); };
      requestAnimationFrame(f);
    }));
    expect(r.draws).toBeGreaterThan(10);
    expect(r.draws).toBeLessThanOrEqual(4 * r.frames + 4);

    await page.evaluate(() => sessions.forEach((s) => minimize(s)));
    const before = (await stats(page)).reduce((a, x) => a + x.draws, 0);
    await page.waitForTimeout(700);
    expect((await stats(page)).reduce((a, x) => a + x.draws, 0)).toBe(before);
  });

  test('reduced motion: rain is a still frame and the loop stays quiet', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, '/?demo', { bg: true, veilStyle: 'rain' });
    await page.evaluate(() => sessions.forEach((s) => mxVeilNow(s, activeTab(s))));
    const a = await stats(page);
    expect(a.length).toBe(2);
    expect(a.every((x) => x.static)).toBe(true);
    await page.waitForTimeout(600);
    expect((await stats(page)).map((x) => x.draws)).toEqual(a.map((x) => x.draws));
  });

  test('slow frames step the rain down and never back up (Chromium CPU throttling)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP CPU throttling is Chromium-only');
    await boot(page, '/?demo', { bg: true, veilStyle: 'rain' });
    for (let i = 0; i < 3; i++) await page.keyboard.press('ControlOrMeta+Alt+KeyT');
    await page.evaluate(() => sessions.forEach((s) => mxVeilNow(s, activeTab(s))));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 40 });
    await expect.poll(() => page.evaluate(() => +(document.documentElement.dataset.mxLevel || 0)), { timeout: 20000 }).toBeGreaterThan(0);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const lvl = await page.evaluate(() => +document.documentElement.dataset.mxLevel);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => +document.documentElement.dataset.mxLevel)).toBeGreaterThanOrEqual(lvl);
  });
});

test.describe('matrix rain background', () => {
  test('behind the windows, click-through; hidden when a window is maximized', async ({ page }) => {
    await boot(page, '/?demo', { bg: true });
    const bg = page.locator('#desktop > canvas.mx-bg');
    await expect(bg).toHaveCount(1);
    expect(await bg.evaluate((c) => c === c.parentElement.firstElementChild)).toBe(true);
    await expect(bg).toHaveCSS('pointer-events', 'none');
    await expect(bg).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');   // fades to transparent: true black on AMOLED
    await expect.poll(async () => +(await bg.evaluate((c) => c.style.opacity))).toBeGreaterThan(0);
    await page.locator('.win .wbtn[title="Expand"]').first().click();
    await expect.poll(() => bg.evaluate((c) => c.style.opacity), { timeout: 3000 }).toBe('0');
  });

  test('stays visible when windows overlap but leave desktop free; hides when they really cover it', async ({ page }) => {
    await boot(page, '/?demo', { bg: true });
    for (let i = 0; i < 3; i++) await page.keyboard.press('ControlOrMeta+Alt+KeyT');
    await page.evaluate(() => [...sessions.values()].forEach((s, i) => Object.assign(s.win.style, { left: 20 + i * 30 + 'px', top: 20 + i * 30 + 'px', width: '420px', height: '260px' })));
    expect(await page.evaluate(() => mxCovered())).toBe(false);   // four overlapping windows, most of the desktop still visible
    await page.evaluate(() => tileAll());
    await expect.poll(() => page.evaluate(() => mxCovered())).toBe(true);
  });

  test('the rain moves by time, not frames: columns keep their own pace and a dropped frame doesn\'t slow it', async ({ page }) => {
    await boot(page, '/?demo', { veilStyle: 'rain' });
    await page.evaluate(() => { const s = [...sessions.values()][0]; mxVeilNow(s, activeTab(s)); });
    const fall = await page.evaluate(async () => {
      const r = [...mxRains].find((x) => x.kind === 'veil');
      const speeds = new Set(r.speed.map((v) => v.toFixed(2)));
      const y0 = r.drops.slice(); mxDraw(r, 0.5); const moved = r.drops.map((y, i) => y - y0[i]).filter((d) => d > 0 && d < 20);
      return { distinct: speeds.size, avg: moved.reduce((a, b) => a + b, 0) / moved.length };
    });
    expect(fall.distinct).toBeGreaterThan(5);
    expect(fall.avg).toBeGreaterThan(14 * 0.6 * 0.5 - 0.01);   // half a second at 14 rows/s × the slowest pace
    expect(fall.avg).toBeLessThan(14 * 0.5 + 0.01);
  });

  test('maximizing a window keeps its rain running instead of restarting it from the top', async ({ page }) => {
    await boot(page, '/?demo', { veilStyle: 'rain' });
    await page.evaluate(() => { const s = [...sessions.values()][0]; mxVeilNow(s, activeTab(s)); });
    const before = await page.evaluate(() => { const r = [...mxRains].find((x) => x.kind === 'veil'); mxDraw(r, 2); return { w: r.w, drops: r.drops.slice(), speed: r.speed.slice() }; });
    await page.evaluate(() => toggleMax([...sessions.values()][0]));
    await expect.poll(() => page.evaluate(() => [...mxRains].find((x) => x.kind === 'veil').w)).toBeGreaterThan(before.w);
    const after = await page.evaluate(() => {
      const r = [...mxRains].find((x) => x.kind === 'veil'), d = r.g.getImageData(0, 0, r.w, r.h).data;
      let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) lit++;
      return { w: r.w, drops: r.drops.slice(), speed: r.speed.slice(), lit };
    });
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.speed.slice(0, before.speed.length)).toEqual(before.speed);                   // the same columns carry on
    const kept = after.drops.slice(0, before.drops.length).filter((y, i) => y >= before.drops[i]).length;
    expect(kept).toBeGreaterThan(before.drops.length * 0.8);                                    // still falling from where they were (a few may wrap)
    expect(after.drops.slice(before.drops.length).every((y) => y >= 0)).toBe(true);           // new columns start on screen, not above it
    expect(after.lit).toBeGreaterThan(0);                                                       // the old frame was kept
  });

  test('shrinking the window doesn\'t restart the rain: columns the new bottom cuts off carry on mid-screen', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await boot(page, '/?demo', { bg: true });
    await page.evaluate(() => { const r = [...mxRains].find((x) => x.kind === 'bg'); for (let i = 0; i < r.drops.length; i++) r.drops[i] = 40 + (i % 8); });   // most heads low on screen
    await page.setViewportSize({ width: 1200, height: 450 });
    await expect.poll(() => page.evaluate(() => [...mxRains].find((x) => x.kind === 'bg').h)).toBeLessThan(450);
    const r = await page.evaluate(() => { const r = [...mxRains].find((x) => x.kind === 'bg'); return { rows: Math.ceil(r.h / 16), drops: r.drops.slice() }; });
    // On screen, not queued to restart from the top together (the bug left over half the columns there); a few heads
    // reach the bottom and restart on their own between the resize and this read.
    expect(r.drops.filter((y) => y < 0 || y > r.rows + 2).length).toBeLessThan(r.drops.length * 0.15);
    expect(new Set(r.drops.map((y) => Math.floor(y))).size).toBeGreaterThan(8);                 // spread out, not one band
  });

  test('live: speed follows the agents (idle → working → calm); pets join the rain only when idle', async ({ page, request }) => {
    const ids = wsIds(page);
    await boot(page, '/', { bg: true });
    await expect.poll(() => ids.length).toBe(1);
    const bg = page.locator('.mx-bg'), send = agentSend(request, ids[0]);
    await expect(bg).toHaveAttribute('data-speed', 'idle');
    await send('tool_start', { tool: 'Bash' });
    await expect(bg).toHaveAttribute('data-speed', 'working');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));   // away while working: rain, no pets
    await page.waitForTimeout(300);
    await expect(page.locator('#petfield .pet')).toHaveCount(0);
    await send('stop');
    await expect(bg).toHaveAttribute('data-speed', 'calm');
    await expect(page.locator('#petfield .pet')).toHaveCount(0);         // waiting: neither
    await page.evaluate(() => { [...sessions.values()].forEach((s) => s.tabs.forEach((t) => setWaiting(s, t, false))); updateAgentOverview(); });
    await page.evaluate(() => { const s = [...sessions.values()][0]; activeTab(s).agent = false; updateAgentOverview(); });
    await expect(bg).toHaveAttribute('data-speed', 'idle');
    await expect(page.locator('#petfield .pet').first()).toBeAttached();  // away + idle: pets in front of the rain, which keeps falling
    expect(await bg.evaluate((c) => +c.style.opacity)).toBeGreaterThan(0);
    const draws = await page.evaluate(() => window.mxStats().find((r) => r.kind === 'bg').draws);
    await expect.poll(() => page.evaluate(() => window.mxStats().find((r) => r.kind === 'bg').draws)).toBeGreaterThan(draws + 5);
  });

  test('every theme: same faint contrast; High Contrast gets no rain; light themes a dark head; Matrix offers it once', async ({ page }) => {
    await boot(page, '/?demo', { bg: true });
    const rows = await page.evaluate(() => THEME_ORDER.map((id) => {
      setGlobalTheme(id);
      const cs = getComputedStyle(document.documentElement), v = (k) => cs.getPropertyValue(k).trim();
      const c = document.querySelector('.mx-bg'), a = +c.dataset.alpha;
      return { id, op: c.style.opacity, ratio: contrast(mxMix(v('--accent'), v('--bg'), a), v('--bg')), headDark: lum(c.dataset.head) < lum(v('--bg')), light: lum(v('--bg')) > 0.4 };
    }));
    for (const r of rows) {
      if (r.id === 'highContrast') { expect(r.op, r.id).toBe('0'); continue; }
      expect(r.ratio, r.id).toBeGreaterThanOrEqual(1.2);
      expect(r.ratio, r.id).toBeLessThan(1.6);
      expect(r.headDark, r.id).toBe(r.light);
    }
    await expect(page.locator('.toast', { hasText: 'Turn on Matrix rain?' })).toHaveCount(0);   // already on: no offer
  });

  test('picking the Matrix theme offers the rain once and never turns it on by itself', async ({ page }) => {
    await boot(page, '/?demo');
    await page.evaluate(() => setGlobalTheme('matrix'));
    await expect(page.locator('.toast', { hasText: 'Turn on Matrix rain?' })).toHaveCount(1);
    expect(await page.evaluate(() => mx.bg)).toBe(false);
    await page.evaluate(() => { setGlobalTheme('console'); setGlobalTheme('matrix'); });
    await expect(page.locator('.toast', { hasText: 'Turn on Matrix rain?' })).toHaveCount(1);
  });
});
