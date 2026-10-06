// Hero GIF, step 2 of 2: frames → docs/screenshots/hero.gif.
// Args: MIN_DT MAX_HOLD LAST SPEED (seconds; SPEED > 1 plays faster). Raise SPEED or lower MAX_HOLD if the GIF is too long or too big.
// one shared palette, unchanged pixels transparent (frames only carry what changed), long holds capped.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const [MIN_DT = 0.12, MAX_HOLD = 1.6, LAST = 3.5, SPEED = 1.4] = process.argv.slice(2).map(Number);
const raw = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'termdeck-hero-frames.json')));
const keep = [];
for (const f of raw) { if (!keep.length || f.t - keep[keep.length - 1].t >= MIN_DT) keep.push({ ...f }); else keep[keep.length - 1].data = f.data; }
const imgs = keep.map((f) => PNG.sync.read(Buffer.from(f.data, 'base64')));
const { width: w, height: h } = imgs[0];
const sample = Buffer.concat(imgs.filter((_, i) => i % Math.ceil(imgs.length / 12) === 0).map((p) => p.data));
const pal = quantize(sample, 255);
const TP = pal.length;                       // transparent index
const palette = [...pal, [255, 0, 255]];
while (palette.length < 256) palette.push([0, 0, 0]);
const gif = GIFEncoder();
let prev = null, total = 0;
imgs.forEach((p, i) => {
  const idx = applyPalette(p.data, pal);
  const out = Uint8Array.from(idx);
  if (prev) for (let k = 0; k < out.length; k++) if (idx[k] === prev[k]) out[k] = TP;
  const dt = keep[i + 1] ? Math.min(MAX_HOLD, (keep[i + 1].t - keep[i].t) / SPEED) : LAST;
  total += dt;
  gif.writeFrame(out, w, h, { palette, delay: Math.round(dt * 1000), transparent: !!prev, transparentIndex: TP, dispose: 1 });
  prev = idx;
});
gif.finish();
const file = path.join(__dirname, '..', '..', 'docs', 'screenshots', 'hero.gif');
fs.writeFileSync(file, gif.bytes());
console.log(keep.length, 'frames', (fs.statSync(file).size / 1e6).toFixed(2), 'MB', total.toFixed(1), 's');
