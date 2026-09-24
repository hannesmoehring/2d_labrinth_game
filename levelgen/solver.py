"""Breadth-first search over the joint state of the player and the blocks.

The search is vectorised: each BFS layer is a numpy array of states, and one
(piece, direction) pair is applied to the whole layer at once. That keeps
multi-million-state levels at a few seconds instead of minutes.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .board import Board
from .tables import StateIndex, wall_stops

CHUNK = 1 << 18   # frontier states expanded per batch; bounds peak memory


@dataclass
class Solution:
    opt: int | None                  # None: unsolvable (within the limits)
    moves: list[tuple[int, int]] = field(default_factory=list)   # (from cell, dir)
    states: int = 0                  # distinct states reached
    exhausted: bool = True           # False: a depth/state limit cut the search short


def solve(board: Board, movable: tuple[int, ...] | None = None,
          max_depth: int = 200, max_states: int = 60_000_000) -> Solution:
    """Fewest moves that bring the player to rest on the goal.

    ``movable`` lists the block indices allowed to move; the rest are frozen
    in place and act as walls. ``None`` means every block moves, ``()`` is
    the player alone.
    """
    if movable is None:
        movable = tuple(range(len(board.blocks)))
    if board.start == board.goal:
        return Solution(opt=0, states=1)

    walls = board.walls.copy()
    for i, cell in enumerate(board.blocks):
        if i not in movable:
            walls[cell] = True
    stops = wall_stops(board.rows, board.cols, walls)
    index = StateIndex(walls, len(movable))
    col_of = np.arange(board.size) % board.cols

    frontier = np.array([[board.start, *sorted(board.blocks[i] for i in movable)]],
                        dtype=np.int64)
    visited = np.zeros(index.size, dtype=bool)
    visited[index.rank(frontier)] = True
    seen = 1
    # layers[d] = (parent index into layer d-1, move code) for the states of layer d
    layers: list[tuple[np.ndarray, np.ndarray]] = []

    for depth in range(1, max_depth + 1):
        found, nxt, parents, codes = _expand(board, frontier, stops, col_of, index, visited)
        if found is not None:
            parent, code = found
            return Solution(opt=depth, moves=_backtrack(layers, parent, code), states=seen)
        if nxt.shape[0] == 0:
            return Solution(opt=None, states=seen)
        seen += nxt.shape[0]
        if seen > max_states:
            return Solution(opt=None, states=seen, exhausted=False)
        layers.append((parents, codes))
        frontier = nxt
    return Solution(opt=None, states=seen, exhausted=False)


def _expand(board, frontier, stops, col_of, index, visited):
    """One BFS layer. Returns (win, states, parents, move codes)."""
    k1 = frontier.shape[1]
    out_states, out_parents, out_codes = [], [], []

    for lo in range(0, frontier.shape[0], CHUNK):
        chunk = frontier[lo:lo + CHUNK]
        rows = np.arange(lo, lo + chunk.shape[0])
        for j in range(k1):
            pos = chunk[:, j]
            for d in range(4):
                s = board.step(d)
                stop = stops[d][pos]
                for o in range(k1):
                    if o == j:
                        continue
                    q = chunk[:, o]
                    on_ray = (q > pos) & (q <= stop) if s > 0 else (q < pos) & (q >= stop)
                    if abs(s) != 1:
                        on_ray &= col_of[q] == col_of[pos]
                    stop = np.where(on_ray, q - s, stop)
                moved = np.flatnonzero(stop != pos)
                if moved.size == 0:
                    continue
                new_pos = stop[moved]
                if j == 0:
                    wins = np.flatnonzero(new_pos == board.goal)
                    if wins.size:
                        w = moved[wins[0]]
                        return (int(rows[w]), int(pos[w]) * 4 + d), None, None, None
                states = chunk[moved].copy()
                states[:, j] = new_pos
                if j > 0 and k1 > 2:
                    states[:, 1:].sort(axis=1)
                keys = index.rank(states)
                fresh = ~visited[keys]
                if not fresh.any():
                    continue
                keys, states = keys[fresh], states[fresh]
                keys, first = np.unique(keys, return_index=True)
                visited[keys] = True
                out_states.append(states[first])
                out_parents.append(rows[moved[fresh][first]])
                out_codes.append((pos[moved[fresh][first]] * 4 + d))

    if not out_states:
        return None, np.empty((0, k1), dtype=np.int64), None, None
    return (None, np.concatenate(out_states),
            np.concatenate(out_parents), np.concatenate(out_codes))


def _backtrack(layers, parent: int, code: int) -> list[tuple[int, int]]:
    codes = [code]
    for parents, layer_codes in reversed(layers):
        codes.append(int(layer_codes[parent]))
        parent = int(parents[parent])
    return [divmod(c, 4) for c in reversed(codes)]
