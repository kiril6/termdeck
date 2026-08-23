/**
 * install.js — run once after cloning: `node install.js`
 *
 * Installs the right node-pty variant for your platform so no
 * native compilation is needed on any OS.
 *
 *   macOS (arm64 / x64) → node-pty@1.1.0          (prebuilt)
 *   Windows (arm64/x64) → node-pty@1.1.0          (prebuilt)
 *   Linux  (x64/arm64)  → @homebridge/node-pty-prebuilt-multiarch (prebuilt)
 */

const { execSync } = require('child_process');
const os = require('os');

const platform = os.platform();   // 'darwin' | 'linux' | 'win32'
const arch     = os.arch();       // 'arm64' | 'x64' | 'ia32' | 'arm'

console.log(`\n  Platform: ${platform}  Arch: ${arch}  Node: ${process.version}\n`);

let ptyPkg;
if (platform === 'linux') {
  ptyPkg = '@homebridge/node-pty-prebuilt-multiarch@0.14.1';
} else {
  // macOS (darwin arm64/x64) and Windows (win32 arm64/x64)
  ptyPkg = 'node-pty@1.1.0';
}

console.log(`  Installing node-pty variant: ${ptyPkg}`);
console.log(`  (This avoids needing a C++ compiler on your system)\n`);

// macOS npm unpacks node-pty prebuilds without the execute bit on spawn-helper,
// which node-pty forks to exec shells → "posix_spawnp failed". Restore it.
function fixSpawnHelper() {
  if (platform !== 'darwin') return;
  const fs = require('fs');
  for (const a of ['darwin-arm64', 'darwin-x64']) {
    const p = `node_modules/node-pty/prebuilds/${a}/spawn-helper`;
    try { fs.chmodSync(p, 0o755); } catch {}
  }
}

try {
  // Install base deps first, then the right pty
  execSync('npm install --ignore-scripts', { stdio: 'inherit' });
  execSync(`npm install ${ptyPkg} --save`, { stdio: 'inherit' });
  fixSpawnHelper();
  console.log('\n  ✓ Done. Start with: npm start\n');
} catch (e) {
  console.error('\n  Install failed. Trying plain npm install as fallback...\n');
  try {
    execSync('npm install', { stdio: 'inherit' });
    console.log('\n  ✓ Done (fallback). Start with: npm start\n');
  } catch (e2) {
    console.error('\n  Both install attempts failed.');
    console.error('  macOS fix:  xcode-select --install  then re-run this script');
    console.error('  Linux fix:  sudo apt-get install build-essential python3');
    console.error('  Then:       node install.js\n');
    process.exit(1);
  }
}
