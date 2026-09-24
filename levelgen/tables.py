"""Precomputed lookup tables the vectorised solver runs on."""
from __future__ import annotations

from math import comb

import numpy as np

from .board import DIR_DELTAS


def wall_stops(rows: int, cols: int, walls: np.ndarray) -> np.ndarray:
    """``stops[d, cell]``: where a lone piece at ``cell`` stops moving in ``d``.

    Only walls and the map edge count here; the solver adds the pieces.
    """
    stops = np.tile(np.arange(rows * cols), (4, 1))
    for d, (dr, dc) in enumerate(DIR_DELTAS):
        for cell in np.flatnonzero(~walls):
            r, c = divmod(int(cell), cols)
            while True:
                nr, nc = r + dr, c + dc
                if not (0 <= nr < rows and 0 <= nc < cols) or walls[nr * cols + nc]:
                    break
                r, c = nr, nc
            stops[d, cell] = r * cols + c
    return stops


class StateIndex:
    """Dense, collision-free numbering of (player, sorted blocks) states.

    A state is ranked as ``player * C(F, k) + sum_i C(block_i, i + 1)`` over
    floor indices (the combinatorial number system), so a flat bool array of
    ``F * C(F, k)`` entries can serve as the visited set. Treating the blocks
    as a sorted set is sound because blocks are physically identical; it
    shrinks the space up to 3! = 6-fold.
    """

    def __init__(self, walls: np.ndarray, k: int):
        floor = np.flatnonzero(~walls)
        self.k = k
        self.floor_of = np.full(walls.size, -1, dtype=np.int64)
        self.floor_of[floor] = np.arange(floor.size)
        f = floor.size
        self.block_space = comb(f, k)
        self.size = f * self.block_space
        # binom[i][x] = C(x, i) for the i-th sorted block (1-based)
        self.binom = [np.array([comb(x, i) for x in range(f + 1)], dtype=np.int64)
                      for i in range(k + 1)]

    def rank(self, positions: np.ndarray) -> np.ndarray:
        """``positions``: (m, 1 + k) cells, blocks already sorted ascending."""
        fl = self.floor_of[positions]
        key = fl[:, 0] * self.block_space
        for i in range(1, self.k + 1):
            key = key + self.binom[i][fl[:, i]]
        return key
