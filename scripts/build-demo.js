#!/usr/bin/env node
// Build the static "Try the demo" copy for GitHub Pages (docs/app/).
// Copies public/index.html with /vendor/ rewritten to relative paths, app.css and app.js, plus the
// xterm assets they need. The app forces demo mode on github.io (no backend, no shells).
// Re-run after editing anything in public/:  npm run build:demo
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'app');
const assets = [
  '@xterm/xterm/css/xterm.css',
  '@xterm/xterm/lib/xterm.js',
  '@xterm/addon-fit/lib/addon-fit.js',
  '@xterm/addon-search/lib/addon-search.js',
  '@xterm/addon-web-links/lib/addon-web-links.js',
  '@xterm/addon-webgl/lib/addon-webgl.js',
  '@xterm/addon-serialize/lib/addon-serialize.js',
  '@xterm/addon-unicode11/lib/addon-unicode11.js',
];

// The app files with absolute /vendor/ made relative so they work under /termdeck/app/
fs.mkdirSync(outDir, { recursive: true });
for (const f of ['index.html', 'app.js', 'app.css']) {
  const src = fs.readFileSync(path.join(root, 'public', f), 'utf8').replace(/(["'(])\/vendor\//g, '$1vendor/');
  fs.writeFileSync(path.join(outDir, f), src);
}

for (const rel of assets) {
  const src = path.join(root, 'node_modules', rel);
  const dst = path.join(outDir, 'vendor', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
// MIT asks for the notice to travel with the code. Every package here is from the xterm.js monorepo; one that ships
// no LICENSE file (addon-serialize) gets the repo's own, which is the same MIT notice.
const pkgs = [...new Set(assets.map((rel) => rel.split('/').slice(0, 2).join('/')))];
for (const pkg of pkgs) {
  const own = path.join(root, 'node_modules', pkg, 'LICENSE');
  fs.copyFileSync(fs.existsSync(own) ? own : path.join(root, 'node_modules', '@xterm/xterm', 'LICENSE'), path.join(outDir, 'vendor', pkg, 'LICENSE'));
}
console.log(`built docs/app/ — index.html, app.css, app.js + ${assets.length} vendor files + ${pkgs.length} licences`);
