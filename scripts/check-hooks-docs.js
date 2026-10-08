#!/usr/bin/env node
// CI guard (#63): the JSON snippets in docs/agent-hooks.md must match the table `termdeck hooks install` uses,
// so the manual instructions and the command can't drift apart.
const fs = require('fs');
const path = require('path');
const { CLIS, commandFor, psCommandFor } = require('./hooks');

const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'agent-hooks.md'), 'utf8');
const HEADING = { claude: '## Claude Code', gemini: '## Gemini CLI', codex: '## Codex', copilot: '## GitHub Copilot CLI' };
let bad = 0;
for (const [agent, cli] of Object.entries(CLIS)) {
  const i = md.indexOf(HEADING[agent]);
  const block = i < 0 ? null : /```json\n([\s\S]*?)```/.exec(md.slice(i));
  if (!block) { console.error(`✗ ${agent}: no json block under "${HEADING[agent]}"`); bad++; continue; }
  const hooks = JSON.parse(block[1]).hooks || {};
  const docEvents = Object.keys(hooks).sort().join(',');
  const tableEvents = [...cli.events].sort().join(',');
  const cmds = new Set(Object.values(hooks).flat().flatMap((g) => (cli.flat ? [g.bash] : g.hooks.map((h) => h.command))));
  if (cli.flat && !Object.values(hooks).flat().every((g) => g.powershell === psCommandFor(agent))) { console.error(`✗ ${agent}: docs powershell command differs from ${psCommandFor(agent)}`); bad++; continue; }
  if (docEvents !== tableEvents) { console.error(`✗ ${agent}: docs events [${docEvents}] ≠ table [${tableEvents}]`); bad++; }
  else if (cmds.size !== 1 || !cmds.has(commandFor(agent))) { console.error(`✗ ${agent}: docs command differs from ${commandFor(agent)}`); bad++; }
  else console.log(`✓ ${agent}`);
}
process.exit(bad ? 1 : 0);
