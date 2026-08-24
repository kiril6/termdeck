#!/usr/bin/env node
// Build the static "Try the demo" copy for GitHub Pages (docs/app/).
// Copies public/index.html with /vendor/ rewritten to relative paths, plus the
// xterm assets it needs. The app forces demo mode on github.io (no backend, no shells).
// Re-run after editing public/index.html:  npm run build:demo
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'app');
const assets = [
  'xterm/css/xterm.css',
  'xterm/lib/xterm.js',
  'xterm-addon-fit/lib/xterm-addon-fit.js',
  'xterm-addon-search/lib/xterm-addon-search.js',
  'xterm-addon-web-links/lib/xterm-addon-web-links.js',
  'xterm-addon-webgl/lib/xterm-addon-webgl.js',
  'xterm-addon-serialize/lib/xterm-addon-serialize.js',
];

// index.html with absolute /vendor/ made relative so it works under /termdeck/app/
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8')
  .replace(/(["'(])\/vendor\//g, '$1vendor/');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);

for (const rel of assets) {
  const src = path.join(root, 'node_modules', rel);
  const dst = path.join(outDir, 'vendor', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
console.log(`built docs/app/ — index.html + ${assets.length} vendor files`);
