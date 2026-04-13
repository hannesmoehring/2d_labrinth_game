// ─────────────────────────────────────────────
//  BFS SOLVER
//  Runs client-side on levels fetched from server.
//  Returns minimum move count, or -1 if unsolvable.
// ─────────────────────────────────────────────

function slideInGrid(grid, rows, cols, r, c, dr, dc) {
  while (true) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) break;
    if (grid[nr][nc] === '#') break;
    r = nr; c = nc;
  }
  return [r, c];
}

function solveLevel(rawLevel) {
  const rows = rawLevel.length;
  const cols = rawLevel[0].length;
  const grid = rawLevel.map(row => row.split(''));

  let sr, sc, gr, gc;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 'S') { sr = r; sc = c; }
      if (grid[r][c] === 'G') { gr = r; gc = c; }
    }

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

// ─────────────────────────────────────────────
//  DIFFICULTY
// ─────────────────────────────────────────────
function getDifficulty(optimalMoves, rows, cols) {
  const score = optimalMoves + Math.floor((rows * cols) / 25);
  if (score <= 4)  return { label: 'Easy',   cssClass: 'diff-easy'   };
  if (score <= 8)  return { label: 'Medium',  cssClass: 'diff-medium' };
  if (score <= 12) return { label: 'Hard',    cssClass: 'diff-hard'   };
  return                   { label: 'Expert', cssClass: 'diff-expert' };
}

// ─────────────────────────────────────────────
//  LEVEL REGISTRY (populated from server)
// ─────────────────────────────────────────────
let VALID_LEVELS  = [];   // raw map arrays
let OPTIMAL_MOVES = [];   // parallel optimal move counts
let LEVEL_IDS     = [];   // server-assigned IDs (for leaderboard API)

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
const state = {
  levelIndex: 0,
  levelId: null,       // server ID for current level (used in API calls)
  grid: [],
  rows: 0,
  cols: 0,
  playerRow: 0,
  playerCol: 0,
  startRow: 0,
  startCol: 0,
  goalRow: 0,
  goalCol: 0,
  moves: 0,
  timeMs: 0,           // elapsed ms at win
  inputLocked: false,
  _pendingWin: false,
};

// Module-level animation flag
let isAnimating = false;

// ─────────────────────────────────────────────
//  TIMER
//  Starts on first move; stops on win or reset.
// ─────────────────────────────────────────────
let timerInterval = null;
let startTime     = null;
let firstMoveMade = false;

function startTimer() {
  if (timerInterval) return;
  startTime     = Date.now();
  firstMoveMade = true;
  timerInterval = setInterval(() => {
    document.getElementById('timer').textContent =
      formatTime(Date.now() - startTime);
  }, 100);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function resetTimer() {
  stopTimer();
  firstMoveMade = false;
  startTime     = null;
  document.getElementById('timer').textContent = '0.0s';
}

// ─────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────
function formatTime(ms) {
  if (ms == null) return '—';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  const m   = Math.floor(s / 60);
  const rem = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}m ${rem}s`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────
//  LEVEL LOADING
// ─────────────────────────────────────────────
function loadLevel(index) {
  const raw = VALID_LEVELS[index];
  state.levelIndex  = index;
  state.levelId     = LEVEL_IDS[index];
  state.moves       = 0;
  state.timeMs      = 0;
  state.inputLocked = false;
  state._pendingWin = false;
  isAnimating       = false;
  state.grid        = [];

  resetTimer();

  state.rows = raw.length;
  state.cols = raw[0].length;

  for (let r = 0; r < state.rows; r++) {
    state.grid[r] = [];
    for (let c = 0; c < state.cols; c++) {
      const ch = raw[r][c] ?? '.';
      state.grid[r][c] = ch;
      if (ch === 'S') { state.playerRow = r; state.playerCol = c; state.startRow = r; state.startCol = c; }
      if (ch === 'G') { state.goalRow   = r; state.goalCol   = c; }
    }
  }

  // Update difficulty bar
  const opt              = OPTIMAL_MOVES[index];
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
  const maxBoardPx = Math.min(window.innerWidth - 40, window.innerHeight - 200);
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
        if (r === state.goalRow && c === state.goalCol) tile.classList.add('goal');
      }
      if (r === state.playerRow && c === state.playerCol) tile.classList.add('player');
      boardEl.appendChild(tile);
    }
  }

  levelLabel.textContent  = `Level ${state.levelIndex + 1} / ${VALID_LEVELS.length}`;
  moveCounter.textContent = `Moves: ${state.moves}`;
}

// ─────────────────────────────────────────────
//  SLIDING ANIMATION
// ─────────────────────────────────────────────
function animatePlayer(fromRow, fromCol, toRow, toCol) {
  if (fromRow === toRow && fromCol === toCol) return;

  isAnimating = true;

  const tileSize = parseInt(getComputedStyle(boardEl).getPropertyValue('--tile-size'), 10);
  const gap      = 2;
  const dx       = (fromCol - toCol) * (tileSize + gap);
  const dy       = (fromRow - toRow) * (tileSize + gap);

  const playerEl = boardEl.querySelector('.tile.player');
  if (!playerEl) { isAnimating = false; return; }

  playerEl.style.transition = 'none';
  playerEl.style.transform  = `translate(${dx}px, ${dy}px)`;
  playerEl.getBoundingClientRect(); // force reflow

  playerEl.style.transition = 'transform 0.18s ease-out';
  playerEl.style.transform  = 'translate(0, 0)';

  function onDone() {
    playerEl.style.transition = '';
    playerEl.style.transform  = '';
    isAnimating = false;
    if (state._pendingWin) { state._pendingWin = false; onLevelComplete(); }
  }

  playerEl.addEventListener('transitionend', onDone, { once: true });
  // Fallback if transitionend never fires (hidden tab, etc.)
  setTimeout(() => { if (isAnimating) onDone(); }, 280);
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

  let r = state.playerRow, c = state.playerCol;
  if (isBlocked(r + dr, c + dc)) return;

  while (!isBlocked(r + dr, c + dc)) { r += dr; c += dc; }
  if (r === state.playerRow && c === state.playerCol) return;

  // Start timer on very first move of this level
  if (!firstMoveMade) startTimer();

  const fromRow = state.playerRow, fromCol = state.playerCol;
  state.playerRow = r;
  state.playerCol = c;
  state.moves++;

  state._pendingWin = (r === state.goalRow && c === state.goalCol);

  render();
  animatePlayer(fromRow, fromCol, r, c);
}

// ─────────────────────────────────────────────
//  WIN FLOW  (name entry → leaderboard)
// ─────────────────────────────────────────────
const overlay    = document.getElementById('overlay');
const overlayBox = document.getElementById('overlay-box');

function onLevelComplete() {
  state.inputLocked = true;
  stopTimer();
  state.timeMs = startTime ? Date.now() - startTime : 0;

  showNameEntry();
}

function showNameEntry() {
  const opt    = OPTIMAL_MOVES[state.levelIndex];
  const isLast = state.levelIndex >= VALID_LEVELS.length - 1;

  // Pre-fill from last session if available
  const savedName = localStorage.getItem('playerName') || '';

  overlayBox.innerHTML = `
    <p class="overlay-title">Level ${state.levelIndex + 1} complete!</p>
    <p class="overlay-meta">
      <strong>${formatTime(state.timeMs)}</strong>
      &nbsp;·&nbsp;
      <strong>${state.moves}</strong> moves
      &nbsp;·&nbsp;
      Optimal: ${opt}
    </p>
    <div class="name-form">
      <input
        type="text"
        id="name-input"
        placeholder="Your name"
        maxlength="32"
        autocomplete="off"
        value="${escapeHtml(savedName)}"
      >
      <button class="primary-btn" id="name-submit">Submit</button>
    </div>
  `;

  overlay.classList.remove('hidden');

  const input  = document.getElementById('name-input');
  const btn    = document.getElementById('name-submit');

  // Focus and select so the player can type immediately
  input.focus();
  input.select();

  const submit = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    localStorage.setItem('playerName', name);
    btn.disabled    = true;
    btn.textContent = '...';
    submitCompletion(name, isLast);
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

async function submitCompletion(playerName, isLast) {
  try {
    const res = await fetch('/api/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        levelId:    state.levelId,
        playerName,
        timeMs:     state.timeMs,
        moves:      state.moves,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    showLeaderboard(data, isLast);
  } catch {
    // Server unreachable — still let the player advance
    overlayBox.innerHTML = `
      <p class="overlay-title">Level ${state.levelIndex + 1} complete!</p>
      <p class="overlay-error">Could not reach the server. Score not saved.</p>
      <button class="primary-btn" id="next-btn">${isLast ? 'Play Again' : 'Next Level →'}</button>
    `;
    document.getElementById('next-btn').addEventListener('click', () => {
      hideOverlay();
      isLast ? loadLevel(0) : loadLevel(state.levelIndex + 1);
    });
  }
}

function showLeaderboard({ completionId, rank, top, stats }, isLast) {
  const rows = top.map((entry, i) => {
    const isMe = entry.id === completionId;
    return `
      <tr class="${isMe ? 'lb-me' : ''}">
        <td>${i + 1}</td>
        <td>${escapeHtml(entry.player_name)}</td>
        <td>${formatTime(entry.time_ms)}</td>
        <td>${entry.moves}</td>
      </tr>
    `;
  }).join('');

  // Show player rank below table if they didn't make the top 10
  const rankNote = rank > 10
    ? `<p class="rank-note">Your rank: <strong>#${rank}</strong> — ${formatTime(state.timeMs)} · ${state.moves} moves</p>`
    : '';

  const hasStats = stats && stats.total > 0;

  overlayBox.innerHTML = `
    <p class="overlay-title">Level ${state.levelIndex + 1} · Leaderboard</p>

    <div class="lb-stats">
      <span>Best <strong>${hasStats ? formatTime(stats.best_time) : '—'}</strong></span>
      <span>Avg <strong>${hasStats ? formatTime(stats.avg_time) : '—'}</strong></span>
      <span><strong>${stats ? stats.total : 0}</strong> play${stats && stats.total !== 1 ? 's' : ''}</span>
      <span>Avg moves <strong>${hasStats ? Number(stats.avg_moves).toFixed(1) : '—'}</strong></span>
    </div>

    ${top.length > 0
      ? `<div class="lb-scroll">
           <table class="leaderboard">
             <thead><tr><th>#</th><th>Name</th><th>Time</th><th>Moves</th></tr></thead>
             <tbody>${rows}</tbody>
           </table>
         </div>`
      : '<p class="overlay-meta">Be the first on this leaderboard!</p>'
    }

    ${rankNote}

    <button class="primary-btn" id="next-btn">
      ${isLast ? 'Play Again' : 'Next Level →'}
    </button>
  `;

  document.getElementById('next-btn').addEventListener('click', () => {
    hideOverlay();
    isLast ? loadLevel(0) : loadLevel(state.levelIndex + 1);
  });
}

function hideOverlay() {
  overlay.classList.add('hidden');
  overlayBox.innerHTML = '';
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
document.addEventListener('keydown', e => {
  // If the name input is focused, let it handle its own keys
  if (document.activeElement && document.activeElement.id === 'name-input') return;

  switch (e.key) {
    case 'ArrowUp':    case 'w': case 'W': move(-1,  0); break;
    case 'ArrowDown':  case 's': case 'S': move( 1,  0); break;
    case 'ArrowLeft':  case 'a': case 'A': move( 0, -1); break;
    case 'ArrowRight': case 'd': case 'D': move( 0,  1); break;
    case ' ':
      if (!overlay.classList.contains('hidden')) {
        // Click the primary action button if leaderboard is shown
        const btn = overlay.querySelector('.primary-btn');
        if (btn && !btn.disabled) btn.click();
      } else {
        resetLevel();
      }
      break;
    default: return;
  }
  e.preventDefault();
});

document.getElementById('restart-btn').addEventListener('click', resetLevel);

window.addEventListener('resize', () => { if (!isAnimating) render(); });

// ─────────────────────────────────────────────
//  BOOT  — fetch levels from server, then start
// ─────────────────────────────────────────────
async function fetchLevels() {
  try {
    const res    = await fetch('/api/levels');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const levels = await res.json(); // [{id, name, map, order_index}, ...]

    for (const level of levels) {
      const opt = solveLevel(level.map);
      if (opt === -1) {
        console.warn(`"${level.name}" is unsolvable — skipped.`);
        continue;
      }
      VALID_LEVELS.push(level.map);
      OPTIMAL_MOVES.push(opt);
      LEVEL_IDS.push(level.id);
    }

    if (VALID_LEVELS.length === 0) {
      document.getElementById('board').textContent = 'No playable levels found.';
      return;
    }

    loadLevel(0);
  } catch (err) {
    document.getElementById('board').textContent =
      `Failed to load levels: ${err.message}`;
  }
}

fetchLevels();
