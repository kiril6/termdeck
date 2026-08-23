## What & why

<!-- What does this change and why? Link any related issue: Fixes #123 -->

## Checklist

- [ ] Tested by hand in the browser (see CONTRIBUTING.md dev loop)
- [ ] Updated `FEATURES.md` if user-facing behavior changed
- [ ] No new backend dependencies (express / ws / node-pty only)
- [ ] No build step introduced (frontend stays a single `public/index.html`)
- [ ] Reattach invariant preserved (refresh doesn't kill/lose a shell) if WS lifecycle touched
