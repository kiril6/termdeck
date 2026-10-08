#!/usr/bin/env node
// CI guard (#46): replay captured hook payloads (scripts/fixtures/hooks/<cli>/*.json) through
// scripts/td-hook.js against a mock server and compare the event it posts with <cli>/expected.json.
// A CLI changing its hook format then fails CI instead of silently breaking the agent queue.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, 'fixtures', 'hooks');
const HOOK = path.join(__dirname, 'td-hook.js');
const KEYS = ['type', 'tool', 'detail', 'files'];

function runHook(cli, payload, env, url) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK, cli], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (c) => { out += c; }); p.stderr.on('data', (c) => { out += c; });
    p.on('close', (code) => resolve({ code, out }));
    p.stdin.end(payload);
  });
}

(async () => {
  const got = [];
  let answer = null;   // set → the mock behaves like termdeck after an Approve/Deny click
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }).on('end', () => {
      got.push(JSON.parse(b));
      if (answer) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ decision: answer })); }
      res.statusCode = 204; res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + srv.address().port;
  let bad = 0, n = 0;
  for (const cli of fs.readdirSync(ROOT).filter((d) => fs.statSync(path.join(ROOT, d)).isDirectory())) {
    const expected = JSON.parse(fs.readFileSync(path.join(ROOT, cli, 'expected.json'), 'utf8'));
    const names = fs.readdirSync(path.join(ROOT, cli)).filter((f) => f.endsWith('.json') && f !== 'expected.json').map((f) => f.slice(0, -5));
    for (const name of [...new Set([...names, ...Object.keys(expected)])]) {
      const file = path.join(ROOT, cli, name + '.json');
      if (!fs.existsSync(file) || !(name in expected)) { console.error(`✗ ${cli}/${name}: fixture and expected.json out of step`); bad++; continue; }
      const payload = fs.readFileSync(file, 'utf8');
      got.length = 0;
      const inTd = await runHook(cli, payload, { TD_ID: 't1', TD_URL: url });
      const outside = await runHook(cli, payload, {});              // installed but not inside termdeck: must be a silent no-op
      const ev = got[0], want = expected[name]; n++;
      const pick = (e) => JSON.stringify(KEYS.map((k) => e[k]));
      const problems = [];
      if (inTd.code !== 0 || inTd.out) problems.push('exit/output: ' + inTd.code + ' ' + JSON.stringify(inTd.out));
      if (outside.code !== 0 || outside.out || got.length > 1) problems.push('not silent outside termdeck');
      if (!ev) problems.push('no event posted');
      else if (ev.id !== 't1' || ev.agent !== cli) problems.push(`id/agent ${ev.id}/${ev.agent}`);
      else if (pick(ev) !== pick(want)) problems.push(`got ${JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, ev[k]]).filter(([, v]) => v !== undefined)))}, want ${JSON.stringify(want)}`);
      if (problems.length) { console.error(`✗ ${cli}/${name}: ${problems.join('; ')}`); bad++; } else console.log(`✓ ${cli}/${name}`);
    }
  }
  // Decision output (#44/#139): what the CLI reads back from stdout after a click. Copilot only honours a top-level
  // {behavior}; Claude/Codex want the hookSpecificOutput wrapper. Each shape was checked against the real CLI.
  for (const cli of fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, 'permission-request-bash.json')))) {
    const payload = fs.readFileSync(path.join(ROOT, cli, 'permission-request-bash.json'), 'utf8');
    for (const d of ['allow', 'deny']) {
      answer = d; n++;
      const r = await runHook(cli, payload, { TD_ID: 't1', TD_URL: url });
      let out; try { out = JSON.parse(r.out); } catch { out = null; }
      const dec = cli === 'copilot' ? out : out?.hookSpecificOutput?.decision;
      const wrapped = !!out?.hookSpecificOutput;
      if (!dec || dec.behavior !== d || wrapped !== (cli !== 'copilot') || (d === 'deny' && cli === 'copilot' && !dec.message)) { console.error(`✗ ${cli}/decision-${d}: ${JSON.stringify(r.out)}`); bad++; }
      else console.log(`✓ ${cli}/decision-${d}`);
    }
  }
  answer = null;
  srv.close();
  console.log(bad ? `${bad} of ${n} failed` : `all ${n} payloads ok`);
  process.exit(bad ? 1 : 0);
})();
