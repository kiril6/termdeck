// "Is there a newer release?" (#88). Runs only when the user clicks Check for updates — the app makes no
// background network calls. The server asks the npm registry (the browser never contacts a third party).
const https = require('https');
const http = require('http');

const TTL_MS = 6 * 3600_000;
const TIMEOUT_MS = 5_000;
const DEFAULT_URL = 'https://registry.npmjs.org/@kiril6%2Ftermdeck/latest';

// true when a is a newer x.y.z than b (pre-release suffixes ignored)
function isNewer(a, b) {
  const n = (v) => String(v).split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function createChecker(current, url = DEFAULT_URL) {
  let cached = null;   // { v, ts } — only successes are cached, so a failed check can be retried at once
  const fetchLatest = () => new Promise((resolve, reject) => {
    const req = (url.startsWith('https:') ? https : http).get(url, { timeout: TIMEOUT_MS, headers: { Accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let b = ''; res.setEncoding('utf8');
      res.on('data', (d) => { b += d; if (b.length > 1e6) req.destroy(new Error('response too large')); });
      res.on('end', () => { try { const v = JSON.parse(b).version; /^\d+\.\d+\.\d+/.test(v) ? resolve(v) : reject(new Error('bad version')); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
  return async function check() {
    if (!cached || Date.now() - cached.ts > TTL_MS) cached = { v: await fetchLatest(), ts: Date.now() };
    return { current, latest: cached.v, updateAvailable: isNewer(cached.v, current) };
  };
}

module.exports = { createChecker, isNewer };
