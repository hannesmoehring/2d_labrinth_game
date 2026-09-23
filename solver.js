// ─────────────────────────────────────────────
//  SOLVER  (shared by server.js and generate-levels.js)
//
//  A move slides the player until a wall stops them.
//  solveLevel returns the minimum number of moves from
//  S to G, or -1 when the level cannot be solved.
// ─────────────────────────────────────────────
'use strict';

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

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

// Takes a map as an array of equal-length strings.
// Returns the optimal move count, or -1 when unplayable.
function solveLevel(map) {
  if (!Array.isArray(map) || map.length === 0) return -1;
  const rows = map.length;
  const cols = map[0].length;
  // A ragged map would let the player slide past the real edge.
  if (map.some(row => typeof row !== 'string' || row.length !== cols)) return -1;

  const grid = map.map(row => row.split(''));

  let sr, sc, gr, gc;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 'S') { sr = r; sc = c; }
      if (grid[r][c] === 'G') { gr = r; gc = c; }
    }
  if (sr === undefined || gr === undefined) return -1;

  return bfsSolve(grid, rows, cols, sr, sc, gr, gc);
}

module.exports = { DIRS, slideInGrid, bfsSolve, solveLevel };
