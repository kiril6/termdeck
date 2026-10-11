// Open a URL in the browser. BROWSER=<name|path> picks one (e.g. BROWSER="Google Chrome" on macOS,
// BROWSER=firefox on Linux); default = the OS default. Fire-and-forget: a missing opener is not an error.
const { spawn } = require('child_process');

function openBrowser(target) {
  const browser = process.env.BROWSER;
  let cmd, args;
  if (browser) {
    if (process.platform === 'darwin') { cmd = 'open'; args = ['-a', browser, target]; }
    else                               { cmd = browser; args = [target]; }   // Linux/Windows: run the browser binary directly
  } else if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', target]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [target]; }
  else { cmd = 'xdg-open'; args = [target]; }
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}

module.exports = { openBrowser };
