#!/usr/bin/env node
// CI helper (not shipped): prints `docs=true` when a pull request touches only documentation, so e2e.yml can skip the
// slow browser run while the required job still reports green. Anything unclear (not a PR, API failure, 100+ files)
// prints `docs=false`: the tests run.
const DOC = /^(?:[^/]+\.md|LICENSE|docs\/(?!app\/).+|\.github\/ISSUE_TEMPLATE\/.+)$/;   // docs/app is a generated copy of public/

async function main() {
  const { GITHUB_EVENT_NAME, GITHUB_REPOSITORY, GITHUB_TOKEN, PR_NUMBER } = process.env;
  if (GITHUB_EVENT_NAME !== 'pull_request' || !PR_NUMBER) return false;
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/files?per_page=100`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) return false;
  const files = await r.json();
  return Array.isArray(files) && files.length > 0 && files.length < 100 && files.every(f => DOC.test(f.filename) && (!f.previous_filename || DOC.test(f.previous_filename)));
}

main().catch(() => false).then(docs => console.log(`docs=${docs}`));
