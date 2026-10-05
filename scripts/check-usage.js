#!/usr/bin/env node
// CI guard (#85): token usage the hook helper reads from a CLI transcript on `stop`. Pins the two traps that
// make these numbers wrong: Claude repeats a message once per streamed block (a naive sum double-counts), and
// cache reads must stay out of `tokens`. Unknown CLI / unreadable / non-.jsonl transcript must send nothing.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const HOOK = path.join(__dirname, 'td-hook.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-usage-'));
const write = (name, rows) => { const f = path.join(dir, name); fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); return f; };
const asst = (id, input, out, cw, cr) => ({ type: 'assistant', message: { id, usage: { input_tokens: input, output_tokens: out, cache_creation_input_tokens: cw, cache_read_input_tokens: cr } } });

const claude = write('c.jsonl', [
  { type: 'user', message: { content: 'hi' } },
  asst('m1', 2, 10, 100, 1000), asst('m1', 2, 10, 100, 1000),            // same message streamed in two blocks
  asst('m2', 3, 20, 0, 2000), asst('m2', 3, 20, 0, 2000), asst('m2', 3, 20, 0, 2000),
  { type: 'assistant', message: { id: 'm3', content: 'no usage' } },
]);
const codex = write('x.jsonl', [
  { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 5, total_tokens: 105 } } } },
  { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 300, cached_input_tokens: 100, output_tokens: 20, total_tokens: 320 } } } },
]);
const text = write('t.txt', [{}]);

function run(agent, payload) {
  return new Promise((resolve) => {
    let body = '';
    const srv = http.createServer((q, s) => { let b = ''; q.on('data', (c) => { b += c; }).on('end', () => { body = b; s.statusCode = 204; s.end(); }); });
    srv.listen(0, '127.0.0.1', () => {
      const p = spawn(process.execPath, [HOOK, agent], { env: { PATH: process.env.PATH, TD_ID: 't', TD_URL: 'http://127.0.0.1:' + srv.address().port } });
      p.on('close', () => { srv.close(); resolve(body ? JSON.parse(body) : null); });
      p.stdin.end(JSON.stringify(payload));
    });
  });
}
let bad = 0;
const ck = (n, ok) => { if (!ok) { bad++; console.error('✗ ' + n); } };
(async () => {
  let e = await run('claude', { hook_event_name: 'Stop', transcript_path: claude });
  ck('claude: per-message-id sum, no double count', e.tokens === (2 + 10 + 100) + (3 + 20));        // 135, not 270+
  ck('claude: cache reads separate', e.cacheTokens === 3000);
  e = await run('codex', { hook_event_name: 'Stop', transcript_path: codex });
  ck('codex: last cumulative count minus cached', e.tokens === 220 && e.cacheTokens === 100);
  e = await run('claude', { hook_event_name: 'PreToolUse', tool_name: 'Bash', transcript_path: claude });
  ck('only `stop` carries usage', !('tokens' in e));
  e = await run('gemini', { hook_event_name: 'Stop', transcript_path: claude });
  ck('unknown CLI sends nothing', !('tokens' in e));
  e = await run('claude', { hook_event_name: 'Stop', transcript_path: path.join(dir, 'missing.jsonl') });
  ck('missing transcript sends nothing', !('tokens' in e));
  e = await run('claude', { hook_event_name: 'Stop', transcript_path: text });
  ck('non-.jsonl transcript sends nothing', !('tokens' in e));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? bad + ' failed' : 'usage ok');
  process.exit(bad ? 1 : 0);
})();
