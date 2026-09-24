"""Random boards for a tier; the filter in generator.py decides which survive."""
from __future__ import annotations

import random

import numpy as np

from .board import Board, floor_region
from .tiers import Tier

OPEN_GOAL_SHARE = 0.5   # of tiers that allow it, goals placed with no wall beside them


def random_walls(tier: Tier, rng: random.Random) -> np.ndarray:
    """Border walls, random interior walls, and some grown into 1x2 pillars.

    The pillars give the pieces more surfaces to stop against than pure noise.
    """
    rows, cols = tier.rows, tier.cols
    density = rng.uniform(*tier.density)
    grid = np.zeros((rows, cols), dtype=bool)
    grid[[0, -1], :] = True
    grid[:, [0, -1]] = True
    for r in range(1, rows - 1):
        for c in range(1, cols - 1):
            grid[r, c] = rng.random() < density
    for r in range(1, rows - 1):
        for c in range(1, cols - 1):
            if grid[r, c] and rng.random() < 0.4:
                dr, dc = rng.choice(((-1, 0), (1, 0), (0, -1), (0, 1)))
                if 0 < r + dr < rows - 1 and 0 < c + dc < cols - 1:
                    grid[r + dr, c + dc] = True
    return grid.reshape(-1)


def _is_open(walls: np.ndarray, cols: int, cell: int) -> bool:
    """No wall on any side, so only a piece can stop the player here."""
    return not any(walls[cell + s] for s in (-cols, cols, -1, 1))


def _keep_largest_region(walls: np.ndarray, cols: int) -> np.ndarray:
    """Wall in all floor outside the largest orthogonally connected region.

    A pocket meeting the rest only at a corner is a separate compartment:
    a block placed there could never touch the player. With one region left,
    every piece and the goal share it.
    """
    best = np.zeros_like(walls)
    unseen = ~walls
    while unseen.any():
        region = floor_region(walls, cols, int(np.argmax(unseen)))
        unseen &= ~region
        if region.sum() > best.sum():
            best = region
    return ~best


def random_board(tier: Tier, rng: random.Random) -> Board | None:
    cols = tier.cols
    walls = _keep_largest_region(random_walls(tier, rng), cols)
    floor = [int(c) for c in np.flatnonzero(~walls)]
    if len(floor) < tier.blocks + 2 + 8:
        return None

    # An open goal can never be reached alone, so it suits only some tiers.
    open_cells = [c for c in floor if _is_open(walls, cols, c)]
    if tier.blocks and tier.alone is not True and open_cells and rng.random() < OPEN_GOAL_SHARE:
        goal = rng.choice(open_cells)
    else:
        goal = rng.choice(floor)

    gr, gc = divmod(goal, cols)
    min_dist = int(min(tier.rows, tier.cols) * 0.4)
    far = [c for c in floor if abs(c // cols - gr) + abs(c % cols - gc) >= min_dist]
    start = rng.choice(far or [c for c in floor if c != goal])

    rest = [c for c in floor if c not in (start, goal)]
    blocks = tuple(rng.sample(rest, tier.blocks))
    return Board(tier.rows, cols, walls, start, goal, blocks)
