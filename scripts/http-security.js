// Who may talk to the server: response headers, the sign-in token and cookie, and the Origin + Host guard shared
// by every /api route and the WebSocket upgrade. server.js wires it in before any route.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const access = require('./access');

function hostnameOf(v) {                          // pull hostname from an Origin URL or a Host header
  if (!v) return null;
  try { return new URL(v.includes('://') ? v : 'http://' + v).hostname.toLowerCase(); }
  catch { return null; }
}
function tokenEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const SIGNIN_PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TermDeck — open the sign-in link</title><style>
body{font-family:ui-monospace,Menlo,monospace;background:#0b0f14;color:#c9d4de;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
main{max-width:560px;line-height:1.7;font-size:14px} h1{color:#4fd6be;font-size:18px;margin:0 0 12px}
code{background:#0e151d;padding:2px 7px;border-radius:4px;color:#4fd6be}</style></head><body><main>
<h1>This browser isn't linked to termdeck yet</h1>
<p>termdeck runs real shells, so it only answers browsers that hold its access link.</p>
<p>In a terminal on this computer, run <code>termdeck open</code> (from a clone: <code>npm start -- open</code>),
or open the link termdeck printed when it started. You only need to do this once per browser.</p>
</main></body></html>`;

function createSecurity({ host, publicDir }) {
  // Baseline headers on every response. frame-ancestors 'self': no other site can frame termdeck (clickjacking an
  // Approve / Merge button), while the file viewer can still frame its own /api/raw PDF preview.
  // The rest of the CSP limits what an injected script could do: scripts only from this origin, plus index.html's
  // inline boot-theme script by hash (read from the file at start, so editing it can't break the page). Styles stay
  // 'unsafe-inline': xterm.js and the markup set inline styles. /api/raw keeps only frame-ancestors (the browser's PDF
  // viewer runs inside that response; SVG gets its own sandbox there).
  const INLINE_SCRIPTS = (() => {
    try {
      return [...fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)]
        .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
    } catch { return ''; }
  })();
  const CSP = [
    "default-src 'self'", `script-src 'self' ${INLINE_SCRIPTS}`.trim(), "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "connect-src 'self'", "object-src 'none'", "base-uri 'none'",
    "form-action 'self'", "frame-ancestors 'self'",
  ].join('; ');
  const headers = (req, res, next) => {
    res.setHeader('Content-Security-Policy', req.path === '/api/raw' ? "frame-ancestors 'self'" : CSP);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');   // never leak /?t=… or paths to a site a link opens
    next();
  };
  const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(host);
  // One address per browser: the sign-in cookie and the duplicate-tab check (localStorage) both belong to the exact
  // host name, so a page opened as localhost would ask to sign in again and wouldn't notice a 127.0.0.1 tab already
  // driving the same shells. On the default bind, send localhost pages to 127.0.0.1 — the address termdeck prints.
  // 302, not 301: browsers must not remember it if HOST changes later.
  const toLoopbackIp = (req, res, next) => {
    if (host !== '127.0.0.1' || (req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/')) return next();
    if (String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase() !== 'localhost') return next();
    res.redirect(302, `http://127.0.0.1:${req.socket.localPort}${req.originalUrl}`);
  };
  // Every HTTP request and WS upgrade needs the td_token cookie: open /?t=<token> once (auto-opened on start, or
  // `termdeck open`) → HttpOnly cookie. Loopback has no login otherwise, and any local program (an agent inside
  // termdeck, another OS user) can reach the port, so the browser proves itself with a secret only it holds.
  // Loopback: the persistent secret in ~/.termdeck/token (cookie survives restarts). Non-loopback bind or extra
  // allowed hosts (remote access): a random per-start token — restart = new token, old cookies stop working.
  // Opt-in extra hostnames (exact match, comma-separated) for a reverse proxy such as
  // `tailscale serve` (e.g. TD_ALLOWED_HOSTS=mybox.tail1234.ts.net). No wildcards, empty by default.
  const EXTRA_HOSTS = new Set(String(process.env.TD_ALLOWED_HOSTS || '').split(',')
    .map((h) => h.trim().toLowerCase()).filter((h) => {
      if (h.includes('*')) { console.error(`  TD_ALLOWED_HOSTS: ignoring "${h}" — wildcards are not allowed`); return false; }
      return !!h;
    }));
  const LOCAL_ONLY = LOOPBACK && !EXTRA_HOSTS.size;
  let SECRET;
  try { SECRET = access.loadOrCreateSecret(); }
  catch (e) {   // unwritable home: still safe, but the sign-in link and hook keys change on every restart
    console.error(`  [access] can't keep ${access.file()} (${e.code || e.message}) — using a per-start secret`);
    SECRET = crypto.randomBytes(24).toString('hex');
  }
  const TOKEN = LOCAL_ONLY ? SECRET : crypto.randomBytes(24).toString('hex');
  function hasAuthCookie(req) {
    const m = /(?:^|;\s*)td_token=([^;]+)/.exec(req.headers.cookie || '');
    return !!m && tokenEq(m[1], TOKEN);
  }
  const signIn = (req, res, next) => {
    if (req.query.t !== undefined && tokenEq(req.query.t, TOKEN)) {
      // Behind an https proxy on an allowed host (tailscale serve, a tunnel): Secure, so the cookie never goes out over plain http.
      const secure = EXTRA_HOSTS.has(hostnameOf(req.headers.host)) && req.get('x-forwarded-proto') === 'https';
      res.setHeader('Set-Cookie', `td_token=${TOKEN}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}${LOCAL_ONLY ? '; Max-Age=34560000' : ''}`);
      return res.redirect(req.path);
    }
    if (hasAuthCookie(req)) return next();
    if (req.path === '/api/agent-events') return next();   // hooks authenticate per terminal (TD_HOOK_AUTH) — see the route
    if (req.method === 'GET' && !path.extname(req.path) && req.accepts(['html', 'json']) === 'html') return res.status(401).type('html').send(SIGNIN_PAGE);
    res.status(401).type('text').send('Unauthorized — run `termdeck open`, or open the link printed at server startup.');
  };

  // SECURITY: the WS spawns real shells. Unauthenticated + open would be RCE for any
  // web page (CSRF / DNS-rebind). Defense: bind loopback by default, and validate both
  // the Origin (blocks cross-site drive-by) and the Host header (blocks DNS-rebind,
  // where an attacker page resolves its own domain to 127.0.0.1). See listen() + verifyClient.
  const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', host.toLowerCase(), ...EXTRA_HOSTS]);
  // SECURITY: the /api routes read/reveal real paths, so they carry the SAME Origin+Host guard
  // as the WS. Loopback bind already blocks remote reach; this blocks a cross-site page
  // from driving them. `ls` responses are also same-origin-protected by the browser.
  // Sec-Fetch-Site: a cross-site <img>/<script> sends no Origin header, so reject it explicitly (every route, one place).
  function apiGuard(req, res, next) {
    const h      = hostnameOf(req.headers.host);
    const origin = hostnameOf(req.headers.origin);
    if (h      && !ALLOWED_HOSTS.has(h))      return res.status(403).end();
    if (origin && !ALLOWED_HOSTS.has(origin)) return res.status(403).end();
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).end();
    next();
  }
  function verifyClient({ req }, done) {
    const h      = hostnameOf(req.headers.host);       // always present (HTTP/1.1); rebind sets this to attacker domain
    const origin = hostnameOf(req.headers.origin);     // browsers always send it on WS; non-browser clients omit it
    if (h && !ALLOWED_HOSTS.has(h)) return done(false, 403);           // DNS-rebind guard
    if (origin && !ALLOWED_HOSTS.has(origin)) return done(false, 403); // cross-site CSRF guard
    if (!hasAuthCookie(req)) return done(false, 401);   // only the browser holds the cookie — not agents or other local users
    done(true);   // the terminal cap is enforced in the connection handler, so the client can be told WHY
  }

  return { LOOPBACK, LOCAL_ONLY, EXTRA_HOSTS, SECRET, TOKEN, middleware: [headers, toLoopbackIp, signIn], hasAuthCookie, apiGuard, verifyClient };
}

module.exports = { createSecurity, tokenEq };
