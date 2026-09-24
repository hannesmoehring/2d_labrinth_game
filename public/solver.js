// ─────────────────────────────────────────────
//  RULES + SOLVER
//  One file for the browser (a plain <script>, exposed
//  as window.Slide) and for Node (server.js and
//  import-levels.js require it), so the two can never
//  disagree about how a piece moves.
//
//  A level has the player (piece 1, 'S' in a map) and up
//  to three blocks (pieces 2-4, written '2'/'3'/'4').
//  Any piece slides until a wall or another piece stops
//  it, every move of any piece counts, and only the
//  player coming to rest on 'G' wins.
//
//  levelgen/board.py implements the same rules; the
//  importer replays each generated solution through
//  slide() below to prove they agree.
// ─────────────────────────────────────────────
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Slide = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIRS = { U: [-1, 0], D: [1, 0], L: [0, -1], R: [0, 1] };
  const BLOCK_LABELS = ['2', '3', '4'];

  // Returns { rows, cols, walls, goal, pieces } or null for a broken map.
  // Cells are linear indices r * cols + c; pieces[0] is always the player.
  function parseLevel(map) {
    if (!Array.isArray(map) || map.length === 0) return null;
    const rows = map.length;
    const cols = typeof map[0] === 'string' ? map[0].length : 0;
    // A ragged map would let a piece slide past the real edge.
    if (!cols || map.some(row => typeof row !== 'string' || row.length !== cols)) return null;

    const walls  = new Uint8Array(rows * cols);
    const blocks = new Map();
    let start = -1, goal = -1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = map[r][c], cell = r * cols + c;
        if (ch === '#') walls[cell] = 1;
        else if (ch === 'S') { if (start !== -1) return null; start = cell; }
        else if (ch === 'G') { if (goal  !== -1) return null; goal  = cell; }
        else if (BLOCK_LABELS.includes(ch)) { if (blocks.has(ch)) return null; blocks.set(ch, cell); }
        else if (ch !== '.') return null;
      }
    }
    if (start === -1 || goal === -1) return null;

    const pieces = [{ id: 1, cell: start }];
    for (const label of BLOCK_LABELS) {
      if (blocks.has(label)) pieces.push({ id: Number(label), cell: blocks.get(label) });
    }
    return { rows, cols, walls, goal, pieces };
  }

  // Where piece `index` stops when pushed by (dr, dc). `cells` holds every
  // piece's current cell; the others block it like walls. Returns its own
  // cell when it cannot move at all.
  function slide(level, cells, index, dr, dc) {
    const { rows, cols, walls } = level;
    let r = Math.floor(cells[index] / cols), c = cells[index] % cols;
    while (true) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) break;
      const next = nr * cols + nc;
      if (walls[next]) break;
      if (cells.some((x, i) => i !== index && x === next)) break;
      r = nr; c = nc;
    }
    return r * cols + c;
  }

  // Blocks are interchangeable, so a state is keyed by the player and the
  // SORTED block cells: up to 3! = 6 times fewer states to visit.
  function stateKey(cells, n) {
    let key = cells[0];
    const blocks = cells.slice(1).sort((a, b) => a - b);
    for (const b of blocks) key = key * n + b;
    return key;
  }

  // Breadth-first search over the joint state of all pieces.
  // Returns { opt, moves: ['2L', '1U', ...] } or null when unsolvable.
  // Fine for the debug hook and for maps without a stored optimum; the
  // offline generator has a much faster one.
  function solve(map) {
    const level = parseLevel(map);
    if (!level) return null;
    const n     = level.rows * level.cols;
    const start = level.pieces.map(p => p.cell);
    if (start[0] === level.goal) return { opt: 0, moves: [] };

    const prev  = new Map([[stateKey(start, n), null]]);
    let   queue = [start];
    while (queue.length) {
      const next = [];
      for (const cells of queue) {
        const key = stateKey(cells, n);
        for (let i = 0; i < cells.length; i++) {
          for (const [name, [dr, dc]] of Object.entries(DIRS)) {
            const stop = slide(level, cells, i, dr, dc);
            if (stop === cells[i]) continue;
            const moved = cells.slice();
            moved[i] = stop;
            const move = `${level.pieces[i].id}${name}`;
            if (i === 0 && stop === level.goal) {
              const moves = [move];
              for (let at = key; prev.get(at); at = prev.get(at).from) moves.unshift(prev.get(at).move);
              return { opt: moves.length, moves };
            }
            const k = stateKey(moved, n);
            if (prev.has(k)) continue;
            prev.set(k, { from: key, move });
            next.push(moved);
          }
        }
      }
      queue = next;
    }
    return null;
  }

  // Optimal move count, or -1 when the level cannot be played.
  function solveLevel(map) {
    const result = solve(map);
    return result ? result.opt : -1;
  }

  // True when `moves` ('2L 1U ...' or an array) is legal and its last move,
  // and only its last, brings the player to rest on the goal.
  function replay(map, moves) {
    const level = parseLevel(map);
    if (!level) return false;
    const list  = Array.isArray(moves) ? moves : String(moves).trim().split(/\s+/);
    const cells = level.pieces.map(p => p.cell);
    for (let m = 0; m < list.length; m++) {
      const index = level.pieces.findIndex(p => String(p.id) === list[m][0]);
      const dir   = DIRS[list[m][1]];
      if (index === -1 || !dir || list[m].length !== 2) return false;
      const stop = slide(level, cells, index, dir[0], dir[1]);
      if (stop === cells[index]) return false;
      cells[index] = stop;
      if (index === 0 && stop === level.goal) return m === list.length - 1;
    }
    return false;
  }

  return { DIRS, parseLevel, slide, solve, solveLevel, replay };
});
