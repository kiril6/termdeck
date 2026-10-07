// node scripts/update-check.test.js — version compare, caching, failure handling (#88)
const assert = require('assert');
const http = require('http');
const { createChecker, isNewer } = require('./update-check');

assert(isNewer('1.19.0', '1.18.0')); assert(isNewer('1.10.0', '1.9.9')); assert(isNewer('2.0.0', '1.99.99'));
assert(!isNewer('1.18.0', '1.18.0')); assert(!isNewer('1.17.9', '1.18.0')); assert(!isNewer('1.18.0-rc.1', '1.18.0'));

let hits = 0, reply = { code: 200, body: '{"version":"1.19.0"}' };
const srv = http.createServer((_q, res) => { hits++; res.statusCode = reply.code; res.end(reply.body); });
srv.listen(0, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${srv.address().port}/latest`;
  const check = createChecker('1.18.0', url);
  assert.deepStrictEqual(await check(), { current: '1.18.0', latest: '1.19.0', updateAvailable: true });
  await check(); assert.strictEqual(hits, 1, 'second call is served from the cache');
  assert.strictEqual((await createChecker('1.19.0', url)().then((r) => r.updateAvailable)), false);
  reply = { code: 500, body: '' };
  await assert.rejects(createChecker('1.18.0', url)(), /HTTP 500/);
  reply = { code: 200, body: '{"version":"<script>"}' };
  await assert.rejects(createChecker('1.18.0', url)(), /bad version/);
  srv.close();
  await assert.rejects(createChecker('1.18.0', 'http://127.0.0.1:1/')());          // offline → rejects, caller shows a friendly message
  console.log('update-check: ok');
});
