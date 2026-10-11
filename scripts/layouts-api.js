// /api/layouts — named layout snapshots (#17).
// One JSON file in ~/.termdeck (0600, atomic, shared safely by several servers — scripts/json-store.js). A snapshot is the
// client's layout state: projects, windows, tabs, roots, cwds. The server stores it opaquely after a shape check;
// it never executes or interprets it (the client strips agent/resume commands before saving). Same guard as /api.
const express = require('express');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { createStore } = require('./json-store');

const LAYOUTS_FILE = path.join(os.homedir(), '.termdeck', 'layouts.json');
const MAX_LAYOUTS = 50;
const layoutMeta = (l) => ({ id: l.id, name: l.name, savedAt: l.savedAt, projects: l.data.projects.length, windows: l.data.sessions.length });
const validLayout = (d) => d && typeof d === 'object' && Array.isArray(d.projects) && Array.isArray(d.sessions) && d.projects.length > 0 && d.projects.length <= 50 && d.sessions.length <= 200;

module.exports = function layoutsApi({ apiGuard }) {
  const layoutsFile = createStore(LAYOUTS_FILE, {
    parse: (j) => {
      if (j.layouts !== undefined && !Array.isArray(j.layouts)) throw new Error('"layouts" is not a list');
      return (j.layouts || []).filter((l) => l && typeof l.id === 'string' && typeof l.name === 'string' && l.data);
    },
    serialize: (layouts) => ({ layouts }),
    version: 1,
  });
  const r = express.Router();
  r.get('/api/layouts', apiGuard, (_req, res) => res.json(layoutsFile.load().map(layoutMeta).sort((a, b) => b.savedAt - a.savedAt)));
  r.get('/api/layouts/:id', apiGuard, (req, res) => {
    const l = layoutsFile.load().find((x) => x.id === req.params.id);
    l ? res.json(l) : res.status(404).json({ error: 'not found' });
  });
  r.post('/api/layouts', apiGuard, (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!validLayout(req.body.data)) return res.status(400).json({ error: 'invalid layout' });
    let saved;
    try {
      saved = layoutsFile.update((layouts) => {
        let l = layouts.find((x) => x.name.toLowerCase() === name.toLowerCase());   // saving under an existing name replaces it
        if (!l) {
          if (layouts.length >= MAX_LAYOUTS) return null;
          l = { id: crypto.randomBytes(8).toString('hex') }; layouts.push(l);
        }
        Object.assign(l, { name, savedAt: Date.now(), data: req.body.data });
        return l;
      });
    } catch (e) { return res.status(500).json({ error: e.code === 'ENEWER' ? e.message : e.code || 'could not save' }); }
    if (!saved) return res.status(400).json({ error: 'layout limit reached (' + MAX_LAYOUTS + ')' });
    res.json(layoutMeta(saved));
  });
  r.delete('/api/layouts/:id', apiGuard, (req, res) => {
    try {
      layoutsFile.update((layouts) => {
        const i = layouts.findIndex((x) => x.id === req.params.id);
        return i < 0 ? null : layouts.splice(i, 1);
      });
    } catch {}
    res.json({ ok: true });
  });
  return r;
};
