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
  if (rows === 0) return -1;
  const cols = rawLevel[0].length;
  // A ragged map would let the player slide past the real edge.
  if (rawLevel.some(row => row.length !== cols)) return -1;

  const grid = rawLevel.map(row => row.split(''));

  let sr, sc, gr, gc;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 'S') { sr = r; sc = c; }
      if (grid[r][c] === 'G') { gr = r; gc = c; }
    }

  // Without this guard a map missing S or G throws inside the BFS
  // and one bad row blanks the whole level list.
  if (sr === undefined || gr === undefined) return -1;

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

// Returns the winning sequence of [dr, dc] steps, or null.
// Used by the debug hook so an automated run is deterministic.
function solvePath(rawLevel) {
  const rows = rawLevel.length;
  const cols = rawLevel[0].length;
  const grid = rawLevel.map(row => row.split(''));

  let sr, sc, gr, gc;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 'S') { sr = r; sc = c; }
      if (grid[r][c] === 'G') { gr = r; gc = c; }
    }
  if (sr === undefined || gr === undefined) return null;

  const key  = (r, c) => r * cols + c;
  const prev = new Map([[key(sr, sc), null]]);
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let queue  = [[sr, sc]];

  while (queue.length) {
    const next = [];
    for (const [r, c] of queue) {
      for (const [dr, dc] of DIRS) {
        const [nr, nc] = slideInGrid(grid, rows, cols, r, c, dr, dc);
        if (nr === r && nc === c) continue;
        const k = key(nr, nc);
        if (prev.has(k)) continue;
        prev.set(k, { from: key(r, c), step: [dr, dc] });
        if (nr === gr && nc === gc) {
          const path = [];
          let node = prev.get(k);
          let at   = k;
          while (node) { path.unshift(node.step); at = node.from; node = prev.get(at); }
          return path;
        }
        next.push([nr, nc]);
      }
    }
    queue = next;
  }
  return null;
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
//  LEVEL REGISTRY
//  levels.id is the one public identity. It is what
//  travels in a shared link, so two devices that open
//  the same link get the same maze.
// ─────────────────────────────────────────────
let LEVELS = [];              // { id, seq, rows, cols, opt, diff, diffClass } — no maps
const BY_ID  = new Map();     // id -> level (playable only)
const ALL_IDS = new Set();    // every id the server sent, playable or not
let VIEW   = [];              // ids, filter + sort applied (browse order only)
let STATS  = new Map();       // id -> { plays, best_time, best_moves, best_name, last_at }
let LIVE   = new Map();       // id -> presence count

const MAPS = new Map();       // id -> map, fetched on entry and kept
let activeDifficulty = null;  // null = All
let activeSort       = 'number';
let activeScreen     = 'browse';
let page             = 0;     // browse grid page
const PAGE_SIZE      = 120;   // 2762 cards at once is what broke the page
let navToken         = 0;     // bumped on every enterLevel; async callbacks compare against it

// ─────────────────────────────────────────────
//  STORAGE HELPERS
//  localStorage throws in iOS private mode and under
//  Lockdown, so every access is wrapped.
// ─────────────────────────────────────────────
function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

function personalBest(id) {
  const raw = lsGet(`slide:best:${id}`);
  const n   = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
const state = {
  levelId: null,       // server ID of the current level — the only identity
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
  started: false,      // false while the ready gate is up
  mapReady: false,     // false until this level's map has arrived
  navToken: 0,
  _pendingWin: false,
};

// Module-level animation flag
let isAnimating = false;

// ─────────────────────────────────────────────
//  TIMER
//  Starts when the player presses Start, not when the
//  page loads — two phones on two networks must not be
//  scored on their page-load time.
// ─────────────────────────────────────────────
let timerInterval = null;
let startTime     = null;

function startTimer() {
  if (timerInterval) return;
  startTime     = Date.now();
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
  startTime = null;
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

// SQLite writes completed_at as UTC with no zone marker.
// Without the appended 'Z' every fresh row reads hours old.
function formatAgo(raw) {
  if (!raw) return '';
  const t = Date.parse(String(raw).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return '';
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 45)    return 'just now';
  if (secs < 3600)  return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

function bestLine(id) {
  const s = STATS.get(id);
  if (!s || !s.plays) return 'Be the first';
  return `Best ${formatTime(s.best_time)} · ${s.best_name ?? '—'}`;
}

// ─────────────────────────────────────────────
//  DOM HANDLES
// ─────────────────────────────────────────────
const boardEl     = document.getElementById('board');
const levelLabel  = document.getElementById('level-label');
const moveCounter = document.getElementById('move-counter');
const gridEl      = document.getElementById('level-grid');
const overlay     = document.getElementById('overlay');
const overlayBox  = document.getElementById('overlay-box');
const noticeEl    = document.getElementById('browse-notice');
const emptyEl     = document.getElementById('browse-empty');

// ─────────────────────────────────────────────
//  ROUTING
//  A hash route needs no Express route, no nginx rule,
//  and survives a reload of a shared link.
// ─────────────────────────────────────────────
function baseUrl()   { return location.origin + location.pathname; }
function shareUrl(id) { return `${baseUrl()}#/level/${id}`; }

function route() {
  const m = /^#\/level\/(\d+)$/.exec(location.hash);
  if (m) { enterLevel(Number(m[1])); return; }
  goBrowse();
}

function showScreen(name) {
  activeScreen = name;
  document.getElementById('screen-browse').classList.toggle('hidden', name !== 'browse');
  document.getElementById('screen-play').classList.toggle('hidden', name !== 'play');

  if (name === 'browse') { stopPresence(); startBrowsePoll(); }
  else                   { stopBrowsePoll(); }
}

let pendingNotice    = null;
let pendingAutoStart = false;   // set by Next/Retry: skip the ready gate

function goBrowse(notice) {
  pendingNotice = notice ?? null;
  const cameFrom = state.levelId;
  stopPresence();
  resetTimer();
  hideOverlay();
  clearShareFallback();
  state.levelId = null;
  state.started = false;
  navToken++;
  state.navToken = navToken;

  // replaceState, not location.replace: it fires no hashchange (so this does
  // not route back through goBrowse and erase the notice) and it never
  // reloads the page when a shared link arrived with a tracking query.
  // A first visit with no level hash keeps its clean URL.
  if (/^#\/level\//.test(location.hash)) {
    try { history.replaceState(null, '', baseUrl() + '#/'); }
    catch { location.hash = '#/'; }
  }

  showScreen('browse');
  renderBrowser();
  // Come back to the page that holds the level just played, not to page 1
  // of 23.
  if (cameFrom !== null) {
    const p = pageContaining(cameFrom);
    if (p !== page) { page = p; renderBrowser(); }
  }
  refreshStats().then(renderBrowser).catch(() => {});

  if (pendingNotice) {
    noticeEl.textContent = pendingNotice;
    noticeEl.classList.remove('hidden');
  } else {
    noticeEl.textContent = '';
    noticeEl.classList.add('hidden');
  }
}

function enterCard(el) {
  // A real push, so Back returns to the grid.
  location.hash = `#/level/${el.dataset.id}`;
}

// ─────────────────────────────────────────────
//  BROWSE SCREEN
// ─────────────────────────────────────────────
function buildView() {
  const ids = LEVELS
    .filter(l => activeDifficulty === null || l.diff === activeDifficulty)
    .slice();

  if (activeSort === 'plays') {
    ids.sort((a, b) => ((STATS.get(b.id)?.plays ?? 0) - (STATS.get(a.id)?.plays ?? 0))
                    || (a.seq - b.seq));
  } else if (activeSort === 'best') {
    ids.sort((a, b) => {
      const ta = STATS.get(a.id)?.best_time ?? Infinity;
      const tb = STATS.get(b.id)?.best_time ?? Infinity;
      return (ta - tb) || (a.seq - b.seq);
    });
  } else if (activeSort === 'unplayed') {
    ids.sort((a, b) => ((personalBest(a.id) === null ? 0 : 1) - (personalBest(b.id) === null ? 0 : 1))
                    || (a.seq - b.seq));
  } else {
    ids.sort((a, b) => a.seq - b.seq);
  }

  VIEW = ids.map(l => l.id);
  return ids;
}

function statsText(id) {
  const s = STATS.get(id);
  return s && s.plays
    ? `best ${formatTime(s.best_time)} · ${s.plays} play${s.plays === 1 ? '' : 's'}`
    : '— unplayed';
}

function cardHtml(lvl) {
  const mine = personalBest(lvl.id);
  const live = LIVE.get(lvl.id) ?? 0;
  const stats = statsText(lvl.id);

  return `
    <article class="level-card${mine !== null ? ' played' : ''}" data-id="${lvl.id}" tabindex="0" title="Level #${lvl.id}">
      <div class="card-top">
        <span class="card-id">#${lvl.id}</span>
        <span class="card-diff ${lvl.diffClass}">${lvl.diff}</span>
      </div>
      <div class="card-meta">${lvl.cols}×${lvl.rows} · opt ${lvl.opt}</div>
      <div class="card-stats">${escapeHtml(stats)}</div>
      ${mine !== null ? `<div class="card-you">you ${formatTime(mine)}</div>` : ''}
      ${live > 0 ? `<div class="card-live"><span class="live-dot"></span>${live} here</div>` : ''}
      <button class="card-share" data-share="${lvl.id}" title="Copy link" aria-label="Copy link to level ${lvl.id}">link</button>
    </article>
  `;
}

function renderBrowser() {
  const levels = buildView();
  const pages  = Math.max(1, Math.ceil(levels.length / PAGE_SIZE));
  if (page >= pages) page = pages - 1;
  if (page < 0) page = 0;

  document.getElementById('browse-count').textContent =
    `${levels.length} level${levels.length === 1 ? '' : 's'}`;

  if (levels.length === 0) {
    gridEl.innerHTML = '';
    renderPager(0, 1, 0);
    emptyEl.textContent = activeDifficulty
      ? `No ${activeDifficulty} levels yet.`
      : 'No level matches.';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  const from = page * PAGE_SIZE;
  gridEl.innerHTML = levels.slice(from, from + PAGE_SIZE).map(cardHtml).join('');
  renderPager(page, pages, levels.length);
}

function renderPager(current, pages, total) {
  const el = document.getElementById('pager');
  if (!el) return;

  if (pages <= 1) { el.innerHTML = ''; el.classList.add('hidden'); return; }

  const from = current * PAGE_SIZE + 1;
  const to   = Math.min(total, (current + 1) * PAGE_SIZE);
  el.classList.remove('hidden');
  el.innerHTML = `
    <button class="ghost-btn" id="page-prev" ${current === 0 ? 'disabled' : ''}>&lsaquo; Prev</button>
    <span class="pager-state">${from}&ndash;${to} of ${total} &nbsp;·&nbsp; page ${current + 1} / ${pages}</span>
    <button class="ghost-btn" id="page-next" ${current >= pages - 1 ? 'disabled' : ''}>Next &rsaquo;</button>
  `;
  document.getElementById('page-prev').addEventListener('click', () => turnPage(-1));
  document.getElementById('page-next').addEventListener('click', () => turnPage(1));
}

function turnPage(delta) {
  page += delta;
  renderBrowser();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Land on the page that holds a level, so returning from one does not
// dump the player back at level 1 of 2762.
function pageContaining(id) {
  const pos = VIEW.indexOf(id);
  return pos === -1 ? page : Math.floor(pos / PAGE_SIZE);
}

function applyFilter(diff) {
  activeDifficulty = diff === 'All' ? null : diff;
  document.querySelectorAll('.diff-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.diff === (activeDifficulty ?? 'All')));
  lsSet('slide:filter', diff);
  page = 0;
  renderBrowser();
}

function setupFilterButtons() {
  const counts = { Easy: 0, Medium: 0, Hard: 0, Expert: 0 };
  LEVELS.forEach(l => { counts[l.diff] = (counts[l.diff] ?? 0) + 1; });

  document.querySelectorAll('.diff-btn').forEach(btn => {
    const diff = btn.dataset.diff;
    btn.textContent = diff === 'All'
      ? `All (${LEVELS.length})`
      : `${diff} (${counts[diff] ?? 0})`;
    btn.addEventListener('click', () => applyFilter(diff));
  });

  document.getElementById('sort-select').addEventListener('change', e => {
    activeSort = e.target.value;
    page = 0;
    renderBrowser();
  });
}

function jumpTo(value) {
  const raw = value.trim();
  if (!raw) return;

  if (/^#?\d+$/.test(raw)) {
    const id = Number(raw.replace('#', ''));
    if (BY_ID.has(id)) { location.hash = `#/level/${id}`; return; }
    pendingNotice = ALL_IDS.has(id)
      ? `Level #${id} has no solution — it cannot be played.`
      : `Level #${id} does not exist.`;
    noticeEl.textContent = pendingNotice;
    noticeEl.classList.remove('hidden');
    return;
  }

  pendingNotice = `"${raw}" is not a level number.`;
  noticeEl.textContent = pendingNotice;
  noticeEl.classList.remove('hidden');
}

function nextLevelId() {
  const pos = VIEW.indexOf(state.levelId);
  // A single-level view would hand back the level just finished.
  if (pos !== -1 && VIEW.length > 1) return VIEW[(pos + 1) % VIEW.length];

  // Direct link to a level outside the active filter: walk the full list.
  const ordered = LEVELS.slice().sort((a, b) => a.seq - b.seq);
  const i = ordered.findIndex(l => l.id === state.levelId);
  return ordered[(i + 1) % ordered.length].id;
}

// ─────────────────────────────────────────────
//  SHARING
//  Three tiers, because the deployment this feature is
//  for (two phones on a LAN over plain http) is not a
//  secure context and has no navigator.clipboard.
// ─────────────────────────────────────────────
function clearShareFallback() {
  document.querySelectorAll('.share-fallback').forEach(el => el.remove());
}

function showShareFallback(url, focus) {
  clearShareFallback();
  // The panel has to land somewhere the player can actually see.
  const host = !overlay.classList.contains('hidden') ? overlayBox
             : activeScreen === 'browse'             ? document.getElementById('share-slot-browse')
             :                                         document.getElementById('share-slot');
  if (!host) return;

  const box = document.createElement('div');
  box.className = 'share-fallback';
  box.innerHTML = `
    <input id="share-url" class="share-input" readonly value="${escapeHtml(url)}">
    <span class="share-hint">Copy this link</span>
  `;
  host.appendChild(box);

  // Focus only when the input is the ONLY way to copy. Taking focus stops
  // every key binding and scrolls a 65-card grid back to the top.
  if (focus) {
    const input = box.querySelector('#share-url');
    input.focus({ preventScroll: true });
    input.select();
  }
}

function flashButton(btn, text) {
  if (!btn) return;
  // Two quick taps used to capture "Copied ✓" as the label to restore,
  // leaving the button stuck on it for good.
  if (btn.dataset.flashTimer) clearTimeout(Number(btn.dataset.flashTimer));
  if (btn.dataset.label === undefined) btn.dataset.label = btn.textContent;
  btn.textContent = text;
  btn.dataset.flashTimer = String(setTimeout(() => {
    btn.textContent = btn.dataset.label;
    delete btn.dataset.flashTimer;
  }, 1500));
}

async function shareLevel(id, btn) {
  if (id == null) return;
  const url = shareUrl(id);

  // Show the link FIRST, always. Both the clipboard and the share-sheet API
  // are missing or permission-gated in the setup this feature exists for —
  // two phones on a LAN over plain http is not a secure context — and on
  // desktop navigator.share can sit pending with no sheet at all.
  showShareFallback(url, false);

  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  if (coarse && navigator.share) {
    try {
      await navigator.share({ title: `Slide #${id}`, url });
      return;
    } catch (err) {
      // The user dismissed the sheet — that is not a failure.
      if (err && err.name === 'AbortError') return;
    }
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      flashButton(btn, 'Copied ✓');
      return;
    } catch { /* fall through to the manual path */ }
  }

  // Nothing copied anything: the input is now the only way out, so it earns
  // the focus — and Escape gives it back.
  showShareFallback(url, true);
}

// ─────────────────────────────────────────────
//  LEVEL LOADING
// ─────────────────────────────────────────────
// The map for one level, fetched once and then kept.
async function loadMap(id) {
  if (MAPS.has(id)) return MAPS.get(id);
  const res = await fetch(`/api/levels/${id}`);
  if (!res.ok) return null;
  const data = await res.json();
  MAPS.set(id, data.map);
  if (data.name) { const l = BY_ID.get(id); if (l) l.name = data.name; }
  return data.map;
}

function buildGrid(map) {
  state.grid = [];
  state.rows = map.length;
  state.cols = map[0].length;
  for (let r = 0; r < state.rows; r++) {
    state.grid[r] = [];
    for (let c = 0; c < state.cols; c++) {
      const ch = map[r][c] ?? '.';
      state.grid[r][c] = ch;
      if (ch === 'S') { state.playerRow = r; state.playerCol = c; state.startRow = r; state.startCol = c; }
      if (ch === 'G') { state.goalRow   = r; state.goalCol   = c; }
    }
  }
}

async function enterLevel(id) {
  const lvl = BY_ID.get(id);
  if (!lvl) {
    goBrowse(ALL_IDS.has(id)
      ? `Level #${id} has no solution — it cannot be played.`
      : `Level #${id} does not exist.`);
    return;
  }

  pendingNotice = null;
  // Consume it here, so a later navigation never inherits it.
  const auto = pendingAutoStart;
  pendingAutoStart = false;

  const token = ++navToken;
  state.navToken    = token;
  state.levelId     = id;
  state.moves       = 0;
  state.timeMs      = 0;
  state.inputLocked = false;
  state._pendingWin = false;
  state.started     = false;
  state.mapReady    = false;
  isAnimating       = false;
  state.grid        = [];

  // Unconditionally, and before anything else: startTimer() returns early
  // while an interval survives, which would keep an old startTime and post
  // a wildly wrong time.
  resetTimer();
  clearShareFallback();

  state.rows = lvl.rows;
  state.cols = lvl.cols;

  document.getElementById('detail-dims').textContent    = `${lvl.cols}×${lvl.rows}`;
  document.getElementById('detail-optimal').textContent = `Optimal: ${lvl.opt}`;
  const diffEl = document.getElementById('detail-difficulty');
  diffEl.textContent = lvl.diff;
  diffEl.className   = lvl.diffClass;
  document.getElementById('detail-best').textContent = bestLine(id);

  showScreen('play');
  boardEl.innerHTML = '';
  boardEl.classList.add('concealed');
  // On an auto-start the gate would only flash, unless the map still has to
  // travel — then it is the "Loading…" feedback.
  if (!auto || !MAPS.has(id)) showReadyGate(lvl, token);
  startPresence(id);

  // The board is concealed until Start anyway, so fetching the map here
  // costs the player nothing. Start stays disabled until it lands.
  let map = null;
  try { map = await loadMap(id); } catch { /* handled below */ }
  if (token !== state.navToken) return;          // the player already moved on
  if (!map) { goBrowse(`Level #${id} could not be loaded.`); return; }

  buildGrid(map);
  render();
  boardEl.classList.add('concealed');
  state.mapReady = true;
  if (auto) startRun();
  else      markGateReady();
}

// ─────────────────────────────────────────────
//  RENDERING
// ─────────────────────────────────────────────
const TILE_GAP  = 2;   // must match the `gap` on #board in style.css
const TILE_CHROME = 8; // #board padding + border, both axes

function render() {
  // Budget each axis separately, and subtract the gaps and the board chrome.
  // Dividing the raw budget by the tile count overshoots by ~10%, which is
  // the difference between fitting an 18-column board on a phone and not.
  const widthBudget  = window.innerWidth  - 24;
  const heightBudget = window.innerHeight - 260;
  const fit = (budget, count) => Math.floor((budget - (count - 1) * TILE_GAP - TILE_CHROME) / count);
  // 14, not 24: at a 24px floor an 18-column board is 468px, wider than a
  // 390px phone. #board-wrapper scrolls as a second defence.
  const tileSize = Math.max(14, Math.min(fit(widthBudget, state.cols), fit(heightBudget, state.rows)));

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

  levelLabel.textContent  = `#${state.levelId}`;
  moveCounter.textContent = `Moves: ${state.moves}`;
}

// ─────────────────────────────────────────────
//  SLIDING ANIMATION
// ─────────────────────────────────────────────
function animatePlayer(fromRow, fromCol, toRow, toCol) {
  if (fromRow === toRow && fromCol === toCol) return;

  const token = state.navToken;
  isAnimating = true;

  // getComputedStyle on a hidden element yields an empty string -> NaN.
  const tileSize = parseInt(getComputedStyle(boardEl).getPropertyValue('--tile-size'), 10) || 0;
  if (!tileSize) { isAnimating = false; return; }

  const gap = 2;
  const dx  = (fromCol - toCol) * (tileSize + gap);
  const dy  = (fromRow - toRow) * (tileSize + gap);

  const playerEl = boardEl.querySelector('.tile.player');
  if (!playerEl) { isAnimating = false; return; }

  playerEl.style.transition = 'none';
  playerEl.style.transform  = `translate(${dx}px, ${dy}px)`;
  playerEl.getBoundingClientRect(); // force reflow

  playerEl.style.transition = 'transform 0.12s ease-out';
  playerEl.style.transform  = 'translate(0, 0)';

  function onDone() {
    playerEl.style.transition = '';
    playerEl.style.transform  = '';
    isAnimating = false;
    // The player already left this level — never fire a stale win.
    if (token !== state.navToken) { state._pendingWin = false; return; }
    if (state._pendingWin) { state._pendingWin = false; onLevelComplete(); }
  }

  playerEl.addEventListener('transitionend', onDone, { once: true });
  // Fallback if transitionend never fires (hidden tab, etc.)
  setTimeout(() => { if (isAnimating) onDone(); }, 180);
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

  const fromRow = state.playerRow, fromCol = state.playerCol;
  state.playerRow = r;
  state.playerCol = c;
  state.moves++;

  state._pendingWin = (r === state.goalRow && c === state.goalCol);

  render();
  animatePlayer(fromRow, fromCol, r, c);
}

// The first movement key both starts the run and performs the move.
function tryMove(dr, dc) {
  if (!state.started) startRun();
  move(dr, dc);
}

// ─────────────────────────────────────────────
//  READY GATE
//  The clock starts on Start, so page load and network
//  latency never land in a shared leaderboard time.
// ─────────────────────────────────────────────
function showReadyGate(lvl, token) {
  const live = LIVE.get(lvl.id) ?? 0;

  overlayBox.innerHTML = `
    <p class="overlay-title">Level #${lvl.id}</p>
    <p class="overlay-meta">${lvl.cols}×${lvl.rows} &nbsp;·&nbsp; <span class="${lvl.diffClass}">${lvl.diff}</span> &nbsp;·&nbsp; optimal ${lvl.opt}</p>
    <p class="overlay-meta" id="gate-best">${escapeHtml(bestLine(lvl.id))}</p>
    <p class="overlay-meta ${live > 1 ? '' : 'hidden'}" id="gate-live">${live} playing now</p>
    <p class="overlay-sub">${escapeHtml(lvl.name ?? `Level ${lvl.id}`)}</p>
    <button class="primary-btn" id="start-btn" ${state.mapReady ? '' : 'disabled'}>${state.mapReady ? 'Start' : 'Loading…'}</button>
    <p class="overlay-hint">Space &nbsp;·&nbsp; or just move</p>
  `;
  overlay.classList.remove('hidden');

  document.getElementById('start-btn').addEventListener('click', startRun);
  // The overlay covers the board, so the tap has to be caught on the overlay
  // itself — otherwise "or just move" does nothing on a phone.
  overlay.addEventListener('pointerdown', onGateTap);

  // Fresh numbers for the gate, dropped if the player already moved on.
  fetch(`/api/levels/${lvl.id}/leaderboard`)
    .then(res => {
      if (token !== state.navToken) return null;   // the player already moved on
      if (res.status === 404) { goBrowse(`Level #${lvl.id} does not exist.`); return null; }
      if (!res.ok) return null;
      return res.json();
    })
    .then(data => {
      if (!data || token !== state.navToken) return;
      mergeStats(lvl.id, data.stats, data.top[0]);
      const el = document.getElementById('gate-best');
      if (el) el.textContent = bestLine(lvl.id);
      document.getElementById('detail-best').textContent = bestLine(lvl.id);
    })
    .catch(() => {});
}

function markGateReady() {
  const btn = document.getElementById('start-btn');
  if (!btn) return;
  btn.disabled    = false;
  btn.textContent = 'Start';
  const sub = document.querySelector('.overlay-sub');
  const lvl = BY_ID.get(state.levelId);
  if (sub && lvl && lvl.name) sub.textContent = lvl.name;
}

function onGateTap() {
  if (!state.started) startRun();
}

function startRun() {
  if (state.started) return;
  if (!state.mapReady) return;   // the board is not built yet
  overlay.removeEventListener('pointerdown', onGateTap);
  boardEl.classList.remove('concealed');
  hideOverlay();
  clearShareFallback();
  state.started = true;
  resetTimer();
  startTimer();
}

// ─────────────────────────────────────────────
//  WIN FLOW  (name entry → leaderboard)
// ─────────────────────────────────────────────
function onLevelComplete() {
  state.inputLocked = true;
  stopTimer();
  state.timeMs = startTime ? Date.now() - startTime : 0;

  const savedName = lsGet('playerName') || '';
  const lvl       = BY_ID.get(state.levelId);

  if (savedName) {
    overlayBox.innerHTML = `
      <p class="overlay-title">Level #${state.levelId} complete!</p>
      <p class="overlay-meta">
        <strong>${formatTime(state.timeMs)}</strong>
        &nbsp;·&nbsp;
        <strong>${state.moves}</strong> moves
        &nbsp;·&nbsp;
        Optimal: ${lvl ? lvl.opt : '—'}
      </p>
      <p class="overlay-meta">Submitting…</p>
    `;
    overlay.classList.remove('hidden');
    submitCompletion(savedName);
  } else {
    showNameEntry();
  }
}

function showNameEntry() {
  const lvl       = BY_ID.get(state.levelId);
  const savedName = lsGet('playerName') || '';

  overlayBox.innerHTML = `
    <p class="overlay-title">Level #${state.levelId} complete!</p>
    <p class="overlay-meta">
      <strong>${formatTime(state.timeMs)}</strong>
      &nbsp;·&nbsp;
      <strong>${state.moves}</strong> moves
      &nbsp;·&nbsp;
      Optimal: ${lvl ? lvl.opt : '—'}
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

  const input = document.getElementById('name-input');
  const btn   = document.getElementById('name-submit');

  input.focus();
  input.select();

  const submit = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    lsSet('playerName', name);
    btn.disabled    = true;
    btn.textContent = '...';
    submitCompletion(name);
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

async function submitCompletion(playerName) {
  const levelId = state.levelId;
  // Without a deadline a hung request leaves "Submitting…" on screen with no
  // button to press — and on a phone there is no keyboard to escape with.
  const ctl   = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 10_000) : null;
  try {
    const res = await fetch('/api/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  ctl ? ctl.signal : undefined,
      body: JSON.stringify({
        levelId,
        playerName,
        timeMs: state.timeMs,
        moves:  state.moves,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const prev = personalBest(levelId);
    if (prev === null || state.timeMs < prev) lsSet(`slide:best:${levelId}`, String(state.timeMs));
    mergeStats(levelId, data.stats, data.top[0]);

    showLeaderboard(data);
  } catch {
    overlayBox.innerHTML = `
      <p class="overlay-title">Level #${levelId} complete!</p>
      <p class="overlay-error">Could not reach the server. Score not saved.</p>
      ${actionsHtml()}
    `;
    wireActions();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function actionsHtml() {
  // Next is the ONLY .primary-btn: the Space handler clicks the first one it
  // finds, so one press after a win carries the player onward.
  return `
    <div class="overlay-actions">
      <button class="primary-btn" id="next-btn">Next #${nextLevelId()} &rsaquo;</button>
      <button class="ghost-btn"   id="retry-btn">Retry</button>
      <button class="ghost-btn"   id="share-win-btn">Share</button>
      <button class="ghost-btn"   id="browse-btn">All levels</button>
    </div>
  `;
}

function wireActions() {
  const id = state.levelId;
  document.getElementById('retry-btn').addEventListener('click', () => {
    hideOverlay();
    pendingAutoStart = true;
    enterLevel(id);
  });
  document.getElementById('share-win-btn').addEventListener('click', e => shareLevel(id, e.currentTarget));
  document.getElementById('next-btn').addEventListener('click', () => {
    // Replace rather than push, so Back never walks a chain of levels.
    pendingAutoStart = true;
    const next = nextLevelId();
    try { history.replaceState(null, '', shareUrl(next)); }
    catch { /* URL stays put; the level still loads */ }
    route();
  });
  document.getElementById('browse-btn').addEventListener('click', () => goBrowse());
}

function showLeaderboard({ completionId, rank, top, stats }) {
  const rows = top.map((entry, i) => {
    const isMe = entry.id === completionId;
    return `
      <tr class="${isMe ? 'lb-me' : ''}">
        <td>${i + 1}</td>
        <td>${escapeHtml(entry.player_name)}</td>
        <td>${formatTime(entry.time_ms)}</td>
        <td>${entry.moves}</td>
        <td>${escapeHtml(formatAgo(entry.completed_at))}</td>
      </tr>
    `;
  }).join('');

  // getRank counts strictly faster rows, so two identical times both get
  // rank 1. Only the row that actually sits on top leads.
  let verdict = '';
  if (top.length > 0) {
    const leadTime = top[0].time_ms;
    if (rank === 1 && top[0].id === completionId) {
      verdict = `<p class="verdict lead">NEW BEST — you lead this level</p>`;
    } else if (state.timeMs === leadTime) {
      verdict = `<p class="verdict">Tied for the lead</p>`;
    } else {
      verdict = `<p class="verdict">+${((state.timeMs - leadTime) / 1000).toFixed(1)}s off the lead</p>`;
    }
  }

  let rankNote = '';
  if (rank > 10 && top.length > 0) {
    const last = top[top.length - 1];
    rankNote = `<p class="rank-note">Your rank: <strong>#${rank}</strong> — ${formatTime(state.timeMs)} · ${state.moves} moves
      <br>${((state.timeMs - last.time_ms) / 1000).toFixed(1)}s behind #${top.length} ${escapeHtml(last.player_name)}</p>`;
  }

  const hasStats = stats && stats.total > 0;

  overlayBox.innerHTML = `
    <p class="overlay-title">Level #${state.levelId} · Leaderboard</p>

    ${verdict}

    <div class="lb-stats">
      <span>Best <strong>${hasStats ? formatTime(stats.best_time) : '—'}</strong></span>
      <span>Avg <strong>${hasStats ? formatTime(stats.avg_time) : '—'}</strong></span>
      <span><strong>${stats ? stats.total : 0}</strong> play${stats && stats.total !== 1 ? 's' : ''}</span>
      <span>Avg moves <strong>${hasStats ? Number(stats.avg_moves).toFixed(1) : '—'}</strong></span>
    </div>

    ${top.length > 0
      ? `<div class="lb-scroll">
           <table class="leaderboard">
             <thead><tr><th>#</th><th>Name</th><th>Time</th><th>Moves</th><th>When</th></tr></thead>
             <tbody>${rows}</tbody>
           </table>
         </div>`
      : '<p class="overlay-meta">Be the first on this leaderboard!</p>'
    }

    ${rankNote}

    ${actionsHtml()}
  `;

  wireActions();
}

function hideOverlay() {
  overlay.classList.add('hidden');
  overlayBox.innerHTML = '';
}

// ─────────────────────────────────────────────
//  RESET
//  Restores player to start and clears move count.
//  The timer keeps running — it started when the player
//  pressed Start, which is the fair moment to score from.
// ─────────────────────────────────────────────
function resetLevel() {
  if (!state.started) return;   // the ready gate is up, nothing to reset
  // After a win the timer is stopped but startTime still points at the first
  // run. Replaying from here would post that stale span as the new time.
  if (state.inputLocked) return;

  state.moves       = 0;
  state.inputLocked = false;
  state._pendingWin = false;
  isAnimating       = false;

  state.playerRow = state.startRow;
  state.playerCol = state.startCol;

  hideOverlay();
  render();
}

// ─────────────────────────────────────────────
//  STATS
// ─────────────────────────────────────────────
async function refreshStats() {
  try {
    const res = await fetch('/api/levels/stats');
    if (!res.ok) return;
    const rows = await res.json();
    STATS = new Map(rows.map(r => [r.level_id, r]));
  } catch { /* offline: keep whatever we have */ }
}

// Folds the stats POST /api/completions already returns into the local
// cache, so the browse card is fresh without a second request.
function mergeStats(id, stats, leader) {
  if (!stats || !stats.total) return;
  STATS.set(id, {
    level_id:   id,
    plays:      stats.total,
    best_time:  stats.best_time,
    best_moves: stats.best_moves,
    best_name:  leader ? leader.player_name : (STATS.get(id)?.best_name ?? null),
    last_at:    STATS.get(id)?.last_at ?? null,
  });
}

// ─────────────────────────────────────────────
//  PRESENCE
//  One number that makes "we are on this level together"
//  true instead of merely asserted.
// ─────────────────────────────────────────────
let fallbackSid   = null;
let presenceTimer = null;
let browseTimer   = null;

function sessionId() {
  const make = () => (crypto.randomUUID ? crypto.randomUUID()
                                        : Math.random().toString(36).slice(2) + Date.now().toString(36))
                      .replace(/[^A-Za-z0-9_-]/g, '');
  try {
    let sid = sessionStorage.getItem('slide:sid');
    if (!sid) { sid = make(); sessionStorage.setItem('slide:sid', sid); }
    return sid;
  } catch {
    if (!fallbackSid) fallbackSid = make();
    return fallbackSid;
  }
}

async function beat(levelId) {
  try {
    const res = await fetch('/api/presence', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levelId, sessionId: sessionId(), playerName: lsGet('playerName') || '' }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (levelId !== state.levelId) return;

    LIVE.set(levelId, data.count);
    const el = document.getElementById('detail-live');
    if (!el) return;
    if (data.count > 1) {
      el.textContent = `${data.count} playing now`;
      el.title       = data.names.map(n => String(n)).join(', ');
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
    const gate = document.getElementById('gate-live');
    if (gate) {
      gate.textContent = `${data.count} playing now`;
      gate.classList.toggle('hidden', data.count < 2);
    }
  } catch { /* presence is a nicety, never an error the player sees */ }
}

function clearPresenceTimer() {
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
}

function startPresence(id) {
  // Only clear the timer — never deregister here. The heartbeat is keyed by
  // sessionId, so it overwrites the old level by itself, and a parallel
  // deregister can land after it and delete the entry it just created.
  clearPresenceTimer();
  beat(id);
  presenceTimer = setInterval(() => {
    if (document.hidden) return;
    beat(id);
  }, 10_000);
}

function stopPresence() {
  clearPresenceTimer();
  deregister();
}

function deregister() {
  const body = JSON.stringify({ levelId: null, sessionId: sessionId() });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/presence', new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch { /* fall through */ }
  fetch('/api/presence', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
  }).catch(() => {});
}

async function pollBrowsePresence() {
  try {
    const [res] = await Promise.all([fetch('/api/presence'), refreshStats()]);
    if (!res.ok) return;
    const counts = await res.json();
    LIVE = new Map(Object.entries(counts).map(([k, v]) => [Number(k), v]));
    if (activeScreen !== 'browse') return;

    // Patch in place — a full re-render would drop the scroll position.
    gridEl.querySelectorAll('.level-card').forEach(card => {
      const id   = Number(card.dataset.id);
      const live = LIVE.get(id) ?? 0;

      // Someone else finishing this level while you watch is the whole point.
      const statsEl = card.querySelector('.card-stats');
      const fresh   = statsText(id);
      if (statsEl && statsEl.textContent !== fresh) statsEl.textContent = fresh;

      let el = card.querySelector('.card-live');
      if (live > 0) {
        if (!el) {
          el = document.createElement('div');
          el.className = 'card-live';
          card.insertBefore(el, card.querySelector('.card-share'));
        }
        el.innerHTML = `<span class="live-dot"></span>${live} here`;
      } else if (el) {
        el.remove();
      }
    });
  } catch { /* ignore */ }
}

function startBrowsePoll() {
  stopBrowsePoll();
  pollBrowsePresence();
  browseTimer = setInterval(() => {
    if (document.hidden) return;
    pollBrowsePresence();
  }, 15_000);
}

function stopBrowsePoll() {
  if (browseTimer) { clearInterval(browseTimer); browseTimer = null; }
}

// ─────────────────────────────────────────────
//  INPUT HANDLING
// ─────────────────────────────────────────────
const TEXT_INPUT_IDS = ['name-input', 'jump-input', 'share-url', 'sort-select'];

document.addEventListener('keydown', e => {
  const active = document.activeElement;
  // Escape releases the share input, which otherwise holds every key binding.
  if (active && active.id === 'share-url' && e.key === 'Escape') {
    active.blur();
    clearShareFallback();
    e.preventDefault();
    return;
  }
  if (active && TEXT_INPUT_IDS.includes(active.id)) return;

  if (activeScreen !== 'play') {
    // Browse: let the arrows scroll the grid.
    if (e.key === 'Enter' && active && active.classList.contains('level-card')) {
      enterCard(active);
      e.preventDefault();
    }
    return;
  }

  switch (e.key) {
    case 'ArrowUp':    case 'w': case 'W': tryMove(-1,  0); break;
    case 'ArrowDown':  case 's': case 'S': tryMove( 1,  0); break;
    case 'ArrowLeft':  case 'a': case 'A': tryMove( 0, -1); break;
    case 'ArrowRight': case 'd': case 'D': tryMove( 0,  1); break;
    case 'r': case 'R':
      // On the win overlay, R means "play it again", which is a fresh run.
      if (state.inputLocked && !overlay.classList.contains('hidden')) {
        pendingAutoStart = true;
        enterLevel(state.levelId);
      }
      else resetLevel();
      break;
    case 'Escape': goBrowse(); break;
    case ' ':
    case 'Enter':
      // Space no longer resets — wiping a run mid-race was the worst
      // possible binding for this feature.
      if (!overlay.classList.contains('hidden')) {
        if (!state.started) { startRun(); break; }
        const btn = overlay.querySelector('.primary-btn');
        if (btn && !btn.disabled) btn.click();
      }
      break;
    default: return;
  }
  e.preventDefault();
});

// ── Touch: swipe on the board ────────────────
let touchStart = null;

boardEl.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

boardEl.addEventListener('touchend', e => {
  if (!touchStart) return;
  const t  = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;

  const THRESHOLD = 24;
  if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;

  e.preventDefault();   // the board only — #level-grid must still scroll
  if (Math.abs(dx) > Math.abs(dy)) tryMove(0, dx > 0 ? 1 : -1);
  else                             tryMove(dy > 0 ? 1 : -1, 0);
}, { passive: false });

// ── D-pad, shown on coarse pointers ──────────
const dpad = document.getElementById('dpad');
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
  dpad.classList.remove('hidden');
}
dpad.addEventListener('click', e => {
  const btn = e.target.closest('.dpad-btn');
  if (!btn) return;
  tryMove(Number(btn.dataset.dr), Number(btn.dataset.dc));
});

// ── Buttons ──────────────────────────────────
document.getElementById('restart-btn').addEventListener('click', resetLevel);
document.getElementById('back-btn').addEventListener('click', () => goBrowse());
document.getElementById('share-btn').addEventListener('click', e => shareLevel(state.levelId, e.currentTarget));

document.getElementById('btn-random').addEventListener('click', () => {
  if (VIEW.length === 0) return;
  location.hash = `#/level/${VIEW[Math.floor(Math.random() * VIEW.length)]}`;
});

const jumpInput = document.getElementById('jump-input');
jumpInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { jumpTo(jumpInput.value); jumpInput.value = ''; }
});

// One delegated listener for 68 cards, not 68 listeners.
gridEl.addEventListener('click', e => {
  const shareBtn = e.target.closest('.card-share');
  if (shareBtn) {
    e.stopPropagation();
    shareLevel(Number(shareBtn.dataset.share), shareBtn);
    return;
  }
  const card = e.target.closest('.level-card');
  if (card) enterCard(card);
});

window.addEventListener('resize', () => {
  if (activeScreen === 'play' && !isAnimating) render();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (activeScreen === 'play' && state.levelId !== null) beat(state.levelId);
  else if (activeScreen === 'browse') pollBrowsePresence();
});

window.addEventListener('pagehide', () => { deregister(); });

// ─────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────
function showBootError(msg) {
  noticeEl.textContent = msg;
  noticeEl.classList.remove('hidden');
}

async function boot() {
  let payload;
  try {
    const res = await fetch('/api/levels');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
    lsSet('slide:levels', JSON.stringify(payload));
  } catch (err) {
    const cached = lsGet('slide:levels');
    if (!cached) { showBootError(`Failed to load levels: ${err.message}`); setTimeout(boot, 3000); return; }
    try { payload = JSON.parse(cached); } catch { showBootError('Failed to load levels.'); setTimeout(boot, 3000); return; }
  }

  // The server sends sizes and move counts, never the maps. It has already
  // dropped the unsolvable levels; their ids come back separately so a
  // shared link to one can still say why it will not open.
  const levels = Array.isArray(payload) ? payload : (payload.levels ?? []);
  const dead   = Array.isArray(payload) ? [] : (payload.unplayable ?? []);

  LEVELS = [];
  BY_ID.clear();
  ALL_IDS.clear();
  dead.forEach(id => ALL_IDS.add(id));

  for (const level of levels) {
    ALL_IDS.add(level.id);
    const { label, cssClass } = getDifficulty(level.opt, level.rows, level.cols);
    const o = { ...level, seq: LEVELS.length, diff: label, diffClass: cssClass };
    LEVELS.push(o);
    BY_ID.set(o.id, o);
  }

  if (LEVELS.length === 0) {
    showBootError('Levels are still being generated…');
    setTimeout(boot, 3000);
    return;
  }

  setupFilterButtons();

  const saved = lsGet('slide:filter');
  if (saved) {
    activeDifficulty = saved === 'All' ? null : saved;
    document.querySelectorAll('.diff-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.diff === (activeDifficulty ?? 'All')));
  }

  renderBrowser();
  await refreshStats();
  renderBrowser();

  window.addEventListener('hashchange', route);
  route();
}

// ─────────────────────────────────────────────
//  DEBUG HOOK
//  Makes an automated run deterministic. Not a security
//  boundary — the leaderboard is already open to curl.
// ─────────────────────────────────────────────
async function autoSolve() {
  const map = MAPS.get(state.levelId);
  if (!map) return false;
  if (!state.started) startRun();
  if (!state.started) return false;

  const path = solvePath(map);
  if (!path) return false;

  for (const [dr, dc] of path) {
    move(dr, dc);
    await new Promise(r => setTimeout(r, 200));
  }
  return true;
}

window.__slide = {
  state, BY_ID, MAPS, loadMap,
  enterLevel, move, tryMove, solveLevel, solvePath, autoSolve,
  startRun, goBrowse, shareUrl, resetLevel,
  // Getters, because these three are reassigned, not mutated.
  get levels() { return LEVELS; },
  get stats()  { return STATS; },
  get live()   { return LIVE; },
  get view()   { return VIEW; },
};

boot();
