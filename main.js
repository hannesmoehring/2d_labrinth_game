// ─────────────────────────────────────────────
//  LEVEL DATA
//  Encoding: # wall  . floor  S start  G goal
// ─────────────────────────────────────────────
const LEVELS = [
  // 1 – Tutorial: one straight slide
  [
    "##########",
    "#S.......#",
    "#........#",
    "#.......G#",
    "##########",
  ],

  // 2 – First corner: must use walls to redirect
  [
    "##########",
    "#S.......#",
    "#..####..#",
    "#.....#G.#",
    "##########",
  ],

  // 3 – Maze with interior pillars
  [
    "############",
    "#S....#....#",
    "#.....#....#",
    "#..####....#",
    "#..........#",
    "#....#####.#",
    "#.........G#",
    "############",
  ],

  // 4 – Narrow corridors
  [
    "##########",
    "#S#......#",
    "#.#.####.#",
    "#.#....#.#",
    "#.######.#",
    "#........#",
    "######.#.#",
    "#......#G#",
    "##########",
  ],

  // 5 – Wide open with strategic pillars
  [
    "##############",
    "#S...........#",
    "#.###.....##.#",
    "#.#.......#..#",
    "#.#..###..#..#",
    "#....#G#.....#",
    "#....###.....#",
    "#............#",
    "##############",
  ],

  // 6 – Spiral-ish layout
  [
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
  ],

  // 7 – Multiple deflections required
  [
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
  ],

  // 8 – Final challenge
  [
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
  ],
];

// ─────────────────────────────────────────────
//  BFS SOLVER
//  Returns minimum move count to solve a level,
//  or -1 if no solution exists.
// ─────────────────────────────────────────────

// Slide from (r,c) in direction (dr,dc), stopping before walls/bounds.
function slideInGrid(grid, rows, cols, r, c, dr, dc) {
  while (true) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) break;
    if (grid[nr][nc] === '#') break;
    r = nr;
    c = nc;
  }
  return [r, c];
}

// BFS over (row, col) position states.
function solveLevel(rawLevel) {
  const rows = rawLevel.length;
  const cols = rawLevel[0].length;
  const grid = rawLevel.map(row => row.split(''));

  let sr, sc, gr, gc;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 'S') { sr = r; sc = c; }
      if (grid[r][c] === 'G') { gr = r; gc = c; }
    }
  }

  // Encode (r,c) as a single integer for fast Set lookups
  const key = (r, c) => r * cols + c;
  const visited = new Set([key(sr, sc)]);
  let queue = [[sr, sc, 0]];

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  while (queue.length) {
    const next = [];
    for (const [r, c, dist] of queue) {
      for (const [dr, dc] of DIRS) {
        const [nr, nc] = slideInGrid(grid, rows, cols, r, c, dr, dc);
        if (nr === r && nc === c) continue; // no movement
        if (nr === gr && nc === gc) return dist + 1;
        const k = key(nr, nc);
        if (!visited.has(k)) {
          visited.add(k);
          next.push([nr, nc, dist + 1]);
        }
      }
    }
    queue = next;
  }

  return -1; // unsolvable
}

// ─────────────────────────────────────────────
//  DIFFICULTY
// ─────────────────────────────────────────────
function getDifficulty(optimalMoves, rows, cols) {
  // Score combines move complexity with grid area
  const score = optimalMoves + Math.floor((rows * cols) / 25);
  if (score <= 4)  return { label: 'Easy',   cssClass: 'diff-easy'   };
  if (score <= 8)  return { label: 'Medium',  cssClass: 'diff-medium' };
  if (score <= 12) return { label: 'Hard',    cssClass: 'diff-hard'   };
  return                   { label: 'Expert', cssClass: 'diff-expert' };
}

// ─────────────────────────────────────────────
//  LEVEL VALIDATION
//  Run BFS at startup; discard unsolvable levels.
// ─────────────────────────────────────────────
const VALID_LEVELS  = [];
const OPTIMAL_MOVES = [];

for (let i = 0; i < LEVELS.length; i++) {
  const opt = solveLevel(LEVELS[i]);
  if (opt === -1) {
    console.warn(`Level ${i + 1} is unsolvable — skipped.`);
  } else {
    VALID_LEVELS.push(LEVELS[i]);
    OPTIMAL_MOVES.push(opt);
  }
}

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
const state = {
  levelIndex: 0,
  grid: [],        // 2D array of chars: '#' '.' 'S' 'G'
  rows: 0,
  cols: 0,
  playerRow: 0,
  playerCol: 0,
  startRow: 0,
  startCol: 0,
  goalRow: 0,
  goalCol: 0,
  moves: 0,
  inputLocked: false,  // true while overlay is shown
  _pendingWin: false,  // win detected mid-animation; fire after slide ends
};

// Module-level animation flag (separate from inputLocked to keep concerns clear)
let isAnimating = false;

// ─────────────────────────────────────────────
//  LEVEL LOADING
// ─────────────────────────────────────────────
function loadLevel(index) {
  const raw = VALID_LEVELS[index];
  state.levelIndex = index;
  state.moves = 0;
  state.inputLocked = false;
  state._pendingWin = false;
  isAnimating = false;
  state.grid = [];

  state.rows = raw.length;
  state.cols = raw[0].length;

  for (let r = 0; r < state.rows; r++) {
    state.grid[r] = [];
    for (let c = 0; c < state.cols; c++) {
      const ch = raw[r][c] ?? '.';
      state.grid[r][c] = ch;

      if (ch === 'S') {
        state.playerRow = r;
        state.playerCol = c;
        state.startRow  = r;
        state.startCol  = c;
      }
      if (ch === 'G') {
        state.goalRow = r;
        state.goalCol = c;
      }
    }
  }

  // Update difficulty bar
  const opt = OPTIMAL_MOVES[index];
  const { label, cssClass } = getDifficulty(opt, state.rows, state.cols);
  document.getElementById('detail-dims').textContent    = `${state.cols}×${state.rows}`;
  document.getElementById('detail-optimal').textContent = `Optimal: ${opt}`;
  const diffEl = document.getElementById('detail-difficulty');
  diffEl.textContent = label;
  diffEl.className   = cssClass;

  hideOverlay();
  render();
}

// ─────────────────────────────────────────────
//  RENDERING
// ─────────────────────────────────────────────
const boardEl     = document.getElementById('board');
const levelLabel  = document.getElementById('level-label');
const moveCounter = document.getElementById('move-counter');

function render() {
  // Compute tile size that fits within the viewport
  const maxBoardPx = Math.min(window.innerWidth - 40, window.innerHeight - 180);
  const tileSize   = Math.max(24, Math.floor(maxBoardPx / Math.max(state.rows, state.cols)));

  boardEl.style.setProperty('--cols', state.cols);
  boardEl.style.setProperty('--rows', state.rows);
  boardEl.style.setProperty('--tile-size', tileSize + 'px');

  boardEl.innerHTML = '';

  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const tile = document.createElement('div');
      tile.classList.add('tile');

      const ch = state.grid[r][c];

      if (ch === '#') {
        tile.classList.add('wall');
      } else {
        tile.classList.add('floor');
        if (r === state.goalRow && c === state.goalCol) {
          tile.classList.add('goal');
        }
      }

      if (r === state.playerRow && c === state.playerCol) {
        tile.classList.add('player');
      }

      boardEl.appendChild(tile);
    }
  }

  levelLabel.textContent  = `Level ${state.levelIndex + 1} / ${VALID_LEVELS.length}`;
  moveCounter.textContent = `Moves: ${state.moves}`;
}

// ─────────────────────────────────────────────
//  SLIDING ANIMATION
//  Called after render() with the old and new player positions.
//  Offsets the player div to its old position, then transitions
//  it to the natural (new) position, creating a slide effect.
// ─────────────────────────────────────────────
function animatePlayer(fromRow, fromCol, toRow, toCol) {
  // Zero-distance moves (already blocked by move() guard, but be defensive)
  if (fromRow === toRow && fromCol === toCol) return;

  isAnimating = true;

  const tileSize = parseInt(
    getComputedStyle(boardEl).getPropertyValue('--tile-size'), 10
  );
  const gap = 2; // matches the CSS `gap: 2px` on #board

  // How far to offset: place the div visually back at (fromRow, fromCol)
  const dx = (fromCol - toCol) * (tileSize + gap);
  const dy = (fromRow - toRow) * (tileSize + gap);

  const playerEl = boardEl.querySelector('.tile.player');
  if (!playerEl) {
    isAnimating = false;
    return;
  }

  // Set starting offset with no transition
  playerEl.style.transition = 'none';
  playerEl.style.transform  = `translate(${dx}px, ${dy}px)`;

  // Force a reflow so the browser registers the starting transform
  // before we enable the transition
  playerEl.getBoundingClientRect();

  // Animate back to natural position
  playerEl.style.transition = 'transform 0.18s ease-out';
  playerEl.style.transform  = 'translate(0, 0)';

  // Cleanup after the transition completes
  function onDone() {
    playerEl.style.transition = '';
    playerEl.style.transform  = '';
    isAnimating = false;
    if (state._pendingWin) {
      state._pendingWin = false;
      onLevelComplete();
    }
  }

  playerEl.addEventListener('transitionend', onDone, { once: true });

  // Fallback: if transitionend never fires (e.g. display:none, tab hidden),
  // force cleanup after a safe margin beyond the animation duration.
  setTimeout(() => {
    if (isAnimating) onDone();
  }, 280);
}

// ─────────────────────────────────────────────
//  MOVEMENT
// ─────────────────────────────────────────────
function isBlocked(r, c) {
  if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) return true;
  return state.grid[r][c] === '#';
}

function move(dr, dc) {
  if (state.inputLocked || isAnimating) return;

  let r = state.playerRow;
  let c = state.playerCol;

  // If immediately blocked, do nothing
  if (isBlocked(r + dr, c + dc)) return;

  // Slide until the next step would be blocked
  while (!isBlocked(r + dr, c + dc)) {
    r += dr;
    c += dc;
  }

  // No actual movement
  if (r === state.playerRow && c === state.playerCol) return;

  const fromRow = state.playerRow;
  const fromCol = state.playerCol;

  state.playerRow = r;
  state.playerCol = c;
  state.moves++;

  // Detect win before render so we can defer the overlay until after animation
  state._pendingWin = (r === state.goalRow && c === state.goalCol);

  render();
  animatePlayer(fromRow, fromCol, r, c);

  // For the non-animation win path (if animatePlayer somehow skips): handled in onDone()
}

// ─────────────────────────────────────────────
//  WIN / LEVEL PROGRESSION
// ─────────────────────────────────────────────
const overlay    = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlay-message');
const overlayBtn = document.getElementById('overlay-btn');

function onLevelComplete() {
  state.inputLocked = true;

  const isLast = state.levelIndex >= VALID_LEVELS.length - 1;

  if (isLast) {
    showOverlay(
      `You solved all ${VALID_LEVELS.length} levels!`,
      'Play again',
      () => loadLevel(0)
    );
  } else {
    showOverlay(`Level ${state.levelIndex + 1} complete!`, null, null);
    setTimeout(() => loadLevel(state.levelIndex + 1), 1400);
  }
}

function showOverlay(message, btnLabel, btnAction) {
  overlayMsg.textContent = message;
  overlay.classList.remove('hidden');

  if (btnLabel) {
    overlayBtn.textContent = btnLabel;
    overlayBtn.classList.remove('hidden');
    overlayBtn.onclick = () => { hideOverlay(); btnAction(); };
  } else {
    overlayBtn.classList.add('hidden');
    overlayBtn.onclick = null;
  }
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

// ─────────────────────────────────────────────
//  RESET
// ─────────────────────────────────────────────
function resetLevel() {
  loadLevel(state.levelIndex);
}

// ─────────────────────────────────────────────
//  INPUT HANDLING
// ─────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowUp':    case 'w': case 'W': move(-1,  0); break;
    case 'ArrowDown':  case 's': case 'S': move( 1,  0); break;
    case 'ArrowLeft':  case 'a': case 'A': move( 0, -1); break;
    case 'ArrowRight': case 'd': case 'D': move( 0,  1); break;
    case ' ':
      if (!overlay.classList.contains('hidden') && overlayBtn.onclick) {
        overlayBtn.onclick();
      } else {
        resetLevel();
      }
      break;
    default: return;
  }
  e.preventDefault();
});

document.getElementById('restart-btn').addEventListener('click', resetLevel);

// Skip re-render during animation to avoid interrupting the slide
window.addEventListener('resize', () => {
  if (!isAnimating) render();
});

// ─────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────
loadLevel(0);
