# Contributing to Terminal Dashboard

Contributions welcome. To keep the project simple and dependable, a few ground rules.

## Principles

- **Keep the backend dependency-light.** It intentionally uses only `express`, `ws`, and `node-pty`. Don't add dependencies for what a few lines can do.
- **No build step.** The frontend is a single hand-edited `public/index.html`. Please keep it that way — no bundler, no framework.
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
# edit public/index.html or server.js, then reload the browser
npm run build:demo # ONLY if you changed public/index.html — resync the GitHub Pages demo
```

There's no linter or test suite yet — verify changes by hand in the browser. If you add tests or CI, keep them lightweight.

> **After editing `public/index.html`, run `npm run build:demo` and commit the result.** The hosted demo at `docs/app/` is a generated copy of the frontend; without a rebuild it drifts from the real app.

## Submitting changes

This repo uses the standard **fork & pull-request** flow — you don't get (and don't need) write access:

1. **Fork** this repo to your own account and clone your fork.
2. Create a branch: `git checkout -b my-change`.
3. Make your change, test it in the browser (see the dev loop above), and update `FEATURES.md` if behavior changed.
4. Push to your fork and **open a pull request** against `kiril6/termdeck`.
5. The maintainer reviews and merges. Direct pushes to `master` are disabled — all changes land through a reviewed PR.

Keep PRs focused and small where you can; it makes review faster.

## Releasing (maintainers)

The git tag, the `package.json` version, and the version shown in the app's Help panel must always match. One command keeps them in sync:

```bash
npm run release            # patch: 1.0.0 → 1.0.1
npm run release -- minor   # 1.0.0 → 1.1.0
npm run release -- major   # 1.0.0 → 2.0.0
npm run release -- --first # tag + release the CURRENT version, no bump (first release only)
```

It bumps `package.json`, commits, tags `v<version>`, pushes, and creates the GitHub Release with auto-generated notes. Needs a clean tree and `gh auth login`. Pick the bump type by semver: patch = fix, minor = feature, major = breaking. Nothing auto-increments — the version is a deliberate choice.

## Reporting bugs

[Open an issue](https://github.com/kiril6/termdeck/issues/new) with your **OS**, **Node version**, and the output of the `/debug` page if shells fail to start.
