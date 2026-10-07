// Outgoing webhook for agent events (#84). Plain http/https from Node core, fire-and-forget.
// Unset TD_NOTIFY_URL = no network calls at all.
const http = require('http');
const https = require('https');

const DEFAULT_EVENTS = ['permission_request'];
const THROTTLE_MS = 60_000;
const TIMEOUT_MS = 5_000;

// Returns { url, events:Set, detail:boolean } or null when off. Throws on a malformed URL (doctor reports it).
function configFrom(env) {
  const raw = (env.TD_NOTIFY_URL || '').trim();
  if (!raw) return null;
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('TD_NOTIFY_URL must be http(s)');
  const events = (env.TD_NOTIFY_EVENTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { url: u, events: new Set(events.length ? events : DEFAULT_EVENTS), detail: env.TD_NOTIFY_DETAIL !== '0' };
}

const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '').slice(0, 120);   // header values must be plain ASCII

function createNotifier(cfg, { warn = console.error } = {}) {
  const last = new Map();   // "terminal:event" -> ts
  let warned = false;
  return function notify(termId, ev, { project, link }) {
    if (!cfg || !cfg.events.has(ev.type)) return;
    const key = termId + ':' + ev.type, now = Date.now();
    if (now - (last.get(key) || 0) < THROTTLE_MS) return;
    last.set(key, now);
    if (last.size > 500) for (const [k, t] of last) if (now - t > THROTTLE_MS) last.delete(k);
    const body = JSON.stringify({
      event: ev.type, project, session: ev.session, tool: ev.tool,
      ...(cfg.detail && ev.detail ? { detail: ev.detail } : {}), url: link,
    });
    // Title/Click are ntfy conveniences (tap opens termdeck); other receivers ignore them.
    const req = (cfg.url.protocol === 'https:' ? https : http).request(cfg.url, {
      method: 'POST', timeout: TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Title: ascii('termdeck: ' + project), Click: ascii(link) },
    }, (res) => res.resume());
    const fail = (e) => { if (!warned) { warned = true; warn(`  TD_NOTIFY_URL: webhook failed (${e.code || e.message}) — further failures are not logged`); } };
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', fail);
    req.end(body);
  };
}

module.exports = { configFrom, createNotifier, THROTTLE_MS };
