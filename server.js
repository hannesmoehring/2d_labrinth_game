// ─────────────────────────────────────────────
//  SERVER
// ─────────────────────────────────────────────
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const db      = require('./db');
const { solveLevel } = require('./solver');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '8kb' }));

// ─────────────────────────────────────────────
//  LEVEL INDEX
//  Solved once, held in memory. The browser gets sizes
//  and move counts, never the maps: shipping thousands
//  of mazes is both the slow part of a page load and a
//  way to read a level before playing it.
// ─────────────────────────────────────────────
let levelIndex = null;

function buildIndex() {
  const started = Date.now();
  const rows    = db.getAllLevels();
  const meta    = [];
  const maps    = new Map();
  const unplayable = [];

  for (const lvl of rows) {
    const opt = solveLevel(lvl.map);
    if (opt === -1) { unplayable.push(lvl.id); continue; }
    meta.push({ id: lvl.id, rows: lvl.map.length, cols: lvl.map[0].length, opt });
    maps.set(lvl.id, lvl.map);
  }

  levelIndex = { meta, maps, unplayable, count: rows.length };
  console.log(`Indexed ${meta.length} playable levels of ${rows.length} in ${Date.now() - started}ms.`);
  return levelIndex;
}

// Rebuild when the generator has added levels behind our back.
function getIndex() {
  if (!levelIndex || levelIndex.count !== db.countLevels()) return buildIndex();
  return levelIndex;
}

// ─────────────────────────────────────────────
//  PRESENCE  (in-memory, deliberately not in SQLite)
//  Who is sitting on which level right now. Rewrites
//  itself every 10s per player and must be empty after
//  a restart, so the database is the wrong store.
// ─────────────────────────────────────────────
const PRESENCE_TTL = 30_000;
const PRESENCE_MAX = 5000;
const presence     = new Map();   // sessionId -> { levelId, name, ts }

function prunePresence() {
  const cutoff = Date.now() - PRESENCE_TTL;
  for (const [k, v] of presence) if (v.ts < cutoff) presence.delete(k);
}

function presenceFor(levelId) {
  const names = [];
  let count = 0;
  for (const v of presence.values()) {
    if (v.levelId !== levelId) continue;
    count++;
    if (v.name && names.length < 5) names.push(v.name);
  }
  return { count, names };
}

function presenceCounts() {
  const counts = {};
  for (const v of presence.values()) {
    counts[v.levelId] = (counts[v.levelId] ?? 0) + 1;
  }
  return counts;
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function parseId(raw) {
  if (!/^\d+$/.test(String(raw))) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function noStore(res) {
  res.set('Cache-Control', 'no-store');
  return res;
}

// ── GET /api/levels ──────────────────────────
// Metadata only — no maps. 2762 levels are 632 KB with
// their maps and 94 KB without them.
app.get('/api/levels', (req, res) => {
  const idx = getIndex();
  noStore(res).json({ levels: idx.meta, unplayable: idx.unplayable });
});

// ── GET /api/leaderboard ─────────────────────
// Player ranking for one time window. A crown is a level
// whose fastest run inside that window belongs to you.
const WINDOWS = {
  '24h': '-1 day',
  '7d':  '-7 days',
  '30d': '-30 days',
  'all': '-1000 years',
};

app.get('/api/leaderboard', (req, res) => {
  const key = typeof req.query.window === 'string' ? req.query.window : '30d';
  const modifier = WINDOWS[key];
  if (!modifier) return res.status(400).json({ error: 'Unknown window' });

  const { players, totals } = db.getPlayerRanking(modifier);
  noStore(res).json({ window: key, players, totals });
});

// ── GET /api/levels/stats ────────────────────
// One row per played level. Feeds all browse-grid cards
// in a single request. Registered before /api/levels/:id
// so "stats" can never be captured as an id.
app.get('/api/levels/stats', (req, res) => {
  noStore(res).json(db.getAllLevelStats());
});

// ── GET /api/levels/:id ──────────────────────
// One level's map, fetched when the player enters it.
app.get('/api/levels/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid level id' });

  const idx = getIndex();
  const map = idx.maps.get(id);
  // An unplayable level is never handed out, so the client cannot render
  // a board that has no solution.
  if (!map) return res.status(404).json({ error: 'Level not found' });

  const level = db.getLevelById(id);
  noStore(res).json({
    id,
    name: level ? level.name : `Level ${id}`,
    order_index: level ? level.order_index : 0,
    map,
  });
});

// ── GET /api/levels/:id/leaderboard ──────────
// The board for one level, readable before playing it.
app.get('/api/levels/:id/leaderboard', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid level id' });

  const level = db.getLevelById(id);
  if (!level) return res.status(404).json({ error: 'Level not found' });

  noStore(res).json({
    level: { id: level.id, name: level.name, order_index: level.order_index },
    top:   db.getLeaderboard(id),
    stats: db.getStats(id),
  });
});

// ── GET /api/presence ────────────────────────
// With ?levelId=42 -> { count, names } for that level.
// Without a query  -> { "42": 2 } counts for occupied levels only.
app.get('/api/presence', (req, res) => {
  prunePresence();

  if (req.query.levelId === undefined) {
    return noStore(res).json(presenceCounts());
  }

  const id = parseId(req.query.levelId);
  if (id === null) return res.status(400).json({ error: 'Invalid levelId' });
  noStore(res).json(presenceFor(id));
});

// ── POST /api/presence ───────────────────────
// Heartbeat. levelId:null deregisters (browse screen, page unload).
app.post('/api/presence', (req, res) => {
  const sessionId = typeof req.body.sessionId === 'string' ? req.body.sessionId.slice(0, 64) : '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }

  const levelId = req.body.levelId == null ? null : parseId(req.body.levelId);
  if (req.body.levelId != null && levelId === null) {
    return res.status(400).json({ error: 'Invalid levelId' });
  }

  const name = typeof req.body.playerName === 'string' ? req.body.playerName.trim().slice(0, 32) : '';

  prunePresence();

  if (levelId === null) {
    presence.delete(sessionId);
    return noStore(res).json({ count: 0, names: [] });
  }

  // Cap the map so a misbehaving client cannot grow it without bound. Evict
  // the stalest entry rather than refusing: rejecting would let a flood of
  // junk sessions lock every real player out of the feature.
  if (!presence.has(sessionId) && presence.size >= PRESENCE_MAX) {
    let oldestKey = null, oldestTs = Infinity;
    for (const [k, v] of presence) if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    if (oldestKey !== null) presence.delete(oldestKey);
  }

  presence.set(sessionId, { levelId, name, ts: Date.now() });
  noStore(res).json(presenceFor(levelId));
});

// ── POST /api/completions ────────────────────
// Records a completion and returns the leaderboard
// for that level in a single round-trip.
app.post('/api/completions', (req, res) => {
  const { levelId, playerName, timeMs, moves } = req.body;

  // Input validation
  if (!Number.isInteger(levelId) || levelId < 1) {
    return res.status(400).json({ error: 'Invalid levelId' });
  }
  const name = typeof playerName === 'string' ? playerName.trim().slice(0, 32) : '';
  if (!name) {
    return res.status(400).json({ error: 'Player name is required' });
  }
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > 3_600_000) {
    return res.status(400).json({ error: 'Invalid timeMs' });
  }
  if (!Number.isInteger(moves) || moves < 1 || moves > 10_000) {
    return res.status(400).json({ error: 'Invalid moves' });
  }
  // Clean 404 instead of a foreign-key constraint error from the insert.
  if (!db.levelExists(levelId)) {
    return res.status(404).json({ error: 'Level not found' });
  }

  const completionId = db.insertCompletion({ levelId, playerName: name, timeMs, moves });
  const top          = db.getLeaderboard(levelId);
  const stats        = db.getStats(levelId);
  const rank         = db.getRank(levelId, completionId);

  res.json({ completionId, rank, top, stats });
});

// ─────────────────────────────────────────────
//  INDEX PAGE
//  The asset URLs carry a stamp derived from the files
//  themselves, so a deploy always reaches the browser.
//  A CDN in front of this may override Cache-Control on
//  .css and .js (Cloudflare's Browser Cache TTL does,
//  with 4 hours by default) — a changing URL is the only
//  thing it cannot ignore.
// ─────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, 'public');
let htmlCache = null;

function assetStamp() {
  let sum = 0;
  for (const file of ['style.css', 'main.js']) {
    try {
      const st = fs.statSync(path.join(PUBLIC_DIR, file));
      sum += Math.round(st.mtimeMs) + st.size;
    } catch { /* missing file: the stamp just does not move */ }
  }
  return sum.toString(36);
}

function indexHtml() {
  const stamp = assetStamp();
  if (htmlCache && htmlCache.stamp === stamp) return htmlCache.body;

  const raw  = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const body = raw.replace(/(href|src)="(style\.css|main\.js)(\?v=[^"]*)?"/g,
                           `$1="$2?v=${stamp}"`);
  htmlCache = { stamp, body };
  return body;
}

app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(indexHtml());
});

// no-cache, not no-store: the browser still revalidates cheaply with the
// ETag, but it can never keep a stale client after a deploy. Two people on
// one shared link must be running the same build.
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: 0,
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache'),
}));

app.listen(PORT, () => {
  console.log(`Sliding Puzzle running at http://localhost:${PORT}`);
});
