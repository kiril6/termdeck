// Renders index.html frame-by-frame (deterministic) → termdeck-ad.mp4 (+ soundtrack.wav). Usage: node tools/commercial/render.js
const { chromium } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const FPS = 30, here = __dirname;
const ffmpeg = process.env.FFMPEG || 'ffmpeg';   // needs libx264 + aac (not Playwright's bundled build)
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdad-'));
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.goto('file://' + path.join(here, 'index.html'));
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const n = Math.round(await page.evaluate(() => DURATION) * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => render(t), i / FPS);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 94 });
  }
  await browser.close();
  const out = path.join(here, 'termdeck-ad.mp4');
  execFileSync('node', [path.join(here, 'audio.js')], { stdio: 'inherit' });
  execFileSync(ffmpeg, ['-y', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.jpg'), '-i', path.join(here, 'soundtrack.wav'),
    '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log('wrote', out, n / FPS + 's');
})();
