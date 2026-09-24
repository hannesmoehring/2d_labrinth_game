"""Ranking accepted levels: which to keep, and in what order to list them."""
from __future__ import annotations

from math import log2


def difficulty(level: dict) -> int:
    """Orders the level list. Mirrors difficulty() in public/solver.js,
    which turns the same number into the Easy/Medium/Hard/Expert label."""
    rows, cols = len(level["map"]), len(level["map"][0])
    return level["opt"] + (rows * cols) // 25 + 2 * level["blocks"]


def interest(level: dict) -> float:
    """Prefers levels whose solution weaves the pieces together.

    Counts how often the solution switches piece and how many block moves
    it takes, plus the size of the space a solver has to search. Used only
    to choose among levels that already passed their tier's bar.
    """
    moves = level["solution"].split()
    pieces = [m[0] for m in moves]
    switches = sum(a != b for a, b in zip(pieces, pieces[1:]))
    block_moves = sum(p != "1" for p in pieces)
    return switches + 0.5 * block_moves + 2 * level["essential"] + log2(level["states"] + 1)
