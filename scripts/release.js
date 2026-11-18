#!/usr/bin/env node
/**
 * One-command release: bump version → tag → push → GitHub Release.
 *
 *   npm run release            # patch: 1.0.0 → 1.0.1
 *   npm run release -- minor   # 1.0.0 → 1.1.0
 *   npm run release -- major   # 1.0.0 → 2.0.0
 *   npm run release -- --first # tag + release the CURRENT version, no bump (first release)
 *
 * Keeps the contract: git tag  ==  v<package.json version>  ==  version shown in the app modal.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The body of `## <version>` in CHANGELOG.md, up to the next `## ` heading; null when there is no such section.
function changelogSection(md, version) {
  const lines = md.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (i < 0) return null;
  const j = lines.findIndex((l, k) => k > i && l.startsWith('## '));
  return lines.slice(i + 1, j < 0 ? undefined : j).join('\n').trim() || null;
}
module.exports = { changelogSection };
if (require.main !== module) return;   // required by release.test.js: don't release

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

// gh must be present + authed — the release step needs it.
try { out('gh auth status'); }
catch { console.error('✗ GitHub CLI not ready. Install gh and run `gh auth login`, then retry.'); process.exit(1); }

// Clean tree — npm version refuses a dirty tree anyway; fail early with a clear message.
if (out('git status --porcelain')) { console.error('✗ Working tree not clean. Commit or stash first.'); process.exit(1); }

// Only release a commit that is pushed and whose CI passed. publish.yml re-runs the tests before publishing, but
// tagging a red commit would still burn a version number and a GitHub Release.
const sha = out('git rev-parse HEAD');
if (!out(`git branch -r --contains ${sha}`)) { console.error('✗ HEAD is not pushed. Push it and let CI finish first.'); process.exit(1); }
const runs = JSON.parse(out(`gh run list --commit ${sha} --json workflowName,conclusion --limit 50`));
const notGreen = ['smoke', 'e2e', 'demo-sync'].filter((w) => !runs.some((r) => r.workflowName === w && r.conclusion === 'success'));
if (notGreen.length) { console.error(`✗ CI is not green for ${sha.slice(0, 7)} (${notGreen.join(', ')}). Wait for it or fix it, then retry.`); process.exit(1); }

const arg = process.argv[2] || 'patch';
const first = arg === '--first';
const bump = first ? null : (['patch', 'minor', 'major'].includes(arg) ? arg : (() => {
  console.error(`✗ Unknown arg "${arg}". Use patch | minor | major | --first.`); process.exit(1);
})());

let version;
if (first) {
  version = require(path.join('..', 'package.json')).version;   // release current version as-is
  run(`git tag -a v${version} -m "Release v${version}"`);   // annotated → git push --follow-tags sends it
} else {
  run(`npm version ${bump} -m "Release v%s"`);                  // bumps package.json, commits, tags
  version = require(path.join('..', 'package.json')).version;   // read AFTER bump (env var is stale)
}

run('git push --follow-tags');
// Release notes = this version's CHANGELOG section (the landing page's "What's new" reads them), not raw PR titles.
const notes = changelogSection(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'), version);
if (notes) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'td-release-')), 'notes.md');
  fs.writeFileSync(file, notes + '\n');
  run(`gh release create v${version} --notes-file ${JSON.stringify(file)} --title "v${version}"`);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
} else {
  console.warn(`! CHANGELOG.md has no "## ${version}" section — using GitHub's generated notes (PR titles).`);
  run(`gh release create v${version} --generate-notes --title "v${version}"`);
}
console.log(`\n✓ Released v${version} → https://github.com/kiril6/termdeck/releases/tag/v${version}`);
