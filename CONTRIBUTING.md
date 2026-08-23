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
```

There's no linter or test suite yet — verify changes by hand in the browser. If you add tests or CI, keep them lightweight.

## Reporting bugs

[Open an issue](https://github.com/kiril6/termdeck/issues/new) with your **OS**, **Node version**, and the output of the `/debug` page if shells fail to start.
