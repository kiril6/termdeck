// node scripts/release.test.js — the release notes are the version's CHANGELOG.md section (requiring release.js
// does not run a release).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { changelogSection } = require('./release');

const md = '# Changelog\n\nIntro.\n\n## 1.2.0\n- **New** — a thing.\n- Fixed: another.\n\n## 1.1.0\n- Old.\n';
assert.strictEqual(changelogSection(md, '1.2.0'), '- **New** — a thing.\n- Fixed: another.');
assert.strictEqual(changelogSection(md, '1.1.0'), '- Old.', 'the last section runs to the end of the file');
assert.strictEqual(changelogSection(md, '1.3.0'), null, 'missing section → null (release falls back to generated notes)');
assert.strictEqual(changelogSection(md, '1.2'), null, 'exact version only, no prefix match');
assert.strictEqual(changelogSection(md.replace(/\n/g, '\r\n'), '1.1.0'), '- Old.');
assert.strictEqual(changelogSection('## 1.0.0\n\n## 0.9.0\n- x\n', '1.0.0'), null, 'an empty section counts as missing');

// The real changelog has a section for the current version.
const { version } = require('../package.json');
assert.ok(changelogSection(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'), version), `CHANGELOG.md has a "## ${version}" section`);
console.log('release notes test passed');
