// ─────────────────────────────────────────────
//  DATABASE  (better-sqlite3, synchronous)
// ─────────────────────────────────────────────
const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');
const { DEFAULT_PACK, readPack, problemWith } = require('./pack');

const db = new Database(process.env.DB_PATH ?? path.join(__dirname, 'puzzle.db'));

// WAL mode: faster reads under concurrent access
db.pragma('journal_mode = WAL');

// The levels/completions foreign key is declared below but better-sqlite3
// leaves enforcement off by default, so a bogus level_id would insert silently.
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS levels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    map         TEXT    NOT NULL,   -- JSON array of strings
    order_index INTEGER NOT NULL,
    opt         INTEGER,            -- fewest moves; NULL = solve at startup
    solution    TEXT                -- one optimal solution, e.g. "2L 1U"
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

// Databases created before blocks existed lack the two newer columns.
const levelColumns = new Set(db.prepare('PRAGMA table_info(levels)').all().map(c => c.name));
if (!levelColumns.has('opt'))      db.exec('ALTER TABLE levels ADD COLUMN opt INTEGER');
if (!levelColumns.has('solution')) db.exec('ALTER TABLE levels ADD COLUMN solution TEXT');

// ── Prepared statements ──────────────────────
const stmts = {
  getAllLevels: db.prepare(`
    SELECT id, name, map, order_index, opt
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

  countLevels: db.prepare('SELECT COUNT(*) AS n FROM levels'),

  // Changes whenever levels are added or replaced: AUTOINCREMENT never
  // hands out an id twice, so MAX(id) moves even when COUNT(*) does not.
  levelSignature: db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS maxId FROM levels'),

  levelMaps:   db.prepare('SELECT map FROM levels'),
  maxOrder:    db.prepare('SELECT COALESCE(MAX(order_index), -1) AS maxIdx FROM levels'),
  insertLevel: db.prepare(`
    INSERT INTO levels (name, map, order_index, opt, solution)
    VALUES (?, ?, ?, ?, ?)
  `),
  countCompletions: db.prepare('SELECT COUNT(*) AS n FROM completions'),

  // ── Global leaderboard ──
  // Every query takes an SQLite date modifier ('-30 days', '-1000 years'
  // for all time). completed_at is UTC text in a sortable format, and
  // datetime('now') is UTC too, so a plain string compare is correct.
  playerTotals: db.prepare(`
    SELECT player_name,
           COUNT(*)                      AS runs,
           COUNT(DISTINCT level_id)      AS levels,
           MIN(time_ms)                  AS best_time,
           CAST(AVG(time_ms) AS INTEGER) AS avg_time,
           SUM(time_ms)                  AS total_time,
           MIN(moves)                    AS best_moves,
           MAX(completed_at)             AS last_at
    FROM completions
    WHERE completed_at >= datetime('now', ?)
    GROUP BY player_name
  `),

  // A crown is a level whose fastest time of ALL TIME is yours.
  //
  // Deliberately not scoped to the selected window. Scoped, it counts
  // "fastest among runs inside the window", which drops as the window
  // widens and more rivals join the comparison — a player could hold 296
  // crowns over 30 days and 271 over all time. Correct arithmetic, but it
  // sits next to columns that only ever grow, so it reads as a defect.
  // A record is a fact about the level, not about a date range.
  playerCrowns: db.prepare(`
    SELECT player_name, COUNT(*) AS crowns
    FROM (
      SELECT player_name,
             ROW_NUMBER() OVER (
               PARTITION BY level_id ORDER BY time_ms ASC, id ASC
             ) AS rn
      FROM completions
    )
    WHERE rn = 1
    GROUP BY player_name
  `),

  windowTotals: db.prepare(`
    SELECT COUNT(*)                    AS runs,
           COUNT(DISTINCT player_name) AS players,
           COUNT(DISTINCT level_id)    AS levels,
           MIN(time_ms)                AS best_time,
           SUM(time_ms)                AS total_time
    FROM completions
    WHERE completed_at >= datetime('now', ?)
  `),

  getLevelById: db.prepare(`
    SELECT id, name, map, order_index
    FROM levels WHERE id = ?
  `),

  levelExists: db.prepare(`
    SELECT 1 AS ok FROM levels WHERE id = ?
  `),

  // One row per level that has been played at least once.
  // Feeds every card on the browse grid in a single request.
  getAllLevelStats: db.prepare(`
    SELECT c.level_id,
           COUNT(*)            AS plays,
           MIN(c.time_ms)      AS best_time,
           MIN(c.moves)        AS best_moves,
           MAX(c.completed_at) AS last_at,
           (SELECT player_name FROM completions
             WHERE level_id = c.level_id
             ORDER BY time_ms ASC, id ASC LIMIT 1) AS best_name
    FROM completions c
    GROUP BY c.level_id
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

const importTx = db.transaction((levels, replace) => {
  if (replace) db.exec('DELETE FROM completions; DELETE FROM levels;');
  const present = new Set(stmts.levelMaps.all().map(r => r.map));
  let order = stmts.maxOrder.get().maxIdx + 1;
  let added = 0;
  for (const lvl of levels) {
    const map = JSON.stringify(lvl.map);
    if (present.has(map)) continue;
    present.add(map);
    const name = `Auto ${lvl.map[0].length}×${lvl.map.length} #${String(order + 1).padStart(3, '0')}`;
    stmts.insertLevel.run(name, map, order++, lvl.opt ?? null, lvl.solution ?? null);
    added++;
  }
  return added;
});

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

  getLevelById(levelId) {
    const row = stmts.getLevelById.get(levelId);
    return row ? { ...row, map: JSON.parse(row.map) } : null;
  },

  levelExists(levelId) {
    return !!stmts.levelExists.get(levelId);
  },

  getAllLevelStats() {
    return stmts.getAllLevelStats.all();
  },

  countLevels() {
    return stmts.countLevels.get().n;
  },

  levelSignature() {
    const { n, maxId } = stmts.levelSignature.get();
    return `${n}:${maxId}`;
  },

  countCompletions() {
    return stmts.countCompletions.get().n;
  },

  // Appends pack levels after the existing ones, skipping maps already
  // present. `replace` first drops every level AND every completion: a
  // time recorded on a level that no longer exists ranks nothing.
  // Returns how many levels were inserted.
  importLevels(levels, { replace = false } = {}) {
    return importTx(levels, replace);
  },

  // A fresh database gets the committed pack, so a new deploy has levels
  // without anyone running the importer by hand.
  loadPackIfEmpty() {
    if (stmts.countLevels.get().n > 0 || !fs.existsSync(DEFAULT_PACK)) return;
    const levels = readPack().filter(lvl => !problemWith(lvl));
    console.log(`Loaded ${importTx(levels, false)} levels from ${path.relative(__dirname, DEFAULT_PACK)}.`);
  },

  // Ranked players for one time window.
  // Activity (levels, runs, times) is window-scoped; records are not.
  getPlayerRanking(modifier, limit = 100) {
    const crowns = new Map(
      stmts.playerCrowns.all().map(r => [r.player_name, r.crowns]));

    const players = stmts.playerTotals.all(modifier)
      .map(r => ({ ...r, crowns: crowns.get(r.player_name) ?? 0 }))
      .sort((a, b) =>
        (b.crowns - a.crowns) ||
        (b.levels - a.levels) ||
        (b.runs   - a.runs)   ||
        (a.best_time - b.best_time) ||
        a.player_name.localeCompare(b.player_name));

    return { players: players.slice(0, limit), totals: stmts.windowTotals.get(modifier) };
  },

  // Returns the new completion's rowid
  insertCompletion({ levelId, playerName, timeMs, moves }) {
    return stmts.insertCompletion.run(levelId, playerName, timeMs, moves).lastInsertRowid;
  },

  getRank(levelId, completionId) {
    return stmts.getRank.get(levelId, completionId).rank;
  },
};
