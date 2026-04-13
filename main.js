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
  inputLocked: false,  // true during level-complete delay
};

// ─────────────────────────────────────────────
//  LEVEL LOADING
// ─────────────────────────────────────────────
function loadLevel(index) {
  const raw = LEVELS[index];
  state.levelIndex = index;
  state.moves = 0;
  state.inputLocked = false;
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

  hideOverlay();
  render();
}

// ─────────────────────────────────────────────
//  RENDERING
// ─────────────────────────────────────────────
const boardEl   = document.getElementById('board');
const levelLabel = document.getElementById('level-label');
const moveCounter = document.getElementById('move-counter');

function render() {
  // Compute a reasonable tile size based on the grid dimensions
  const maxBoardPx = Math.min(window.innerWidth - 40, window.innerHeight - 140);
  const tileSize = Math.max(24, Math.floor(maxBoardPx / Math.max(state.rows, state.cols)));

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
        if (ch === 'G' || (r === state.goalRow && c === state.goalCol)) {
          tile.classList.add('goal');
        }
      }

      if (r === state.playerRow && c === state.playerCol) {
        tile.classList.add('player');
      }

      boardEl.appendChild(tile);
    }
  }

  levelLabel.textContent  = `Level ${state.levelIndex + 1} / ${LEVELS.length}`;
  moveCounter.textContent = `Moves: ${state.moves}`;
}

// ─────────────────────────────────────────────
//  MOVEMENT
// ─────────────────────────────────────────────
function isBlocked(r, c) {
  if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) return true;
  return state.grid[r][c] === '#';
}

function move(dr, dc) {
  if (state.inputLocked) return;

  let r = state.playerRow;
  let c = state.playerCol;

  // If immediately blocked, do nothing
  if (isBlocked(r + dr, c + dc)) return;

  // Slide until the next step would be blocked
  while (!isBlocked(r + dr, c + dc)) {
    r += dr;
    c += dc;
  }

  // Only count as a move if position actually changed
  if (r === state.playerRow && c === state.playerCol) return;

  state.playerRow = r;
  state.playerCol = c;
  state.moves++;

  render();

  // Check win condition
  if (r === state.goalRow && c === state.goalCol) {
    onLevelComplete();
  }
}

// ─────────────────────────────────────────────
//  WIN / LEVEL PROGRESSION
// ─────────────────────────────────────────────
const overlay     = document.getElementById('overlay');
const overlayMsg  = document.getElementById('overlay-message');
const overlayBtn  = document.getElementById('overlay-btn');

function onLevelComplete() {
  state.inputLocked = true;

  const isLast = state.levelIndex >= LEVELS.length - 1;

  if (isLast) {
    showOverlay(
      `You solved all ${LEVELS.length} levels!`,
      'Play again',
      () => loadLevel(0)
    );
  } else {
    showOverlay(
      `Level ${state.levelIndex + 1} complete!`,
      null,
      null
    );
    // Auto-advance after 1.4 s
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
  // Allow reset even while input is locked (e.g. mid-overlay)
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
      // Space resets; if on final-complete overlay it restarts from level 1
      if (!overlay.classList.contains('hidden') && overlayBtn.onclick) {
        overlayBtn.onclick();
      } else {
        resetLevel();
      }
      break;
    default: return; // don't preventDefault for unhandled keys
  }
  e.preventDefault(); // suppress scroll for arrow / space
});

// Reset button in UI bar
document.getElementById('restart-btn').addEventListener('click', resetLevel);

// Re-render on window resize (tile size recalculates)
window.addEventListener('resize', () => render());

// ─────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────
loadLevel(0);
