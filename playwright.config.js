// Browser tests (#86). One real server on a throwaway HOME so tests never touch ~/.termdeck or real shells' rc files.
// Demo tests use ?demo (no PTYs); live tests use the same server. Set PW_CHROMIUM=/path/to/chrome to reuse a local browser.
const { defineConfig } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Created once in the main process; workers inherit it through the environment.
if (!process.env.TD_E2E_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'termdeck-e2e-'));
  const git = (...a) => execFileSync('git', a, { cwd: home, stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(home, 'README.md'), 'x\n'); git('add', '.'); git('commit', '-qm', 'init');
  process.env.TD_E2E_HOME = home;
}
const PORT = 4783;

module.exports = defineConfig({
  testDir: 'tests',
  workers: 1,                       // one shared server; live tests reuse terminal ids across contexts
  timeout: 30000,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), HOME: process.env.TD_E2E_HOME, NO_TMUX: '1', NO_OPEN: '1' },
  },
});
