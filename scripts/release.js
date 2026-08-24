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
const path = require('path');

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

// gh must be present + authed — the release step needs it.
try { out('gh auth status'); }
catch { console.error('✗ GitHub CLI not ready. Install gh and run `gh auth login`, then retry.'); process.exit(1); }

// Clean tree — npm version refuses a dirty tree anyway; fail early with a clear message.
if (out('git status --porcelain')) { console.error('✗ Working tree not clean. Commit or stash first.'); process.exit(1); }

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
run(`gh release create v${version} --generate-notes --title "v${version}"`);
console.log(`\n✓ Released v${version} → https://github.com/kiril6/termdeck/releases/tag/v${version}`);
