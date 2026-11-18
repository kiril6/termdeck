// Secret redaction (#226) for text that leaves the live terminal: Save output, session logs, the approvals log and
// the webhook. One source for both sides — the browser loads it as a classic script, the server `require`s it
// (scripts/redact.js). Pattern based, so a best effort: it catches well-known token shapes and NAME=value
// assignments, not every secret.
const REDACTED = "[REDACTED]";
const SECRET_RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
  [/\b(?:sk-ant-|sk-|rk_live_|sk_live_|pk_live_)[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{30,})/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],                       // JWT
  [/(\b(?:Authorization|Proxy-Authorization)\s*:\s*(?:Bearer|Basic|Token)\s+)[^\s"']+/gi, "$1" + REDACTED],
  [/(:\/\/[^\s/:@]+:)[^\s/@]+(?=@)/g, "$1" + REDACTED],                                                   // user:pass@host
  [/(\b[A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?)[A-Za-z0-9_.-]*["']?\s*[=:]\s*["']?)[^\s"',;]{6,}/gi, "$1" + REDACTED],
];
function redactSecrets(text) {
  let s = String(text);
  for (const [re, to] of SECRET_RULES) s = s.replace(re, to);
  return s;
}
if (typeof module !== "undefined" && module.exports) module.exports = { redactSecrets };
