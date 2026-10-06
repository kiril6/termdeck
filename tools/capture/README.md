# README captures

Re-records the hero GIF and screenshots in `docs/screenshots/` from a real termdeck. Run these after UI changes so the README stays truthful.

Each run starts its own server on port 4791 with a throwaway `HOME` and a sample `shop-api` repo. It creates three agent worktrees with real commits and sends agent events through the hook API (`POST /api/agent-events`). No real agent runs and your own `~/.termdeck` is never touched.

```bash
npm install                        # gifenc + pngjs are devDependencies
node tools/capture/shots.js        # agent-queue.png, review-changes.png, finish-task.png
node tools/capture/workspace.js    # workspace-light.png (pass a theme name to try another)
node tools/capture/gif.js          # records raw frames (~170 MB, OS temp dir)
node tools/capture/encode.js       # frames → hero.gif; args: MIN_DT MAX_HOLD LAST SPEED
```

- **Browser:** uses Playwright's Chromium (`npx playwright install chromium`), or set `PW_CHROMIUM=/path/to/chrome`.
- **Folders:** the sample `HOME` and repo default to `/Users/Shared/dev` and `/Users/Shared/code/shop-api` (short paths read well on screen). Override with `TD_CAPTURE_HOME` / `TD_CAPTURE_REPO`. Both are wiped on every run, but `setup.sh` refuses to touch a folder it didn't create.
- **Needs** zsh and git. Written for macOS; other platforms need the two folder overrides.
- **Size:** keep `hero.gif` under ~2 MB so the README loads fast. If it grows, raise `SPEED` or lower `MAX_HOLD` in `encode.js`.
