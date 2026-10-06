// Shared helpers for README captures: boots a real termdeck on a throwaway HOME and drives it.
const { chromium } = require('@playwright/test');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
// Short paths outside /tmp so the UI shows tidy names. Both are wiped and rebuilt on every run.
const HOME = process.env.TD_CAPTURE_HOME || '/Users/Shared/dev';
const REPO_DIR = process.env.TD_CAPTURE_REPO || '/Users/Shared/code/shop-api';
const PORT = 4791, URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot({ width = 1440, height = 900, dsf = 2, theme = 'tokyoNight' } = {}) {
  execFileSync(path.join(__dirname, 'setup.sh'), [HOME, REPO_DIR], { stdio: 'inherit' });
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, HOME, ZDOTDIR: HOME, SHELL: '/bin/zsh', PORT: String(PORT), NO_OPEN: '1', NO_TMUX: '1', TD_GRACE_MS: '2000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.on('exit', () => srv.kill()); process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });
  srv.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 50; i++) { try { await fetch(URL); break; } catch { await sleep(200); } }
  const browser = await chromium.launch({
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  const ids = [];   // {id, cwd} per terminal websocket, in creation order
  page.on('websocket', (ws) => { const u = new globalThis.URL(ws.url()); if (u.searchParams.get('id')) ids.push({ id: u.searchParams.get('id'), cwd: u.searchParams.get('cwd') }); });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.addInitScript((theme) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('td-tour-done', '1');
    localStorage.setItem('td.theme.v2', theme);
    localStorage.setItem('td.pets.v1', '0');
    localStorage.setItem('td.aicli.v1', JSON.stringify([{ id: 'ai_demo', label: 'demo agent', cmd: 'clear' }]));
  }, theme);
  await page.route('**/xterm-addon-webgl.js', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));   // headless WebGL mis-scales; use the app's DOM fallback
  await page.goto(URL + '/');
  await page.waitForSelector('.win');
  const done = async () => { await browser.close(); srv.kill(); };
  return { page, ids, done };
}

const evt = (id, body) => fetch(URL + '/api/agent-events', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: URL }, body: JSON.stringify({ id, ...body }) });

async function palette(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('#pal-input').fill(label);
  await sleep(150);
  await page.keyboard.press('Enter');
}
async function typeIn(page, win, text) {   // type into a window's terminal
  await win.locator('.xterm').first().click({ force: true });
  await page.keyboard.type(text, { delay: 8 });
}
module.exports = { REPO_DIR, OUT, boot, evt, palette, typeIn, sleep };
