// Hero GIF, step 1 of 2: records watch → unblock → review → land from a real termdeck via CDP screencast.
// Raw frames (~170 MB) go to the OS temp dir; encode.js turns them into docs/screenshots/hero.gif.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { boot, sleep } = require('./lib');
const { prepare, clearToasts } = require('./scene');
const W = 1280, H = 800;
const FRAMES = path.join(os.tmpdir(), 'termdeck-hero-frames.json');

(async () => {
  const { page, ids, done } = await boot({ width: W, height: H, dsf: 1, theme: 'console' });
  await sleep(1000);
  const { ask } = await prepare(page, ids);
  await page.evaluate(() => {   // a visible pointer: headless screencasts don't draw one
    const c = document.createElement('div');
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11-7 1-3 7z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(640px,420px)';
    document.body.append(c);
    document.addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
  });
  const mv = async (loc) => { const b = await loc.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 }); await sleep(150); };
  await page.mouse.move(700, 450);

  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => { frames.push({ data: f.data, t: f.metadata.timestamp }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(1800);                                           // three agents, each in its own worktree
  const decision = ask();                                      // claude blocks on a permission prompt
  await sleep(2200);
  await mv(page.locator('#agent-btn'));
  await page.locator('#agent-btn').click();
  await sleep(2600);                                           // the queue: approval · waiting · working, overlaps, tokens
  await mv(page.getByRole('button', { name: 'Approve' }));
  await page.getByRole('button', { name: 'Approve' }).click();
  await decision;
  await sleep(1400);
  await page.keyboard.press('Escape');
  await clearToasts(page);
  await page.keyboard.press('ControlOrMeta+k');               // review what it changed
  await sleep(300);
  await page.keyboard.type('review', { delay: 70 });
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(1500);
  await page.mouse.move(640, 520, { steps: 10 });
  await page.mouse.wheel(0, 260);
  await sleep(1800);
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('ControlOrMeta+k');               // land it, behind a passing check
  await sleep(300);
  await page.keyboard.type('finish', { delay: 70 });
  await sleep(500);
  await page.keyboard.press('Enter');
  const chk = page.getByPlaceholder('npm test');
  await chk.waitFor();
  await sleep(700);
  await chk.click();
  await page.keyboard.type('npm test', { delay: 60 });
  await sleep(500);
  await mv(page.getByRole('button', { name: 'Finish' }));
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.locator('.cm-ok').waitFor({ timeout: 20000 });
  await sleep(900);
  await mv(page.locator('.cm-ok'));
  await page.locator('.cm-ok').click();
  await page.getByText('Merged').first().waitFor();
  await sleep(700);
  await mv(page.locator('.win:visible .xterm').first());
  await page.locator('.win:visible .xterm').first().click({ force: true });
  await page.keyboard.type('clear; git log --oneline --graph -5\n', { delay: 35 });
  await page.mouse.move(900, 420, { steps: 8 });
  await sleep(3000);
  await cdp.send('Page.stopScreencast');
  await done();
  fs.writeFileSync(FRAMES, JSON.stringify(frames));
  console.log(frames.length, 'raw frames →', FRAMES);
})();
