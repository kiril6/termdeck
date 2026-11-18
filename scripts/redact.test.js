// node scripts/redact.test.js — secret redaction (#226): token shapes, assignments, no false positives, opt-out, webhook.
const assert = require('assert');
const http = require('http');
const { redactSecrets } = require('../public/js/redact.js');
const { redact } = require('./redact');
const { createNotifier, configFrom } = require('./notify');

const R = '[REDACTED]';
const cases = [
  ['key sk-ant-api03-abcdefghijklmnopqrstuvwx used', 'key ' + R + ' used'],
  ['export OPENAI_API_KEY=sk-proj1234567890abcdefghij', 'export OPENAI_API_KEY=' + R],
  ['ghp_' + 'a'.repeat(36), R],
  ['github_pat_' + 'A1'.repeat(25), R],
  ['AKIAIOSFODNN7EXAMPLE', R],
  ['xoxb-1234567890-abcdefghij', R],
  ['Authorization: Bearer abc.def-123', 'Authorization: Bearer ' + R],
  ['curl https://user:hunter2pw@host/x', 'curl https://user:' + R + '@host/x'],
  ['DB_PASSWORD="s3cretvalue"', 'DB_PASSWORD="' + R + '"'],
  ['"api_key": "abcdef123456"', '"api_key": "' + R + '"'],
  ['eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4', R],
  ['-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\nafter', R + '\nafter'],
];
for (const [i, o] of cases) assert.strictEqual(redactSecrets(i), o, i);
for (const t of ['npm test passed', 'token: x', 'git push origin main', 'the password prompt appeared', 'sk-short', 'https://example.com/a?b=c', 'KEY=1'])
  assert.strictEqual(redactSecrets(t), t, 'false positive: ' + t);

assert.strictEqual(redact('TOKEN=abcdefghij'), 'TOKEN=' + R);
process.env.TD_REDACT = '0';
assert.strictEqual(redact('TOKEN=abcdefghij'), 'TOKEN=abcdefghij', 'TD_REDACT=0 switches it off');
delete process.env.TD_REDACT;
assert.strictEqual(redact(undefined), undefined);

// The webhook detail never carries the raw secret.
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => { res.end(); srv.close(); assert.ok(!b.includes('abcdefghij') && b.includes(R), b); console.log('redact.test: ok'); });
});
srv.listen(0, '127.0.0.1', () => {
  createNotifier(configFrom({ TD_NOTIFY_URL: `http://127.0.0.1:${srv.address().port}/`, TD_NOTIFY_DETAIL: '1' }))('t1', { type: 'permission_request', tool: 'Bash', detail: 'TOKEN=abcdefghij run' }, { project: 'p', link: 'x' });
});
