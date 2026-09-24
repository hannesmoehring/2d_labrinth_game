// The rules of movement and the solver live in solver.js (window.Slide),
// which the server loads too.

// ─────────────────────────────────────────────
//  DIFFICULTY
// ─────────────────────────────────────────────
// levelgen/scoring.py orders the level pack by the same score; the
// thresholds split the generated pack into rough quarters.
function getDifficulty(optimalMoves, rows, cols, blocks = 0) {
  const score = optimalMoves + Math.floor((rows * cols) / 25) + 2 * blocks;
  if (score <= 10) return { label: 'Easy',   cssClass: 'diff-easy'   };
  if (score <= 19) return { label: 'Medium',  cssClass: 'diff-medium' };
  if (score <= 29) return { label: 'Hard',    cssClass: 'diff-hard'   };
  return                   { label: 'Expert', cssClass: 'diff-expert' };
}

function blocksText(n) {
  return `${n} block${n === 1 ? '' : 's'}`;
}

// ─────────────────────────────────────────────
//  LEVEL REGISTRY
//  levels.id is the one public identity. It is what
//  travels in a shared link, so two devices that open
//  the same link get the same maze.
// ─────────────────────────────────────────────
let LEVELS = [];              // { id, seq, rows, cols, opt, blocks, diff, diffClass } — no maps
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
let topWindow        = '30d';  // leaderboard time window
let topToken         = 0;      // drops a slow leaderboard fetch the player left behind
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
  level: null,         // Slide.parseLevel(map): walls, goal, start cells
  rows: 0,
  cols: 0,
  pieces: [],          // [{ id, cell }]; pieces[0] is the player (1), then blocks 2-4
  selected: 1,         // id of the piece the arrows move
  moves: 0,            // every move of every piece counts
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
  if (location.hash === '#/top') { goTop(); return; }
  goBrowse();
}

function showScreen(name) {
  activeScreen = name;
  document.getElementById('screen-browse').classList.toggle('hidden', name !== 'browse');
  document.getElementById('screen-play').classList.toggle('hidden',   name !== 'play');
  document.getElementById('screen-top').classList.toggle('hidden',    name !== 'top');

  if (name === 'browse') { stopPresence(); startBrowsePoll(); }
  else                   { stopBrowsePoll(); }
  if (name === 'top') stopPresence();
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
  if (/^#\/(level\/|top$)/.test(location.hash)) {
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

// ─────────────────────────────────────────────
//  LEADERBOARD SCREEN
//  The window scopes activity — levels, runs, times and
//  who appears at all. Records (★) are not scoped: a
//  record is the fastest time a level has ever seen, so
//  it reads the same under every window.
// ─────────────────────────────────────────────
function goTop() {
  stopPresence();
  resetTimer();
  hideOverlay();
  clearShareFallback();
  state.levelId = null;
  state.started = false;
  navToken++;
  state.navToken = navToken;

  if (location.hash !== '#/top') {
    try { history.replaceState(null, '', baseUrl() + '#/top'); } catch { /* keep the URL */ }
  }

  showScreen('top');
  document.querySelectorAll('.win-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.window === topWindow));
  loadTop();
}

async function loadTop() {
  const token = ++topToken;
  const table = document.getElementById('top-table');
  table.innerHTML = '<p class="overlay-meta">Loading…</p>';

  let data = null;
  try {
    const res = await fetch(`/api/leaderboard?window=${encodeURIComponent(topWindow)}`);
    if (res.ok) data = await res.json();
  } catch { /* handled below */ }

  if (token !== topToken || activeScreen !== 'top') return;
  if (!data) {
    table.innerHTML = '<p class="overlay-error">Could not reach the server.</p>';
    document.getElementById('top-podium').innerHTML = '';
    document.getElementById('top-totals').innerHTML = '';
    return;
  }
  renderTop(data);
}

function renderTop({ players, totals }) {
  const me      = (lsGet('playerName') || '').trim();
  const podium  = document.getElementById('top-podium');
  const table   = document.getElementById('top-table');
  const empty   = document.getElementById('top-empty');
  const legend  = document.getElementById('top-legend');

  document.getElementById('top-totals').innerHTML = `
    <span><strong>${totals.players ?? 0}</strong> player${totals.players === 1 ? '' : 's'}</span>
    <span><strong>${totals.runs ?? 0}</strong> run${totals.runs === 1 ? '' : 's'}</span>
    <span><strong>${totals.levels ?? 0}</strong> level${totals.levels === 1 ? '' : 's'} played</span>
    <span>fastest <strong>${formatTime(totals.best_time)}</strong></span>
  `;

  if (!players.length) {
    podium.innerHTML = '';
    table.innerHTML  = '';
    empty.classList.remove('hidden');
    legend.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  legend.classList.remove('hidden');

  // Podium: second, first, third — so the winner stands in the middle.
  const order = [1, 0, 2];
  podium.innerHTML = order
    .filter(i => players[i])
    .map(i => {
      const p = players[i];
      const isMe = me && p.player_name === me;
      return `
        <article class="podium p${i + 1}${isMe ? ' me' : ''}">
          <span class="podium-rank">${['FIRST', 'SECOND', 'THIRD'][i]}</span>
          <span class="podium-name">${escapeHtml(p.player_name)}</span>
          <span class="podium-crowns">${p.crowns}</span>
          <span class="podium-crowns-label">&#9733; RECORDS</span>
          <span class="podium-meta">${p.levels} level${p.levels === 1 ? '' : 's'} · ${p.runs} run${p.runs === 1 ? '' : 's'}</span>
          <span class="podium-meta">best ${formatTime(p.best_time)}</span>
        </article>
      `;
    }).join('');

  const rows = players.map((p, i) => {
    const isMe = me && p.player_name === me;
    return `
      <tr class="${isMe ? 'me ' : ''}r${i + 1}">
        <td>${i + 1}</td>
        <td>${escapeHtml(p.player_name)}</td>
        <td class="rank-crowns">${p.crowns}</td>
        <td>${p.levels}</td>
        <td>${p.runs}</td>
        <td>${formatTime(p.best_time)}</td>
        <td>${formatTime(p.avg_time)}</td>
        <td>${escapeHtml(formatAgo(p.last_at))}</td>
      </tr>
    `;
  }).join('');

  table.innerHTML = `
    <table class="ranking">
      <thead>
        <tr>
          <th>#</th><th>Player</th>
          <th title="Levels where you hold the fastest time of all time">&#9733;</th>
          <th>Levels</th><th>Runs</th><th>Best</th><th>Avg</th><th>Last</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
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
      <div class="card-meta">${lvl.cols}×${lvl.rows} · opt ${lvl.opt}${lvl.blocks
        ? ` · <span class="card-blocks" title="${blocksText(lvl.blocks)} to move">&#9632;${lvl.blocks}</span>` : ''}</div>
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

// False when the map does not parse; the server never sends such a map.
function buildBoard(map) {
  const level = Slide.parseLevel(map);
  if (!level) return false;
  state.level    = level;
  state.rows     = level.rows;
  state.cols     = level.cols;
  state.pieces   = level.pieces.map(p => ({ ...p }));
  state.selected = 1;
  return true;
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
  state.level       = null;
  state.pieces      = [];
  state.selected    = 1;

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
  const blocksEl = document.getElementById('detail-blocks');
  blocksEl.textContent = blocksText(lvl.blocks);
  blocksEl.classList.toggle('hidden', !lvl.blocks);
  document.getElementById('hint-pieces').classList.toggle('hidden', !lvl.blocks);
  renderPieceBar();

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
  if (!map || !buildBoard(map)) { goBrowse(`Level #${id} could not be loaded.`); return; }

  render();
  renderPieceBar();
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
  if (!state.level) return;   // the map has not arrived yet
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

  const { walls, goal } = state.level;
  const occupant = new Map(state.pieces.map(p => [p.cell, p.id]));
  // Numbers and the selection ring only mean something when there is a choice.
  const labelled = state.pieces.length > 1;

  for (let cell = 0; cell < state.rows * state.cols; cell++) {
    const tile = document.createElement('div');
    tile.classList.add('tile', walls[cell] ? 'wall' : 'floor');
    if (cell === goal) tile.classList.add('goal');
    const id = occupant.get(cell);
    if (id !== undefined) {
      tile.classList.add('piece', id === 1 ? 'player' : 'block');
      tile.dataset.piece = id;
      if (labelled) {
        tile.textContent = id;
        if (id === state.selected) tile.classList.add('selected');
      }
    }
    boardEl.appendChild(tile);
  }

  levelLabel.textContent  = `#${state.levelId}`;
  moveCounter.textContent = `Moves: ${state.moves}`;
}

// ─────────────────────────────────────────────
//  PIECE SELECTION
//  1 is the player, 2-4 the blocks. Keys 1-4, a tap on
//  a piece or on the bar below the board pick which one
//  the arrows, swipes and d-pad move.
// ─────────────────────────────────────────────
function renderPieceBar() {
  const bar = document.getElementById('piece-bar');
  if (state.pieces.length < 2) {
    bar.innerHTML = '';
    bar.classList.add('hidden');
    return;
  }
  bar.innerHTML = state.pieces.map(({ id }) => `
    <button class="piece-btn ${id === 1 ? 'player' : 'block'}" data-piece="${id}"
            aria-label="${id === 1 ? 'Player' : `Block ${id}`} (key ${id})">${id}</button>
  `).join('');
  bar.classList.remove('hidden');
  markSelected();
}

// Toggles classes in place: a re-render mid-slide would cut the animation.
function markSelected() {
  boardEl.querySelectorAll('.tile.piece').forEach(el =>
    el.classList.toggle('selected', state.pieces.length > 1 && Number(el.dataset.piece) === state.selected));
  document.querySelectorAll('#piece-bar .piece-btn').forEach(btn => {
    const on = Number(btn.dataset.piece) === state.selected;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

function selectPiece(id) {
  if (!state.pieces.some(p => p.id === id)) return;
  state.selected = id;
  markSelected();
}

// ─────────────────────────────────────────────
//  SLIDING ANIMATION
// ─────────────────────────────────────────────
function animatePiece(id, from, to) {
  const token = state.navToken;
  isAnimating = true;
  let finished = false;

  // Idempotent, so the fallback timer of an earlier slide can never end a
  // later one early or fire its win.
  function onDone(el) {
    if (finished) return;
    finished = true;
    if (el) { el.style.transition = ''; el.style.transform = ''; }
    isAnimating = false;
    // The player already left this level — never fire a stale win.
    if (token !== state.navToken) { state._pendingWin = false; return; }
    if (state._pendingWin) { state._pendingWin = false; onLevelComplete(); }
  }

  // getComputedStyle on a hidden element yields an empty string -> NaN.
  const tileSize = parseInt(getComputedStyle(boardEl).getPropertyValue('--tile-size'), 10) || 0;
  const el = boardEl.querySelector(`.tile[data-piece="${id}"]`);
  if (!tileSize || !el) { onDone(null); return; }

  const cols = state.cols;
  const dx   = (from % cols - to % cols) * (tileSize + TILE_GAP);
  const dy   = (Math.floor(from / cols) - Math.floor(to / cols)) * (tileSize + TILE_GAP);

  el.style.transition = 'none';
  el.style.transform  = `translate(${dx}px, ${dy}px)`;
  el.getBoundingClientRect(); // force reflow

  el.style.transition = 'transform 0.12s ease-out';
  el.style.transform  = 'translate(0, 0)';

  el.addEventListener('transitionend', () => onDone(el), { once: true });
  // Fallback if transitionend never fires (hidden tab, etc.)
  setTimeout(() => onDone(el), 180);
}

// ─────────────────────────────────────────────
//  MOVEMENT
//  Every piece slides until a wall or another piece
//  stops it (Slide.slide). Only the player resting on
//  the goal wins; a block may park on it.
// ─────────────────────────────────────────────
function movePiece(id, dr, dc) {
  if (state.inputLocked || isAnimating || !state.level) return;
  const index = state.pieces.findIndex(p => p.id === id);
  if (index === -1) return;

  const from = state.pieces[index].cell;
  const to   = Slide.slide(state.level, state.pieces.map(p => p.cell), index, dr, dc);
  if (to === from) return;

  state.pieces[index].cell = to;
  state.moves++;
  state._pendingWin = id === 1 && to === state.level.goal;

  render();
  animatePiece(id, from, to);
}

function move(dr, dc) {
  movePiece(state.selected, dr, dc);
}

// The first movement key both starts the run and performs the move.
function tryMove(dr, dc, id = state.selected) {
  if (!state.started) startRun();
  selectPiece(id);
  movePiece(id, dr, dc);
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
    ${lvl.blocks ? `
      <p class="gate-blocks">${blocksText(lvl.blocks)} slide just like you do &mdash; park them where you need a wall.
        <br>Keys 1&ndash;${lvl.blocks + 1} or tap a piece to steer it. Every move counts.</p>` : ''}
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
//  Puts every piece back and clears the move count.
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

  state.pieces   = state.level.pieces.map(p => ({ ...p }));
  state.selected = 1;

  hideOverlay();
  render();
  markSelected();
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

  if (activeScreen === 'top') {
    if (e.key === 'Escape') { goBrowse(); e.preventDefault(); }
    const pick = { '1': '24h', '2': '7d', '3': '30d', '4': 'all' }[e.key];
    if (pick) {
      const btn = document.querySelector(`.win-btn[data-window="${pick}"]`);
      if (btn) { btn.click(); e.preventDefault(); }
    }
    return;
  }

  if (activeScreen !== 'play') {
    // Browse: let the arrows scroll the grid.
    if (e.key === 'Enter' && active && active.classList.contains('level-card')) {
      enterCard(active);
      e.preventDefault();
    }
    return;
  }

  switch (e.key) {
    case '1': case '2': case '3': case '4': selectPiece(Number(e.key)); break;
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
// A swipe that starts on a piece moves that piece; anywhere else it moves
// the selected one. A tap falls through to the click handler below.
let touchStart = null;

boardEl.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  const pieceEl = e.target.closest('.tile[data-piece]');
  touchStart = {
    x: e.touches[0].clientX,
    y: e.touches[0].clientY,
    piece: pieceEl ? Number(pieceEl.dataset.piece) : state.selected,
  };
}, { passive: true });

boardEl.addEventListener('touchend', e => {
  if (!touchStart) return;
  const t  = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const piece = touchStart.piece;
  touchStart = null;

  const THRESHOLD = 24;
  if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;

  e.preventDefault();   // the board only — #level-grid must still scroll
  if (Math.abs(dx) > Math.abs(dy)) tryMove(0, dx > 0 ? 1 : -1, piece);
  else                             tryMove(dy > 0 ? 1 : -1, 0, piece);
}, { passive: false });

boardEl.addEventListener('click', e => {
  const pieceEl = e.target.closest('.tile[data-piece]');
  if (pieceEl) selectPiece(Number(pieceEl.dataset.piece));
});

document.getElementById('piece-bar').addEventListener('click', e => {
  const btn = e.target.closest('.piece-btn');
  if (btn) selectPiece(Number(btn.dataset.piece));
});

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

document.getElementById('btn-top').addEventListener('click', () => { location.hash = '#/top'; });
document.getElementById('top-back').addEventListener('click', () => goBrowse());

document.querySelectorAll('.win-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    topWindow = btn.dataset.window;
    lsSet('slide:topwindow', topWindow);
    document.querySelectorAll('.win-btn').forEach(b =>
      b.classList.toggle('active', b === btn));
    loadTop();
  });
});

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
    const blocks = level.blocks ?? 0;   // absent in a list cached before blocks existed
    const { label, cssClass } = getDifficulty(level.opt, level.rows, level.cols, blocks);
    const o = { ...level, blocks, seq: LEVELS.length, diff: label, diffClass: cssClass };
    LEVELS.push(o);
    BY_ID.set(o.id, o);
  }

  if (LEVELS.length === 0) {
    showBootError('Levels are still being generated…');
    setTimeout(boot, 3000);
    return;
  }

  setupFilterButtons();

  const savedWindow = lsGet('slide:topwindow');
  if (savedWindow && ['24h', '7d', '30d', 'all'].includes(savedWindow)) topWindow = savedWindow;

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
// Solves from the start position, so it resets a run already under way.
// Slide.solve searches every block arrangement in the browser: instant on
// small boards, seconds on the largest three-block ones.
async function autoSolve() {
  const map = MAPS.get(state.levelId);
  if (!map) return false;
  if (!state.started) startRun();
  if (!state.started) return false;
  if (state.moves > 0) resetLevel();

  const result = Slide.solve(map);
  if (!result) return false;

  for (const step of result.moves) {
    const [dr, dc] = Slide.DIRS[step[1]];
    tryMove(dr, dc, Number(step[0]));
    await new Promise(r => setTimeout(r, 200));
  }
  return true;
}

window.__slide = {
  state, BY_ID, MAPS, loadMap, Slide,
  enterLevel, move, movePiece, selectPiece, tryMove, autoSolve,
  startRun, goBrowse, goTop, loadTop, shareUrl, resetLevel,
  // Getters, because these three are reassigned, not mutated.
  get levels() { return LEVELS; },
  get stats()  { return STATS; },
  get live()   { return LIVE; },
  get view()   { return VIEW; },
};

boot();
