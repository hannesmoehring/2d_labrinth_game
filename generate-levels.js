#!/usr/bin/env node
// ─────────────────────────────────────────────
//  LEVEL GENERATOR
//
//  Usage:
//    node generate-levels.js              # adds 50 levels
//    node generate-levels.js 100          # adds 100 levels
//    node generate-levels.js 30 --dry-run # preview without writing
//
//  Generates random sliding-puzzle levels, validates each with BFS
//  (optimal ≤ 20 moves), and appends them to puzzle.db ordered by
//  ascending difficulty (size × optimal moves).
// ─────────────────────────────────────────────

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

// ── CLI args ─────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const COUNT   = parseInt(args.find(a => /^\d+$/.test(a)) ?? '50', 10);

if (isNaN(COUNT) || COUNT < 1) {
  console.error('Usage: node generate-levels.js [count=50] [--dry-run]');
  process.exit(1);
}

// ── Size / difficulty tiers ───────────────────
// Each tier specifies grid dimensions, interior wall density range,
// and the acceptable BFS optimal-move window.
const TIERS = [
  { rows:  7, cols:  7, densityMin: 0.18, densityMax: 0.32, minOpt:  2, maxOpt:  7 },
  { rows:  7, cols:  9, densityMin: 0.18, densityMax: 0.32, minOpt:  2, maxOpt:  9 },
  { rows:  9, cols:  9, densityMin: 0.22, densityMax: 0.36, minOpt:  3, maxOpt: 11 },
  { rows:  9, cols: 11, densityMin: 0.22, densityMax: 0.38, minOpt:  4, maxOpt: 13 },
  { rows: 11, cols: 11, densityMin: 0.25, densityMax: 0.40, minOpt:  5, maxOpt: 15 },
  { rows: 11, cols: 13, densityMin: 0.25, densityMax: 0.42, minOpt:  6, maxOpt: 17 },
  { rows: 13, cols: 13, densityMin: 0.28, densityMax: 0.44, minOpt:  7, maxOpt: 18 },
  { rows: 13, cols: 16, densityMin: 0.28, densityMax: 0.44, minOpt:  8, maxOpt: 20 },
  { rows: 15, cols: 15, densityMin: 0.30, densityMax: 0.45, minOpt:  9, maxOpt: 20 },
  { rows: 15, cols: 18, densityMin: 0.30, densityMax: 0.46, minOpt: 10, maxOpt: 20 },
];

// ── RNG helpers ───────────────────────────────
function rand()            { return Math.random(); }
function randInt(lo, hi)   { return lo + Math.floor(rand() * (hi - lo + 1)); }
function randFloat(lo, hi) { return lo + rand() * (hi - lo); }
function pick(arr)         { return arr[Math.floor(rand() * arr.length)]; }

// ── BFS solver ────────────────────────────────
// Returns optimal move count, or -1 if unreachable.
function slideInGrid(grid, rows, cols, r, c, dr, dc) {
  while (true) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) break;
    if (grid[nr][nc] === '#') break;
    r = nr; c = nc;
  }
  return [r, c];
}

function bfsSolve(grid, rows, cols, sr, sc, gr, gc) {
  const key     = (r, c) => r * cols + c;
  const visited = new Set([key(sr, sc)]);
  let   queue   = [[sr, sc, 0]];
  const DIRS    = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  while (queue.length) {
    const next = [];
    for (const [r, c, dist] of queue) {
      for (const [dr, dc] of DIRS) {
        const [nr, nc] = slideInGrid(grid, rows, cols, r, c, dr, dc);
        if (nr === r && nc === c) continue;
        if (nr === gr && nc === gc) return dist + 1;
        const k = key(nr, nc);
        if (!visited.has(k)) { visited.add(k); next.push([nr, nc, dist + 1]); }
      }
    }
    queue = next;
  }
  return -1;
}

// ── Level generation ──────────────────────────
// Strategy:
//   1. Border is all walls.
//   2. Interior cells start as floor; each cell independently
//      becomes a wall with probability `density`.
//   3. Wall clusters: a random subset of wall seeds expand by one
//      cell in a random direction, creating 1×2 or 2×1 pillars —
//      this produces more interesting stop points than pure noise.
//   4. Pick S and G from distinct interior floor cells.
//   5. Validate with BFS; discard if unreachable or out of range.
function generateCandidate(tier) {
  const { rows, cols, minOpt, maxOpt } = tier;
  const density = randFloat(tier.densityMin, tier.densityMax);

  // Build grid
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      const border = (r === 0 || r === rows - 1 || c === 0 || c === cols - 1);
      grid[r][c] = border ? '#' : (rand() < density ? '#' : '.');
    }
  }

  // Expand ~40% of interior walls into small 1×2 / 2×1 clusters
  // (gives the player more surfaces to slide against)
  const EXPAND_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[r][c] === '#' && rand() < 0.4) {
        const [dr, dc] = pick(EXPAND_DIRS);
        const nr = r + dr, nc = c + dc;
        if (nr > 0 && nr < rows - 1 && nc > 0 && nc < cols - 1) {
          grid[nr][nc] = '#';
        }
      }
    }
  }

  // Collect floor cells for S/G placement
  const floors = [];
  for (let r = 1; r < rows - 1; r++)
    for (let c = 1; c < cols - 1; c++)
      if (grid[r][c] === '.') floors.push([r, c]);

  // Need at least 2 floor cells
  if (floors.length < 2) return null;

  // Pick S and G far-ish apart (improves quality: ensures some distance)
  shuffle(floors);
  const minDist = Math.floor(Math.min(rows, cols) * 0.4);
  let sr, sc, gr, gc;

  outer:
  for (let i = 0; i < floors.length; i++) {
    for (let j = floors.length - 1; j > i; j--) {
      const dr = Math.abs(floors[i][0] - floors[j][0]);
      const dc = Math.abs(floors[i][1] - floors[j][1]);
      if (dr + dc >= minDist) {
        [sr, sc] = floors[i];
        [gr, gc] = floors[j];
        break outer;
      }
    }
  }

  // Fall back to random pair if nothing is far enough apart
  if (sr == null) {
    [sr, sc] = floors[0];
    [gr, gc] = floors[floors.length - 1];
  }

  // Validate with BFS
  const opt = bfsSolve(grid, rows, cols, sr, sc, gr, gc);
  if (opt === -1 || opt < minOpt || opt > maxOpt) return null;

  // Serialize to string rows with S / G markers
  const map = grid.map((row, r) =>
    row.map((ch, c) => {
      if (r === sr && c === sc) return 'S';
      if (r === gr && c === gc) return 'G';
      return ch;
    }).join('')
  );

  return { map, opt, rows, cols };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ── Deduplication ─────────────────────────────
// Cheap fingerprint: just join the map rows.
function fingerprint(map) { return map.join('|'); }

// ── Main ──────────────────────────────────────
function main() {
  console.log(`Generating ${COUNT} level${COUNT !== 1 ? 's' : ''}…${DRY_RUN ? ' (dry run)' : ''}`);

  // Per-tier budget: distribute COUNT evenly, extras go to random tiers
  const perTier    = Math.floor(COUNT / TIERS.length);
  const remainder  = COUNT % TIERS.length;
  const budgets    = TIERS.map((_, i) => perTier + (i < remainder ? 1 : 0));

  const results  = [];   // { map, opt, rows, cols }
  const seen     = new Set();
  const MAX_TRIES_PER_SLOT = 5000;

  for (let t = 0; t < TIERS.length; t++) {
    const tier   = TIERS[t];
    const budget = budgets[t];
    let   found  = 0;
    let   tries  = 0;

    while (found < budget && tries < MAX_TRIES_PER_SLOT) {
      tries++;
      const candidate = generateCandidate(tier);
      if (!candidate) continue;
      const fp = fingerprint(candidate.map);
      if (seen.has(fp)) continue;
      seen.add(fp);
      results.push(candidate);
      found++;
    }

    console.log(
      `  Tier ${String(t + 1).padStart(2)} (${String(tier.rows).padStart(2)}×${String(tier.cols).padEnd(2)}) ` +
      `opt ${String(tier.minOpt).padStart(2)}–${String(tier.maxOpt).padEnd(2)} : ` +
      `${found}/${budget} found  (${tries} attempts)`
    );
  }

  if (results.length === 0) {
    console.error('No valid levels generated. Try adjusting density or opt ranges.');
    process.exit(1);
  }

  // Sort ascending by (optimal moves, total cells) so order_index reflects difficulty
  results.sort((a, b) => a.opt - b.opt || (a.rows * a.cols) - (b.rows * b.cols));

  if (DRY_RUN) {
    console.log(`\nDry run — would insert ${results.length} levels:`);
    results.forEach((r, i) => {
      console.log(`  #${String(i + 1).padStart(3)}  ${r.rows}×${r.cols}  opt=${r.opt}`);
    });
    return;
  }

  // ── Database insert ────────────────────────
  const db = new Database(process.env.DB_PATH ?? path.join(__dirname, 'puzzle.db'));
  db.pragma('journal_mode = WAL');

  // Ensure schema exists (generator may run before server.js ever starts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS levels (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      map         TEXT    NOT NULL,
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

  // Find current max order_index so we append after existing levels
  const { maxIdx } = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS maxIdx FROM levels').get();
  const startIdx   = maxIdx + 1;
  const countBefore = db.prepare('SELECT COUNT(*) AS n FROM levels').get().n;

  const insertStmt = db.prepare('INSERT INTO levels (name, map, order_index) VALUES (?, ?, ?)');

  const insertAll = db.transaction((levels) => {
    levels.forEach((lvl, i) => {
      const name = `Auto ${lvl.cols}×${lvl.rows} #${String(countBefore + i + 1).padStart(3, '0')}`;
      insertStmt.run(name, JSON.stringify(lvl.map), startIdx + i);
    });
  });

  insertAll(results);

  const countAfter = db.prepare('SELECT COUNT(*) AS n FROM levels').get().n;
  db.close();

  console.log(`\nInserted ${results.length} levels (DB now has ${countAfter} total).`);

  // Summary histogram
  const buckets = {};
  for (const r of results) {
    buckets[r.opt] = (buckets[r.opt] ?? 0) + 1;
  }
  console.log('\nOptimal-move distribution:');
  for (const opt of Object.keys(buckets).sort((a, b) => +a - +b)) {
    const bar = '█'.repeat(buckets[opt]);
    console.log(`  ${String(opt).padStart(2)} moves: ${String(buckets[opt]).padStart(3)}  ${bar}`);
  }
}

main();
