// ─────────────────────────────────────────────
//  DATABASE  (better-sqlite3, synchronous)
// ─────────────────────────────────────────────
const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, 'puzzle.db'));

// WAL mode: faster reads under concurrent access
db.pragma('journal_mode = WAL');

// ── Schema ──────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS levels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    map         TEXT    NOT NULL,   -- JSON array of strings
    order_index INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS completions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    level_id     INTEGER NOT NULL,
    player_name  TEXT    NOT NULL,
    time_ms      INTEGER NOT NULL,
    moves        INTEGER NOT NULL,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (level_id) REFERENCES levels(id)
  );

  CREATE INDEX IF NOT EXISTS idx_completions_level_time
    ON completions(level_id, time_ms);
`);

// ── Seed levels on first run ─────────────────
const SEED_LEVELS = [
  { name: 'Level 1', map: [
    "##########",
    "#S.......#",
    "#........#",
    "#.......G#",
    "##########",
  ]},
  { name: 'Level 2', map: [
    "##########",
    "#S.......#",
    "#..####..#",
    "#.....#G.#",
    "##########",
  ]},
  { name: 'Level 3', map: [
    "############",
    "#S....#....#",
    "#.....#....#",
    "#..####....#",
    "#..........#",
    "#....#####.#",
    "#.........G#",
    "############",
  ]},
  { name: 'Level 4', map: [
    "##########",
    "#S#......#",
    "#.#.####.#",
    "#.#....#.#",
    "#.######.#",
    "#........#",
    "######.#.#",
    "#......#G#",
    "##########",
  ]},
  { name: 'Level 5', map: [
    "##############",
    "#S...........#",
    "#.###.....##.#",
    "#.#.......#..#",
    "#.#..###..#..#",
    "#....#G#.....#",
    "#....###.....#",
    "#............#",
    "##############",
  ]},
  { name: 'Level 6', map: [
    "##############",
    "#S...........#",
    "#.##########.#",
    "#.#..........#",
    "#.#.########.#",
    "#.#.#......#.#",
    "#.#.#.####.#.#",
    "#.#.#.#..#.#.#",
    "#.#.#.#G.#.#.#",
    "#.#.#....#.#.#",
    "#.#.######.#.#",
    "#.#........#.#",
    "#.##########.#",
    "#............#",
    "##############",
  ]},
  { name: 'Level 7', map: [
    "##############",
    "#...#........#",
    "#...#..####..#",
    "#S..#..#..#..#",
    "#...#..#..#..#",
    "#######..#..##",
    "#........#...#",
    "#..#######...#",
    "#............#",
    "#..#######...#",
    "#........#..G#",
    "##############",
  ]},
  { name: 'Level 8', map: [
    "################",
    "#S.............#",
    "#.###.######.#.#",
    "#.#.........##.#",
    "#.#.#######....#",
    "#.#.#.....#.##.#",
    "#.#.#.###.#.#..#",
    "#.#.#...#.#.#..#",
    "#.#.#.#.#.#.#..#",
    "#.#.#.#.#.#.#..#",
    "#...#.#.....#..#",
    "#####.#######..#",
    "#.............G#",
    "################",
  ]},
];

const levelCount = db.prepare('SELECT COUNT(*) AS n FROM levels').get().n;
if (levelCount === 0) {
  const insert = db.prepare('INSERT INTO levels (name, map, order_index) VALUES (?, ?, ?)');
  const seed   = db.transaction((levels) => {
    levels.forEach((lvl, i) => insert.run(lvl.name, JSON.stringify(lvl.map), i));
  });
  seed(SEED_LEVELS);
  console.log(`Seeded ${SEED_LEVELS.length} levels.`);
}

// ── Prepared statements ──────────────────────
const stmts = {
  getAllLevels: db.prepare(`
    SELECT id, name, map, order_index
    FROM levels ORDER BY order_index
  `),

  getLeaderboard: db.prepare(`
    SELECT id, player_name, time_ms, moves, completed_at
    FROM completions
    WHERE level_id = ?
    ORDER BY time_ms ASC, id ASC
    LIMIT 10
  `),

  getStats: db.prepare(`
    SELECT
      COUNT(*)                       AS total,
      MIN(time_ms)                   AS best_time,
      CAST(AVG(time_ms) AS INTEGER)  AS avg_time,
      MIN(moves)                     AS best_moves,
      ROUND(AVG(moves), 1)           AS avg_moves
    FROM completions
    WHERE level_id = ?
  `),

  insertCompletion: db.prepare(`
    INSERT INTO completions (level_id, player_name, time_ms, moves)
    VALUES (?, ?, ?, ?)
  `),

  // Rank = number of completions strictly faster + 1
  getRank: db.prepare(`
    SELECT COUNT(*) + 1 AS rank
    FROM completions
    WHERE level_id = ?
      AND time_ms < (SELECT time_ms FROM completions WHERE id = ?)
  `),
};

// ── Exported helpers ─────────────────────────
module.exports = {
  getAllLevels() {
    return stmts.getAllLevels.all().map(r => ({ ...r, map: JSON.parse(r.map) }));
  },

  getLeaderboard(levelId) {
    return stmts.getLeaderboard.all(levelId);
  },

  getStats(levelId) {
    return stmts.getStats.get(levelId);
  },

  // Returns the new completion's rowid
  insertCompletion({ levelId, playerName, timeMs, moves }) {
    return stmts.insertCompletion.run(levelId, playerName, timeMs, moves).lastInsertRowid;
  },

  getRank(levelId, completionId) {
    return stmts.getRank.get(levelId, completionId).rank;
  },
};
