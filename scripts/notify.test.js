// node scripts/notify.test.js — webhook config, throttle, detail switch, dead-endpoint tolerance (#84)
const assert = require('assert');
const http = require('http');
const { configFrom, createNotifier } = require('./notify');

assert.strictEqual(configFrom({}), null);
assert.throws(() => configFrom({ TD_NOTIFY_URL: 'nope' }));
assert.throws(() => configFrom({ TD_NOTIFY_URL: 'ftp://x/y' }));
assert.deepStrictEqual([...configFrom({ TD_NOTIFY_URL: 'http://x/y' }).events], ['permission_request']);

const got = [];
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => b += d); req.on('end', () => { got.push({ h: req.headers, b: JSON.parse(b) }); res.end(); }); });
srv.listen(0, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${srv.address().port}/t`;
  const notify = createNotifier(configFrom({ TD_NOTIFY_URL: url, TD_NOTIFY_DETAIL: '0' }));
  const ev = { type: 'permission_request', tool: 'Bash', detail: 'secret cmd', session: 's1' };
  notify('t1', ev, { project: 'proj', link: 'http://h/#t=t1' });
  notify('t1', ev, { project: 'proj', link: 'http://h/#t=t1' });                    // throttled
  notify('t1', { ...ev, type: 'stop' }, { project: 'proj', link: 'x' });            // event not enabled
  notify('t2', ev, { project: 'proj', link: 'http://h/#t=t2' });                    // other terminal
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(got.length, 2);
  assert.strictEqual(got[0].b.detail, undefined);
  assert.strictEqual(got[0].b.url, 'http://h/#t=t1');
  assert.strictEqual(got[0].h.click, 'http://h/#t=t1');
  srv.close();
  let warns = 0;                                                                     // dead endpoint: one warning, no throw
  const dead = createNotifier(configFrom({ TD_NOTIFY_URL: 'http://127.0.0.1:1/' }), { warn: () => warns++ });
  dead('a', ev, { project: 'p', link: 'l' }); dead('b', ev, { project: 'p', link: 'l' });
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(warns, 1);
  console.log('notify ok');
});
