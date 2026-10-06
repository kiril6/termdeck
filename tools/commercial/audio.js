// Synthesises the ad's soundtrack (no samples, no deps) → soundtrack.wav. Cue times mirror render() in index.html.
const fs = require('fs'), path = require('path');
const SR = 44100, DUR = 19, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const TAU = Math.PI * 2;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

// add mono signal fn(t_since_start) at time `at` for `len` seconds; pan -1..1
function add(at, len, gain, fn, pan = 0) {
  const s = Math.floor(at * SR), e = Math.min(N, Math.floor((at + len) * SR));
  const gl = gain * (1 - Math.max(0, pan)), gr = gain * (1 + Math.min(0, pan));
  for (let i = s; i < e; i++) { const v = fn((i - s) / SR); L[i] += v * gl; R[i] += v * gr; }
}
const env = (t, a, len) => Math.min(1, t / a) * Math.pow(Math.max(0, 1 - t / len), 2);   // fast attack, curved decay
const sine = (f, t) => Math.sin(TAU * f * t);

// one-pole filters for noise shaping
const lp = () => { let y = 0; return (x, k) => (y += k * (x - y)); };
const hp = () => { const l = lp(); return (x, k) => x - l(x, k); };

const whoosh = (at, len = 0.9, gain = 0.5, up = true) => {
  const l = lp(), h = hp();
  add(at, len, gain, (t) => {
    const p = up ? t / len : 1 - t / len, k = 0.01 + 0.5 * p * p;
    const e = Math.sin(Math.PI * Math.min(1, t / len)) ** 2;
    return h(l(rnd(), k), 0.02) * e * 2.2;
  }, up ? -0.4 : 0.4);
};
const thud = (at, gain = 0.8, f0 = 110) => add(at, 0.5, gain, (t) => sine(f0 * Math.exp(-t * 9) + 38, t) * env(t, 0.002, 0.5) * 1.2);
const tick = (at, gain = 0.35, f = 1800, pan = 0) => add(at, 0.05, gain, (t) => (sine(f, t) * 0.5 + rnd() * 0.5) * env(t, 0.0005, 0.05), pan);
const click = (at, gain = 0.5) => { tick(at, gain, 2400); thud(at, gain * 0.5, 220); };
const bell = (at, f, gain = 0.3, len = 1.4, pan = 0) =>
  add(at, len, gain, (t) => (sine(f, t) + 0.4 * sine(f * 2.76, t) * Math.exp(-t * 6) + 0.25 * sine(f * 5.4, t) * Math.exp(-t * 12)) * env(t, 0.003, len), pan);
const pop = (at, gain = 0.4) => add(at, 0.12, gain, (t) => sine(380 + 900 * Math.exp(-t * 40), t) * env(t, 0.001, 0.12));
const sting = (at, len = 0.8, gain = 0.5) => { const l = lp(); add(at, len, gain, (t) => (sine(70, t) + 0.6 * sine(73.5, t) + 0.5 * l(rnd(), 0.15)) * env(t, 0.005, len)); };
const buzz = (at, len = 0.5, gain = 0.4) => add(at, len, gain, (t) => Math.tanh(3 * sine(95 + 20 * sine(23, t), t)) * (Math.sin(t * 90) > -0.2 ? 1 : 0.2) * env(t, 0.003, len));
const riser = (at, len, gain = 0.35) => { const h = hp(); add(at, len, gain, (t) => h(rnd(), 0.05 + 0.7 * (t / len)) * (t / len) ** 2 * 0.9 + sine(220 * Math.pow(4, t / len), t) * 0.08 * (t / len)); };
const rustle = (at, len, gain = 0.12) => { const l = lp(), h = hp(); add(at, len, gain, (t) => h(l(rnd(), 0.25), 0.05) * Math.min(1, t / 0.3) * Math.min(1, (len - t) / 0.3), 0.2); };

// --- bed: A-minor drone pad (A1 + E2 + C3), swells in and out, gentle 0.5s pulse
const pad = [55, 82.41, 130.81];
add(0, DUR, 0.16, (t) => {
  const e = Math.min(1, t / 1.2) * Math.min(1, (DUR - t) / 1.5);
  let v = 0; for (const f of pad) v += sine(f, t) + 0.3 * sine(f * 2.003, t);
  return v * e * (0.75 + 0.25 * sine(0.25, t));
});
for (let b = 3.0; b < 16.5; b += 0.5) { const accent = (b - 3) % 2 === 0; thud(b, accent ? 0.28 : 0.14, 90); if (!accent) tick(b + 0.25, 0.05, 6500); }

// --- S1 hook: three words, then glitchy chaos
[0.2, 1.0].forEach((t) => { whoosh(t - 0.15, 0.4, 0.3); thud(t + 0.1, 0.9); });
whoosh(1.75, 0.35, 0.3); buzz(1.95, 0.6, 0.5); sting(1.95, 1.0, 0.5);
riser(2.2, 1.0, 0.4);

// --- S2 queue
whoosh(2.95, 0.9, 0.55); thud(3.0, 0.7, 70);
whoosh(3.1, 1.0, 0.3);
pop(4.9, 0.35); tick(5.2, 0.12, 3000);
whoosh(4.0, 1.4, 0.25);
click(5.6, 0.6);
bell(5.9, 880, 0.3); bell(6.05, 1318.5, 0.3, 1.6, 0.2);

// --- S3 worktrees
whoosh(6.9, 0.8, 0.5, false); thud(7.05, 0.6, 80);
[7.2, 7.55, 7.9].forEach((t, i) => { thud(t + 0.1, 0.7, 120 - i * 10); tick(t + 0.12, 0.3, 1400 + i * 300, -0.4 + i * 0.4); });
for (let t = 8.4, i = 0; t < 9.05; t += 0.028 + 0.012 * Math.abs(rnd()), i++) tick(t, 0.18, 2200 + 500 * Math.abs(rnd()), 0);   // typing the git command
pop(8.8, 0.35);
bell(9.2, 988, 0.22, 0.8); bell(9.3, 1318.5, 0.22, 1.0);

// --- S4 diff
whoosh(10.8, 0.9, 0.5); thud(11.0, 0.6, 75);
pop(11.8, 0.35); rustle(11.4, 3.2);
[12.2, 12.9, 13.6].forEach((t) => tick(t, 0.1, 3500, 0.3));

// --- S5 finish
whoosh(14.6, 0.8, 0.5); thud(14.8, 0.6, 85); pop(15.2, 0.35);
click(15.85, 0.55);
[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(16.0 + i * 0.08, f, 0.28, 1.6, -0.3 + i * 0.2));
thud(16.0, 0.9, 60);

// --- S6 logo
riser(16.1, 0.85, 0.5); whoosh(16.8, 0.5, 0.5, false);
thud(17.0, 1.2, 55); sting(17.0, 1.6, 0.6);
[659.25, 987.77, 1318.5].forEach((f, i) => bell(17.0 + i * 0.06, f, 0.26, 2.2, -0.4 + i * 0.4));
tick(17.5, 0.3, 2800); tick(17.9, 0.3, 3200); bell(17.9, 1760, 0.18, 1.5);

// master: soft clip + normalise to ~-1 dBFS, final fade
let peak = 0;
for (let i = 0; i < N; i++) { const f = Math.min(1, (DUR - i / SR) / 0.5); L[i] = Math.tanh(L[i] * 0.9) * f; R[i] = Math.tanh(R[i] * 0.9) * f; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const scale = 0.89 / peak, buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * scale * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * scale * 32767), 46 + i * 4); }
const out = path.join(__dirname, 'soundtrack.wav');
fs.writeFileSync(out, buf);
console.log('wrote', out, DUR + 's');
