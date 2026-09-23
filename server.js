// ─────────────────────────────────────────────
//  SERVER
// ─────────────────────────────────────────────
const express = require('express');
const path    = require('path');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '8kb' }));

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
// Returns all levels (id, name, map, order_index).
// The client runs BFS to filter unsolvable levels and
// compute optimal move counts.
app.get('/api/levels', (req, res) => {
  noStore(res).json(db.getAllLevels());
});

// ── GET /api/levels/stats ────────────────────
// One row per played level. Feeds all browse-grid cards
// in a single request. Registered before /api/levels/:id
// so "stats" can never be captured as an id.
app.get('/api/levels/stats', (req, res) => {
  noStore(res).json(db.getAllLevelStats());
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

// no-cache, not no-store: the browser still revalidates cheaply with the
// ETag, but it can never keep a stale client after a deploy. Two people on
// one shared link must be running the same build.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache'),
}));

app.listen(PORT, () => {
  console.log(`Sliding Puzzle running at http://localhost:${PORT}`);
});
