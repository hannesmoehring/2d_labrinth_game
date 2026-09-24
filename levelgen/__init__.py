"""Offline level generator for the sliding puzzle.

A level has the player (piece 1, ``S`` in a map) and up to three movable
blocks (pieces 2-4, written ``2``/``3``/``4``). Every piece slides until a wall
or another piece stops it. Only the player stopping on ``G`` wins, and every
move of any piece counts.

The rules here must match ``public/solver.js`` exactly; ``import-levels.js``
replays each stored solution with the JS physics to catch any drift.
"""
