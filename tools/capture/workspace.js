// README screenshot: four named shells in one project → docs/screenshots/workspace-light.png (pass a theme to try others).
const path = require('path');
const { boot, typeIn, sleep, REPO_DIR, OUT } = require('./lib');
const { clearToasts } = require('./scene');
(async () => {
  const theme = process.argv[2] || 'githubLight';
  const { page, done } = await boot({ theme });
  await sleep(1000);
  await page.locator('#folder').click();
  await page.locator('#cwd-input').fill(REPO_DIR);
  await page.locator('#cwd-proj').click();
  await sleep(800);
  await page.locator('.ptab', { hasText: 'default' }).locator('.pdel').click({ force: true });
  await page.locator('.cm-ok').click();
  for (let i = 0; i < 3; i++) { await page.locator('#new').click(); await sleep(700); }
  await page.locator('#sb-btn').click();
  await sleep(400);
  await page.locator('#tile').click();
  await sleep(500);
  const wins = page.locator('.win:visible');
  const run = [
    ['tests', 'sleep 4; npm test'],
    ['server', 'python3 -m http.server 8080'],
    ['git', 'git log --oneline --graph --all && git status -s'],
    ['notes', 'cat src/orders.js && ls src test'],
  ];
  for (let i = 0; i < run.length; i++) {
    const w = wins.nth(i);
    await w.locator('.wt-name').first().dblclick(); await page.keyboard.type(run[i][0]);
    await typeIn(page, w, run[i][1] + '\n');
    await sleep(300);
  }
  await sleep(7000);
  await clearToasts(page);
  await page.mouse.move(5, 600);
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, theme === 'githubLight' ? 'workspace-light.png' : `workspace-${theme}.png`) });
  await done();
})();
