// node tools/soak/backend.js [throughput|stalled|churn|tmux ...] — server-side soak numbers (default: all).
//   throughput  output speed and server CPU/RSS: 1 terminal × 50 MB, then 4 in parallel × 20 MB
//   stalled     a client that stops reading while 500 MB is printed: server RSS must stay flat (backpressure)
//   churn       200 open/kill cycles: RSS growth and child processes left behind
//   tmux        20 idle durable sessions for 15 s: tmux calls/s and CPU of the server and the tmux server
// Each scenario starts its own server on a throwaway HOME. Numbers are machine-dependent: compare runs on one machine.
const { execFileSync } = require('child_process');
const { startServer, sleep, usage } = require('./lib');

const id = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const big = (mb, tag) => `head -c ${mb * 1e6} /dev/zero | tr '\\0' a | fold -w 199; echo ${tag}""_END\r`;

async function stream(srv, mb, { stall = false } = {}) {
  const t = await srv.open(id('soak'));
  if (stall) t.ws._socket.pause();                       // stop reading: the server must hold back, not buffer it all
  srv.send(t.ws, { type: 'input', data: big(mb, 'SOAK') });
  return t;
}
const waitEnd = async (t, ms = 180000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) if (t.msgs.some((m) => m.type === 'output' && m.data.includes('SOAK_END'))) return;
  throw new Error('output never finished');
};

const scenarios = {
  async throughput() {
    for (const [n, mb] of [[1, 50], [4, 20]]) {
      const srv = await startServer();
      try {
        const u0 = srv.usage(), t0 = Date.now();
        const ts = await Promise.all(Array.from({ length: n }, () => stream(srv, mb)));
        await Promise.all(ts.map((t) => waitEnd(t)));
        const s = (Date.now() - t0) / 1000, u1 = srv.usage();
        console.log(`throughput ${n}×${mb} MB: ${s.toFixed(1)} s wall, ${(n * mb / s).toFixed(1)} MB/s, server CPU ${(u1.cpu - u0.cpu).toFixed(1)} s, RSS ${u0.rssMB.toFixed(0)} → ${u1.rssMB.toFixed(0)} MB`);
      } finally { await srv.stop(); }
    }
  },

  async stalled() {
    const srv = await startServer();
    try {
      const u0 = srv.usage();
      await stream(srv, 500, { stall: true });
      let peak = 0, last = 0;
      for (let i = 0; i < 15; i++) { await sleep(1000); last = srv.usage().rssMB; peak = Math.max(peak, last); }
      console.log(`stalled reader, 500 MB printed: server RSS ${u0.rssMB.toFixed(0)} MB → peak ${peak.toFixed(0)} MB, ${last.toFixed(0)} MB after 15 s`);
    } finally { await srv.stop(); }
  },

  async churn(n = 200) {
    const srv = await startServer();
    try {
      const cycle = async () => {
        const t = await srv.open(id('churn'));
        srv.send(t.ws, { type: 'input', data: 'echo hi\r' });
        await sleep(100);
        await new Promise((ok) => { t.ws.once('close', ok); srv.send(t.ws, { type: 'kill' }); t.ws.close(); });
      };
      for (let i = 0; i < 20; i++) await cycle();         // warm-up: first PTYs load native code and grow the heap
      const r1 = srv.usage().rssMB;
      for (let i = 0; i < n; i++) await cycle();
      await sleep(3000);
      const kids = execFileSync('ps', ['-A', '-o', 'ppid='], { encoding: 'utf8' }).split('\n').filter((l) => l.trim() === String(srv.pid)).length;
      console.log(`churn ${n} open/kill cycles: RSS ${r1.toFixed(0)} → ${srv.usage().rssMB.toFixed(0)} MB after warm-up, child processes left: ${kids}`);
    } finally { await srv.stop(); }
  },

  async tmux(n = 20) {
    try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); } catch { console.log('tmux: skipped (tmux not installed)'); return; }
    const srv = await startServer({ tmux: true });
    try {
      const ts = []; for (let i = 0; i < n; i++) ts.push(await srv.open(id('tm')));
      await sleep(3000);                                  // let shells settle
      const tmuxPid = execFileSync('tmux', ['display-message', '-p', '#{pid}'], { env: { ...process.env, TMUX: '', TMUX_TMPDIR: srv.tmuxDir }, encoding: 'utf8' }).trim();
      const c0 = srv.tmuxCalls().length, s0 = srv.usage(), m0 = usage(tmuxPid);
      await sleep(15000);
      const calls = srv.tmuxCalls().slice(c0), s1 = srv.usage(), m1 = usage(tmuxPid);
      const kinds = Object.entries(calls.reduce((a, c) => ({ ...a, [c]: (a[c] || 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ');
      console.log(`tmux ${n} idle sessions, 15 s: ${(calls.length / 15).toFixed(1)} tmux calls/s (${kinds || 'none'}), CPU server ${(s1.cpu - s0.cpu).toFixed(2)} s + tmux server ${(m1.cpu - m0.cpu).toFixed(2)} s`);
    } finally { await srv.stop(); }
  },
};

(async () => {
  const pick = process.argv.slice(2);
  for (const name of pick.length ? pick : Object.keys(scenarios)) {
    if (!scenarios[name]) { console.error(`unknown scenario "${name}" — one of: ${Object.keys(scenarios).join(', ')}`); process.exit(2); }
    await scenarios[name]();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
