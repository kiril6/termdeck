// /api/session-kill and /api/orphans — end a terminal without its WebSocket, and sweep tmux sessions nothing owns (#302).
// Same guard as every /api route. Names and ids are validated in sessions.js; this only parses requests.
const express = require('express');

module.exports = function sessionsApi({ apiGuard, sessions }) {
  const r = express.Router();
  r.post('/api/session-kill', apiGuard, (req, res) => res.json({ ok: sessions.killById(req.body?.id) }));
  r.get('/api/orphans', apiGuard, (_req, res) => sessions.listOrphans((names) => res.json({ names })));
  r.post('/api/orphans/kill', apiGuard, (req, res) => {
    const names = Array.isArray(req.body?.names) ? req.body.names.filter((n) => typeof n === 'string').slice(0, 200) : [];
    sessions.killOrphans(names, (killed) => res.json({ killed }));
  });
  return r;
};
