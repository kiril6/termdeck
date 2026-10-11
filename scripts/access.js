// Local access secret. Any local program (an agent running inside termdeck, another OS user) can reach the
// loopback port, so the browser proves itself with a secret only it holds: one random value in
// ~/.termdeck/token (0600), created on first start and kept across restarts. The browser gets it once via the
// /?t=… link (auto-opened, or `termdeck open`) and keeps it as an HttpOnly cookie. Terminals never see it: each
// gets TD_HOOK_AUTH, an HMAC of it scoped to that terminal's id, which can only report agent events for itself.
// (Named without KEY/SECRET/TOKEN: Codex strips such variables from hook environments by default.)
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const file = () => path.join(os.homedir(), '.termdeck', 'token');
const VALID = /^[0-9a-f]{48}$/;

function readSecret() {
  try { const s = fs.readFileSync(file(), 'utf8').trim(); return VALID.test(s) ? s : null; } catch { return null; }
}

function loadOrCreateSecret() {
  const cur = readSecret();
  if (cur) return cur;
  fs.mkdirSync(path.dirname(file()), { recursive: true, mode: 0o700 });
  const s = crypto.randomBytes(24).toString('hex');
  // Two servers starting at once must agree on one secret. Write it whole to a temp file, then link it into place:
  // the link appears complete in one step and fails if the file exists (a plain 'wx' write leaves a moment where the
  // file exists but is still empty, and the other server would take it as garbled and replace it).
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, s + '\n', { mode: 0o600 });
  try {
    try { fs.linkSync(tmp, file()); return s; }
    catch (e) {
      if (e.code === 'EEXIST') { const other = readSecret(); if (other) return other; }   // the other server won
      else { try { fs.writeFileSync(file(), s + '\n', { mode: 0o600, flag: 'wx' }); return s; } catch (e2) { if (e2.code !== 'EEXIST') throw e2; const other = readSecret(); if (other) return other; } }   // no hard links here
      fs.renameSync(tmp, file());                                                        // unreadable/garbled file: replace it
      return s;
    }
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}

const hookAuth = (secret, id) => crypto.createHmac('sha256', secret).update('hook:' + id).digest('hex');

module.exports = { file, readSecret, loadOrCreateSecret, hookAuth };
