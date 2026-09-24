#!/usr/bin/env node
// ─────────────────────────────────────────────
//  LEVEL IMPORTER
//
//  Usage:
//    node import-levels.js                      # append levels/levels.json
//    node import-levels.js other-pack.json      # append another pack
//    node import-levels.js --replace            # drop ALL levels and runs first
//    node import-levels.js --dry-run            # verify the pack, write nothing
//
//  Levels come from the offline Python generator
//  (pixi run generate-levels). Every level is checked
//  before anything is written: its stored solution must
//  win under public/solver.js in exactly `opt` moves.
//  Maps already in the database are skipped.
// ─────────────────────────────────────────────
'use strict';

const path = require('path');
const { DEFAULT_PACK, readPack, problemWith } = require('./pack');

const args    = process.argv.slice(2);
const REPLACE = args.includes('--replace');
const DRY_RUN = args.includes('--dry-run');
const file    = args.find(a => !a.startsWith('--')) ?? DEFAULT_PACK;
const unknown = args.filter(a => a.startsWith('--') && !['--replace', '--dry-run'].includes(a));

if (unknown.length) {
  console.error(`Unknown option ${unknown[0]}.\nUsage: node import-levels.js [pack.json] [--replace] [--dry-run]`);
  process.exit(1);
}

let levels;
try {
  levels = readPack(file);
} catch (err) {
  console.error(`Cannot read ${file}: ${err.message}`);
  process.exit(1);
}

const bad = levels
  .map((lvl, i) => [i + 1, problemWith(lvl)])
  .filter(([, problem]) => problem);
if (bad.length) {
  for (const [n, problem] of bad.slice(0, 20)) console.error(`  level ${n}: ${problem}`);
  console.error(`${bad.length} of ${levels.length} levels failed verification — nothing imported.`);
  process.exit(1);
}
console.log(`Verified ${levels.length} levels from ${path.relative(process.cwd(), file) || file}.`);
if (DRY_RUN) process.exit(0);

// Required only now, so a dry run never creates a database file.
const db = require('./db');

if (REPLACE) {
  console.log(`Replacing ${db.countLevels()} levels and ${db.countCompletions()} recorded runs.`);
}
const added = db.importLevels(levels, { replace: REPLACE });
console.log(`Imported ${added} new levels (${levels.length - added} already present); ` +
            `the database now has ${db.countLevels()}.`);
