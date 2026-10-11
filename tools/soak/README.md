# Soak checks

Repeatable performance numbers for the output path, backpressure, PTY churn, tmux polling and the browser's WebGL budget. Run them before and after a change that touches any of those, on the same machine, and compare.

Each script starts its own server on a free port with a throwaway `HOME` (and, for tmux, its own tmux socket). Your `~/.termdeck`, shells' rc files and tmux sessions are never touched. Not in CI: timings depend on the machine.

```bash
node tools/soak/backend.js                 # all server scenarios (~70 s), or name some: throughput stalled churn tmux
node tools/soak/browser.js                 # 20 terminals in Chromium (~40 s); N=30 for more, HEADED=1 to watch
```

- **Browser:** Playwright's Chromium (`npx playwright install chromium`), or `PW_CHROMIUM=/path/to/chrome`. Headless uses a software GPU; `HEADED=1` uses the real one.
- **Needs** bash (the scenarios print with `head`, `tr` and `fold`) and `ps`: macOS or Linux. The tmux scenario is skipped when tmux is not installed.

| Line | What good looks like |
|---|---|
| `throughput` | Server CPU well under wall time; MB/s limited by the shell, not the server |
| `stalled reader` | RSS levels off (a few hundred MB at most) instead of growing with the output |
| `churn` | RSS roughly flat after warm-up; 0 child processes left |
| `tmux … calls/s` | Does not grow with the number of sessions |
| `renderers` | No terminal on the `dom` renderer while WebGL is available |
| `streaming` | ~60 fps |
| `idle` | Main thread busy a few % at most |
