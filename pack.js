// ─────────────────────────────────────────────
//  LEVEL PACK
//  levels/levels.json is written offline by the Python
//  generator (python -m levelgen generate). Every level
//  carries its optimal move count and one optimal
//  solution; replaying that solution with the browser's
//  own physics proves the two implementations agree.
// ─────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const { parseLevel, replay } = require('./public/solver');

const DEFAULT_PACK = path.join(__dirname, 'levels', 'levels.json');

function readPack(file = DEFAULT_PACK) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.levels)) {
    throw new Error(`${file}: not a version 1 level pack`);
  }
  return data.levels;
}

// null when the level is sound, else what is wrong with it.
function problemWith(level) {
  if (!parseLevel(level.map)) return 'map does not parse';
  if (!Number.isInteger(level.opt) || level.opt < 1) return `bad opt ${level.opt}`;
  const moves = String(level.solution ?? '').trim().split(/\s+/).filter(Boolean);
  if (moves.length !== level.opt) return `solution has ${moves.length} moves, opt is ${level.opt}`;
  if (!replay(level.map, moves)) return 'solution does not reach the goal under the game\'s rules';
  return null;
}

module.exports = { DEFAULT_PACK, readPack, problemWith };
