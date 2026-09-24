"""What a solved level asks of the player, beyond its optimal move count."""
from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

from .board import DIR_NAMES, Board, slide
from .solver import Solution, solve


@dataclass
class Analysis:
    opt: int
    solo: int | None      # optimum with every block frozen; None = impossible alone
    essential: int        # fewest distinct blocks an optimal solution must move
    solution: str         # e.g. "2L 1U 1R", the piece label then the direction
    states: int           # joint states the full search reached


def analyse(board: Board, max_opt: int, max_states: int) -> Analysis | None:
    """None when the level is unsolvable or needs more than ``max_opt`` moves."""
    full = solve(board, max_depth=max_opt, max_states=max_states)
    if full.opt is None:
        return None
    solo = solve(board, movable=(), max_depth=200).opt
    return Analysis(
        opt=full.opt,
        solo=solo,
        essential=essential_blocks(board, full.opt, solo),
        solution=" ".join(label_moves(board, full.moves)),
        states=full.states,
    )


def essential_blocks(board: Board, opt: int, solo: int | None) -> int:
    """Size of the smallest set of movable blocks that still reaches ``opt``."""
    if solo == opt:
        return 0
    k = len(board.blocks)
    for size in range(1, k):
        for subset in combinations(range(k), size):
            if solve(board, movable=subset, max_depth=opt).opt == opt:
                return size
    return k


def label_moves(board: Board, moves: list[tuple[int, int]]) -> list[str]:
    """Turn solver moves (from cell, dir) into labelled ones like ``"2L"``.

    The solver treats blocks as interchangeable, so the label is recovered
    by replaying the moves from the level's start.
    """
    positions = board.pieces()
    labelled = []
    for cell, d in moves:
        index = positions.index(cell)
        positions[index] = slide(board, positions, index, d)
        labelled.append(f"{index + 1}{DIR_NAMES[d]}")
    return labelled


def replay(board: Board, solution: str) -> bool:
    """True when ``solution`` is legal and ends with the player on the goal."""
    positions = board.pieces()
    moves = solution.split()
    for i, move in enumerate(moves):
        index, d = int(move[0]) - 1, DIR_NAMES.index(move[1])
        if not 0 <= index < len(positions):
            return False
        stop = slide(board, positions, index, d)
        if stop == positions[index]:
            return False
        positions[index] = stop
        if index == 0 and stop == board.goal:
            return i == len(moves) - 1
    return False


__all__ = ["Analysis", "Solution", "analyse", "essential_blocks", "label_moves", "replay"]
