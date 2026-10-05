// Scoped allow-rules + hard deny-list for agent permission requests (#44 phase 2). Pure functions, no I/O,
// so scripts/check-rules.js can pin the security behaviour in CI.
//
// Trust model: a rule can only be derived from a command termdeck actually showed you in a held request
// (see server.js), matching is literal — exact string or token-boundary prefix — and the user never supplies
// a regex. The deny-list is BEST EFFORT, not a sandbox: it exists so obviously destructive / exfiltrating
// commands can never be covered by a rule and always need a human click.
const path = require('path');

const norm = (c) => String(c).trim();                              // no whitespace collapsing: quoted args stay literal
const OPERATORS = /[;&|`$(){}<>\\\n\r]/;                           // anything that can chain or substitute another command
const SAFE_PREFIX = /^[\w@%+=:,./-]+( [\w@%+=:,./-]+)*$/;          // plain words only: no quotes, globs, operators

const DENY = [
  [/\b(sudo|doas|su)\b/, 'privilege escalation'],
  [/\brm\s+(-\S*[rR]\S*|--recursive)\b/, 'recursive delete'],
  [/\b(shred|mkfs\S*|dd|wipefs|diskutil\s+erase\S*)\b/, 'disk / secure-delete tool'],
  [/\bfind\b.*\s(-delete|-exec|-execdir)\b/, 'find that deletes or executes'],
  [/\bgit\s+(?:\S+\s+)*push\b.*(\s-f\b|--force|--delete|\s-d\b|\s:\S)/, 'force / delete push'],
  [/\bgit\s+(?:\S+\s+)*(reset\s+--hard|clean\s+-\S*[fdx]|branch\s+-D|stash\s+(drop|clear)|checkout\s+(--\s+)?\.|restore\s+\.)/, 'discards work'],
  [/\b(curl|wget|fetch)\b[^\n]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/, 'pipes a download into a shell'],
  [/\b(ba|z)?sh\s+<\(\s*(curl|wget)/, 'runs a download in a shell'],
  [/\b(ba|z|da|k)?sh\s+-\S*c\b|\beval\b/, 'runs an arbitrary command string'],
  [/\b(python3?|node|ruby|perl|php|deno|bun)\s+(-\S*[ceEpr]\b|--eval\b|eval\b)/, 'interpreter with inline code'],
  [/(^|[\s/=:'"])\.(ssh|aws|gnupg|kube|docker|config\/gh)(\/|\s|$|['"])|\.netrc|\.npmrc|\.pypirc|id_(rsa|ed25519|ecdsa)|\/etc\/(passwd|shadow|sudoers)/, 'reads credentials'],
  [/(^|[\s/=:'"])\.env(\.[\w-]+)?(\s|$|['"])|\bsecurity\s+find-\S+/, 'reads secrets / keychain'],
  [/\b(ssh|scp|sftp|nc|ncat|socat|telnet|rsync)\b/, 'network / remote copy'],
  [/\b(curl|wget)\b.*(\s-d\s*@|--data\S*\s*@|\s-F\b|--form\b|\s-T\b|--upload-file\b)/, 'uploads a file'],
  [/\b(chmod|chown)\s+(-\S*R|--recursive|0?777\b)/, 'recursive / world-writable permissions'],
  [/\b(killall|pkill)\b|\bkill\s+-9\s+-1\b/, 'mass process kill'],
  [/:\(\)\s*\{/, 'fork bomb'],
  [/(>>?|\btee\b)\s*[^\s|;&]*\.(bashrc|zshrc|profile|zprofile|bash_profile)\b/, 'edits shell startup files'],
  [/\b(npm|yarn|pnpm|cargo|gem)\s+publish\b|\btwine\s+upload\b|\bgh\s+(repo|release|secret)\s+delete\b/, 'publishes / deletes remotely'],
  [/\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b/i, 'drops data'],
  [/\bdocker\s+run\b.*(--privileged|-v\s+\/:)/, 'privileged container'],
];

// -> reason string if the command matches the deny-list (never rule-covered), else null.
function riskReason(command) {
  const c = norm(command);
  for (const [re, why] of DENY) if (re.test(c)) return why;
  return null;
}

// Prefix a "starts with" rule may use for this command: its first two words, only when both are plain.
function prefixOf(command) {
  const w = norm(command).split(/ +/);
  if (w.length < 2) return null;
  const p = w.slice(0, 2).join(' ');
  return SAFE_PREFIX.test(p) ? p : null;
}

// rule: { agent, tool, mode: 'exact'|'prefix', pattern, dir }. ev: { agent, tool, command, cwd }.
function inDir(cwd, dir) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return false;
  const c = path.resolve(cwd), d = path.resolve(dir);   // ponytail: lexical check; a symlink out of dir isn't resolved
  return c === d || c.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
}
function matches(rule, ev) {
  if (!rule || rule.tool !== 'Bash' || ev.tool !== 'Bash' || rule.agent !== ev.agent) return false;
  if (typeof ev.command !== 'string' || !inDir(ev.cwd, rule.dir)) return false;
  const c = norm(ev.command);
  if (riskReason(c)) return false;                       // re-checked at match time: a rule never overrides the deny-list
  if (rule.mode === 'exact') return c === rule.pattern;
  if (rule.mode !== 'prefix' || !c.startsWith(rule.pattern)) return false;
  const rest = c.slice(rule.pattern.length);
  return rest === '' || (rest[0] === ' ' && !OPERATORS.test(rest));   // token boundary, and nothing chained after it
}

module.exports = { norm, riskReason, prefixOf, matches, inDir };
