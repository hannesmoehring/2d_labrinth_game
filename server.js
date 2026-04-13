// ─────────────────────────────────────────────
//  SERVER
// ─────────────────────────────────────────────
const express = require('express');
const path    = require('path');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/levels ──────────────────────────
// Returns all levels (id, name, map, order_index).
// The client runs BFS to filter unsolvable levels and
// compute optimal move counts — same as before, just
// now the map data comes from the server.
app.get('/api/levels', (req, res) => {
  res.json(db.getAllLevels());
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

  const completionId = db.insertCompletion({ levelId, playerName: name, timeMs, moves });
  const top          = db.getLeaderboard(levelId);
  const stats        = db.getStats(levelId);
  const rank         = db.getRank(levelId, completionId);

  res.json({ completionId, rank, top, stats });
});

app.listen(PORT, () => {
  console.log(`Sliding Puzzle running at http://localhost:${PORT}`);
});
