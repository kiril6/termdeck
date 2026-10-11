# Contributing to TermDeck

Contributions welcome. To keep the project simple and dependable, a few ground rules.

## Principles

- **Keep the backend dependency-light.** It intentionally uses only `express`, `ws`, and `node-pty`. Don't add dependencies for what a few lines can do.
- **No build step.** The frontend is hand-edited `public/index.html` (markup), `public/app.js` and `public/app.css`. Please keep it that way — no bundler, no framework.
- **Preserve the reattach invariant** (see [Architecture](README.md#architecture)). Test that a browser refresh doesn't kill or lose a shell.
- **Test on more than one OS** when touching shell spawning or paths (`server.js`, `install.js`).
- **Keep `FEATURES.md` current.** Any change that adds, removes, or alters user-facing behavior must update `FEATURES.md` in the same change.

## AI-assisted development

This project is built with the help of [Claude Code](https://claude.com/claude-code), and you're welcome to continue that way (Claude Code, Cursor, or any other AI tool).

- [`CLAUDE.md`](CLAUDE.md) is the architecture + conventions brief — read it first. Claude Code loads it automatically; [`AGENTS.md`](AGENTS.md) is a symlink to it for tools that read that name.
- [`FEATURES.md`](FEATURES.md) is the source of truth for user-facing behavior. Keep it current (see Principles above).

## Dev loop

```bash
npm start          # start the server
# edit public/* or server.js, then reload the browser
npm run build:demo # ONLY if you changed public/ — resync the GitHub Pages demo
```

`npm run lint` runs ESLint with bug-catching rules only (undefined names, unused variables, unreachable code — no style rules); CI runs it too. `npm test` runs a small Playwright suite in Chromium (demo mode + one live-server run, ~30 s; first time `npx playwright install chromium`). CI also runs it in Firefox and WebKit on Linux; to do the same locally, `npx playwright install firefox webkit` once, then `PW_ALL_BROWSERS=1 npm test`. It also fails if `docs/app/` is stale — run `npm run build:demo`. Verify UI changes by hand too, and keep any new tests lightweight. Changes to the output path, socket lifecycle, polling or terminal rendering: compare `node tools/soak/backend.js` / `browser.js` before and after (see `tools/soak/README.md`).

> **After editing anything in `public/`, run `npm run build:demo` and commit the result.** The hosted demo at `docs/app/` is a generated copy of the frontend; without a rebuild it drifts from the real app.

## Submitting changes

This repo uses the standard **fork & pull-request** flow — you don't get (and don't need) write access:

1. **Fork** this repo to your own account and clone your fork.
2. Create a branch: `git checkout -b my-change`.
3. Make your change, test it in the browser (see the dev loop above), and update `FEATURES.md` if behavior changed.
4. Push to your fork and **open a pull request** against `kiril6/termdeck`.
5. The maintainer reviews and merges. Direct pushes to `master` are disabled — all changes land through a reviewed PR.

Keep PRs focused and small where you can; it makes review faster.

## Releasing (maintainers)

**Contributors don't do this.** You fork and open a PR (see above) — that's the whole job. Cutting a release requires push access to `kiril6/termdeck`, so only the maintainer runs it, and only after your PR is merged.

The git tag, the `package.json` version, and the version shown in the app's Help panel must always match. One command keeps them in sync:

```bash
npm run release            # patch: 1.0.0 → 1.0.1
npm run release -- minor   # 1.0.0 → 1.1.0
npm run release -- major   # 1.0.0 → 2.0.0
npm run release -- --first # tag + release the CURRENT version, no bump (first release only)
```

**Before releasing:** add the version's user-facing changes to the top of `CHANGELOG.md` (it ships in the package and powers Help → What's new), in the same PR as the version bump. Release roughly weekly — batch changes, and ship a patch release only for a real bug; several releases a day push churn onto users and inflate download counts.

It bumps `package.json`, commits, tags `v<version>`, pushes, and creates the GitHub Release with auto-generated notes. Needs a clean tree, `gh auth login`, and a pushed commit whose `smoke`, `e2e` and `demo-sync` runs passed — it refuses otherwise. Pick the bump type by semver: patch = fix, minor = feature, major = breaking. Nothing auto-increments — the version is a deliberate choice.

**Pushing the tag also publishes to npm**, via `.github/workflows/publish.yml`. The workflow runs the full `smoke` and `e2e` workflows first (a failure stops the publish), re-checks that the tag matches `package.json`, and publishes `@kiril6/termdeck` with build provenance — there is no `NPM_TOKEN` in the repo; npm trusts the workflow itself (trusted publishing). Publishing cannot be undone and a version number can never be reused, so treat `npm run release` as the irreversible step it is. Doing it by hand is how v1.3.1 got tagged and released while npm still had nothing.

**If a release is bad:** a published version can't be replaced or reused. Mark it so npm warns everyone who installs it, then ship the fix as the next version:

```bash
npm deprecate @kiril6/termdeck@<bad-version> "<what is wrong> — use <fixed-version>"
```

Fix forward with `npm run release` (patch). `npm unpublish` is for accidents within 72 hours only, and it breaks everyone who already installed that version.

## Reporting bugs

[Open an issue](https://github.com/kiril6/termdeck/issues/new) with your **OS**, **Node version**, the output of `termdeck doctor`, and the `/debug` page if shells fail to start. **Security issues:** report privately, see [SECURITY.md](SECURITY.md).
