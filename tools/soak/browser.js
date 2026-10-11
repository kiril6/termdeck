// node tools/soak/browser.js — frontend soak numbers against a real server (N=20 terminals by default).
//   load        DOMContentLoaded / load time and JS heap
//   renderers   N terminals over two projects (12 per project): how many draw with WebGL and how many fell back to
//               the slower DOM renderer, before and after switching back to the first project. Chrome keeps ~16 live
//               WebGL contexts per page.
//   streaming   frames per second while 4 terminals print as fast as they can
//   idle        main-thread busy % with every terminal idle
// Uses Playwright's Chromium, or PW_CHROMIUM=/path/to/chrome. HEADED=1 shows the window (real GPU).
const { chromium } = require('@playwright/test');
const { startServer, sleep } = require('./lib');

const N = Number(process.env.N) || 20;

(async () => {
  const srv = await startServer({ env: { TD_GRACE_MS: '2000' } });
  const browser = await chromium.launch({
    headless: !process.env.HEADED,
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    args: ['--enable-precise-memory-info'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addCookies([{ name: 'td_token', value: srv.token, url: srv.url }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('td.tourDone.v1', '1'); localStorage.setItem('td-tour-done', '1'); localStorage.setItem('td.pets.v1', '0'); } catch {} });   // tour key before and after 1.26
    const p = await ctx.newPage();
    const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('error: ' + e.message));
    const heap = () => p.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
    // Per visible terminal: WebGL draws into a canvas in .xterm-screen; the DOM renderer draws rows into .xterm-rows.
    const renderers = () => p.evaluate(() => {
      const r = { webgl: 0, dom: 0, hidden: 0 };
      for (const x of document.querySelectorAll('.xterm')) {
        if (!x.offsetParent) { r.hidden++; continue; }
        if (x.querySelector('.xterm-screen canvas')) r.webgl++; else if (x.querySelector('.xterm-rows')) r.dom++;
      }
      return r;
    });

    await p.goto(srv.url + '/', { waitUntil: 'load' });
    await p.waitForSelector('.win .xterm');
    const nav = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; });
    console.log(`load: DOMContentLoaded ${nav.dcl} ms, load ${nav.load} ms, heap ${await heap()} MB`);

    const t0 = Date.now();
    const count = () => p.locator('.xterm').count();
    while (await count() < N) {
      if (await count() === 12) { await p.locator('#padd').click(); await sleep(300); }   // 12 terminals per project
      const n = await count();
      await p.keyboard.press('Control+Alt+KeyT');
      await p.waitForFunction((n) => document.querySelectorAll('.xterm').length > n, n);
    }
    await sleep(2000);
    console.log(`renderers: opened ${N} terminals in ${Date.now() - t0} ms; second project visible:`, await renderers());
    await p.locator('.ptab').first().click(); await sleep(1500);
    console.log('renderers: back on the first project:', await renderers(), `heap ${await heap()} MB`);

    await p.evaluate(() => { window.__f = 0; const tick = () => { window.__f++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const panes = await p.locator('.win .xterm-helper-textarea').all();
    for (const ta of panes.slice(-4)) { await ta.focus(); await p.keyboard.type("yes 'termdeck soak line with some width to it' | head -n 400000\n"); }
    const f0 = await p.evaluate(() => window.__f); await sleep(5000); const f1 = await p.evaluate(() => window.__f);
    console.log(`streaming: ${((f1 - f0) / 5).toFixed(1)} fps while 4 terminals print, heap ${await heap()} MB`);

    await sleep(4000);                                     // let the streams finish
    const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
    const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const a = await metric(); await sleep(10000); const z = await metric();
    console.log(`idle: main thread busy ${(100 * (z.TaskDuration - a.TaskDuration) / 10).toFixed(2)} %, ${z.LayoutCount - a.LayoutCount} layouts, ${z.RecalcStyleCount - a.RecalcStyleCount} style recalcs in 10 s`);

    const lost = logs.filter((l) => /context ?lost|too many active webgl/i.test(l)).length;
    const errors = logs.filter((l) => l.startsWith('error'));
    console.log(`console: ${lost} WebGL context warnings, ${errors.length} errors${errors.length ? '\n  ' + errors.slice(0, 5).join('\n  ') : ''}`);
  } finally {
    await browser.close(); await srv.stop();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
