// /api routes over the local filesystem: the sidebar tree, the file viewer, and opening a path in the OS file
// manager, the default app or the editor. Every route carries the Origin + Host guard (http-security.js).
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { shellCandidates, baseName } = require('./sessions');

const isWindows = process.platform === 'win32';
// /api/raw — bytes of a previewable media file for the viewer's <img>/<video>/<audio>/<iframe> (#24).
// Extension ALLOWLIST (never sniffed, never a generic file server), same guard as the rest of /api (which also
// rejects Sec-Fetch-Site: cross-site, since a cross-site page can embed an <img> without sending an Origin header).
// SVG is only ever shown through <img>; its CSP sandbox also blocks scripts if the URL is opened directly.
const RAW_TYPES = {
  png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', avif:'image/avif',
  bmp:'image/bmp', ico:'image/x-icon', svg:'image/svg+xml', pdf:'application/pdf',
  mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', m4a:'audio/mp4', flac:'audio/flac',
  mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime',
};
const RAW_MAX = 25 * 1024 * 1024;                     // images/PDF; audio/video are streamed with Range, so uncapped
// Open a file in the OS default app (the viewer's fallback for formats it cannot preview). Never launches
// anything executable-looking: a click on a path in terminal output must not be able to run a script.
const NO_OPEN = new Set(['app','command','tool','sh','bash','zsh','csh','ksh','fish','bat','cmd','com','exe','msi','scr',
  'ps1','vbs','vbe','js','jse','wsf','jar','lnk','url','pkg','dmg','workflow','action','terminal','desktop','appimage','run','pif','reg','hta']);
const FIND_SKIP = new Set(['node_modules', '.git']);
const FIND_MAX_RESULTS = 200, FIND_MAX_DEPTH = 8, FIND_MAX_DIRS = 5000;
const EDITOR = process.env.TD_EDITOR || 'code';     // fixed by config, never by the request; no shell → a path can't inject a command

module.exports = function fsApi({ apiGuard, expandDir, safeDir }) {
  const r = express.Router();
  r.get('/api/ls', apiGuard, (req, res) => {
    const dir = expandDir(req.query.dir);
    if (!safeDir(dir)) return res.status(404).json({ error:'not a directory', dir });
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes:true }); }
    catch (e) { return res.status(403).json({ error:e.code || 'read failed', dir }); }
    const all = req.query.all === '1';                 // ?all=1 → include dotfiles (sidebar "show hidden")
    const entries = ents
      .filter((e) => all || !e.name.startsWith('.'))   // hide dotfiles by default, like `ls`
      .map((e) => { try { return { name:e.name, dir:e.isDirectory() }; } catch { return { name:e.name, dir:false }; } })
      .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name)));
    res.json({ dir, entries });
  });
  // /api/find — filename search under a root for the tree's filter box (#167). Breadth-first so shallow hits come
  // first; skips node_modules/.git, never follows symlinks, and is capped on depth, visited dirs and results.
  r.get('/api/find', apiGuard, (req, res) => {
    const dir = expandDir(req.query.dir);
    if (!safeDir(dir)) return res.status(404).json({ error:'not a directory', dir });
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 200);
    if (!q) return res.json({ dir, results:[], truncated:false });
    const all = req.query.all === '1';
    const results = []; let truncated = false, visited = 0;
    const queue = [{ abs:dir, rel:'', depth:0 }];
    scan: while (queue.length) {
      const { abs, rel, depth } = queue.shift();
      if (++visited > FIND_MAX_DIRS) { truncated = true; break; }
      let ents;
      try { ents = fs.readdirSync(abs, { withFileTypes:true }); } catch { continue; }
      for (const e of ents) {
        if (!all && e.name.startsWith('.')) continue;
        const isDir = e.isDirectory();                  // a symlinked dir reports false → listed but not entered
        if (isDir && FIND_SKIP.has(e.name)) continue;
        const relPath = rel ? rel + '/' + e.name : e.name;
        if (e.name.toLowerCase().includes(q)) {
          if (results.length >= FIND_MAX_RESULTS) { truncated = true; break scan; }
          results.push({ path:relPath, dir:isDir });
        }
        if (isDir && depth < FIND_MAX_DEPTH) queue.push({ abs:path.join(abs, e.name), rel:relPath, depth:depth + 1 });
      }
    }
    res.json({ dir, results, truncated });
  });
  r.get('/api/shells', apiGuard, (_req, res) => {      // shells the "Shell" picker may offer (the same allowlist spawn enforces)
    res.json({ shells: shellCandidates().map((p) => ({ path: p, name: baseName(p) })) });
  });
  r.post('/api/reveal', apiGuard, (req, res) => {    // open the OS file manager at a path (POST: it launches a program)
    const target = expandDir(req.body?.path);
    if (!fs.existsSync(target)) return res.status(404).end();
    const isDir = safeDir(target);
    let cmd, args;
    if (isWindows)                        { cmd = 'explorer'; args = isDir ? [target] : ['/select,' + target]; }
    else if (process.platform === 'darwin'){ cmd = 'open';    args = isDir ? [target] : ['-R', target]; }
    else                                  { cmd = 'xdg-open'; args = [isDir ? target : path.dirname(target)]; }
    try { spawn(cmd, args, { stdio:'ignore', detached:true }).on('error', () => {}).unref(); } catch {}
    res.json({ ok:true });
  });
  r.get('/api/raw', apiGuard, (req, res) => {
    const target = expandDir(req.query.path);
    const ext = path.extname(target).slice(1).toLowerCase();
    const type = RAW_TYPES[ext];
    if (!type) return res.status(415).json({ error:'not a previewable type' });
    let st;
    try { st = fs.statSync(target); } catch { return res.status(404).json({ error:'not found' }); }
    if (!st.isFile()) return res.status(400).json({ error:'not a file' });
    if (st.size > RAW_MAX && /^(image|application)\//.test(type)) return res.status(413).json({ error:'file too large to preview' });
    const headers = { 'Content-Type':type, 'X-Content-Type-Options':'nosniff', 'Content-Disposition':'inline', 'Cache-Control':'no-store' };
    if (ext === 'svg') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    res.sendFile(target, { dotfiles:'allow', headers }, (err) => { if (err && !res.headersSent) res.status(err.status || 500).end(); });
  });
  r.post('/api/open', apiGuard, (req, res) => {      // open a file in its default app (POST: it launches a program)
    const target = expandDir(req.body?.path);
    let st;
    try { st = fs.statSync(target); } catch { return res.status(404).json({ error:'not found' }); }
    if (!st.isFile()) return res.status(400).json({ error:'not a file' });
    if (NO_OPEN.has(path.extname(target).slice(1).toLowerCase())) return res.status(403).json({ error:'will not launch executable files' });
    const [cmd, args] = isWindows ? ['explorer', [target]] : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
    try { spawn(cmd, args, { stdio:'ignore', detached:true }).on('error', () => {}).unref(); } catch {}
    res.json({ ok:true });
  });
  r.post('/api/open-editor', apiGuard, (req, res) => { // open a path in the configured editor (POST: it launches a program)
    const target = expandDir(req.body?.path);
    if (!fs.existsSync(target)) return res.status(404).json({ error:'path not found' });
    const child = spawn(EDITOR, [target], { stdio:'ignore', detached:true });
    child.once('error', (e) => res.status(e.code === 'ENOENT' ? 404 : 500)
      .json({ error: e.code === 'ENOENT' ? `editor "${EDITOR}" not found — set TD_EDITOR` : (e.code || 'launch failed') }));
    child.once('spawn', () => { child.unref(); res.json({ ok:true }); });
  });
  r.get('/api/stat', apiGuard, (req, res) => {       // lightweight "is this a regular file?" for clickable output paths
    try { res.json({ file: fs.statSync(expandDir(req.query.path)).isFile() }); }
    catch { res.json({ file: false }); }
  });
  r.get('/api/read', apiGuard, (req, res) => {       // read a text file for the in-app viewer
    // No path jail: the app already hands out real shells (cat reads anything), so a viewer over
    // the same loopback+Origin/Host guard grants no new capability. Same trust model as /api/ls.
    const target = expandDir(req.query.path);
    let st;
    try { st = fs.statSync(target); } catch { return res.status(404).json({ error:'not found' }); }
    if (st.isDirectory()) return res.status(400).json({ error:'is a directory' });
    const MAX = 2 * 1024 * 1024;                        // 2MB cap — this is a peek, not an editor
    let fd;
    try {
      fd = fs.openSync(target, 'r');
      const len = Math.min(st.size, MAX);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      if (buf.includes(0)) return res.json({ path:target, name:baseName(target), binary:true });
      res.json({ path:target, name:baseName(target), text:buf.toString('utf8'), truncated:st.size > MAX });
    } catch (e) { res.status(403).json({ error:e.code || 'read failed' }); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  });
  return r;
};
