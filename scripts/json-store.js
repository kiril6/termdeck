// A small JSON file in ~/.termdeck that every termdeck server using that home shares — two can run at once (the auto
// port fallback makes that easy). Reads reload whenever the file changed on disk; writes re-read it first, apply the
// change and replace it atomically, so one server never overwrites another's update with a stale copy. A file that
// exists but can't be parsed is kept as <file>.corrupt-<time> (logged once) instead of being silently overwritten.
// Files carry a format `version`. One written by a newer termdeck (two versions can share a home) is read as far as
// this one understands it but never written back, so an older server can't flatten a newer format.
// shortcut: no inter-process lock — two writes landing in the same instant can still race; add a lockfile if that
// ever matters (writes here are human clicks).
const fs = require('fs');
const path = require('path');

// parse(json) → the in-memory value (throw to mark the file corrupt); serialize(value) → the object to write;
// version → the format this code writes.
function createStore(file, { parse, serialize, version }) {
  let cache = null, stamp = null, newer = 0;   // newer: the file's version when it is above ours
  const key = (st) => `${st.ino}:${st.size}:${st.mtimeMs}`;   // atomic rename = new inode on every write

  function load() {
    let st;
    try { st = fs.statSync(file); }
    catch (e) {
      if (e.code !== 'ENOENT') console.error(`  [${path.basename(file)}] can't read: ${e.code || e.message}`);
      cache = parse({}); stamp = null; newer = 0; return cache;
    }
    if (cache && stamp === key(st)) return cache;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      cache = parse(j); stamp = key(st);
      newer = Number(j.version) > version ? Number(j.version) : 0;
    }
    catch (e) {
      const base = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      let kept = base;
      for (let n = 1; fs.existsSync(kept); n++) kept = `${base}-${n}`;   // never replace an earlier kept copy
      try { fs.renameSync(file, kept); console.error(`  [${path.basename(file)}] unreadable (${e.message}) — kept as ${kept}, starting empty`); }
      catch (e2) { console.error(`  [${path.basename(file)}] unreadable and could not be set aside: ${e2.message}`); }
      cache = parse({}); stamp = null; newer = 0;
    }
    return cache;
  }

  // fn gets a fresh copy from disk and changes it in place; it returns the result, or null to cancel the write.
  // Throws if the file can't be written.
  function update(fn) {
    const data = structuredClone(load());
    if (newer) throw Object.assign(new Error(`${path.basename(file)} was written by a newer termdeck (format ${newer}, this one writes ${version}) — update termdeck to change it`), { code: 'ENEWER' });
    const result = fn(data);
    if (result === null) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version, ...serialize(data) }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    cache = data;
    try { stamp = key(fs.statSync(file)); } catch { stamp = null; }
    return result;
  }

  return { load, update };
}

module.exports = { createStore };
