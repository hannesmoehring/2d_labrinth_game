"""Level maps: parsing, serialising, and the scalar slide physics."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

WALL, FLOOR, START, GOAL = "#", ".", "S", "G"
BLOCK_LABELS = ("2", "3", "4")

# Index order is part of the move encoding (cell * 4 + direction).
DIR_NAMES = ("U", "D", "L", "R")
DIR_DELTAS = ((-1, 0), (1, 0), (0, -1), (0, 1))


@dataclass(frozen=True, eq=False)
class Board:
    """A level. Cells are linear indices ``r * cols + c``."""

    rows: int
    cols: int
    walls: np.ndarray          # bool, shape (rows * cols,)
    start: int
    goal: int
    blocks: tuple[int, ...]    # cells of the blocks labelled 2, 3, 4 in that order

    @property
    def size(self) -> int:
        return self.rows * self.cols

    def step(self, d: int) -> int:
        dr, dc = DIR_DELTAS[d]
        return dr * self.cols + dc

    def pieces(self) -> list[int]:
        """Start cells, player first, then blocks in label order."""
        return [self.start, *self.blocks]

    @classmethod
    def parse(cls, rows: list[str]) -> Board:
        if not rows or any(len(r) != len(rows[0]) for r in rows):
            raise ValueError("map must be a non-empty rectangle")
        n_rows, n_cols = len(rows), len(rows[0])
        walls = np.zeros(n_rows * n_cols, dtype=bool)
        start = goal = None
        labelled: dict[str, int] = {}
        for r, line in enumerate(rows):
            for c, ch in enumerate(line):
                cell = r * n_cols + c
                if ch == WALL:
                    walls[cell] = True
                elif ch == START:
                    if start is not None:
                        raise ValueError("more than one S")
                    start = cell
                elif ch == GOAL:
                    if goal is not None:
                        raise ValueError("more than one G")
                    goal = cell
                elif ch in BLOCK_LABELS:
                    if ch in labelled:
                        raise ValueError(f"block {ch} appears twice")
                    labelled[ch] = cell
                elif ch != FLOOR:
                    raise ValueError(f"unknown map character {ch!r}")
        if start is None or goal is None:
            raise ValueError("map needs both S and G")
        blocks = tuple(labelled[k] for k in sorted(labelled))
        return cls(n_rows, n_cols, walls, start, goal, blocks)

    def to_rows(self) -> list[str]:
        chars = np.where(self.walls, WALL, FLOOR).astype("<U1")
        chars[self.goal] = GOAL
        chars[self.start] = START
        for label, cell in zip(BLOCK_LABELS, self.blocks):
            chars[cell] = label
        grid = chars.reshape(self.rows, self.cols)
        return ["".join(row) for row in grid]


def slide(board: Board, positions: list[int], index: int, d: int) -> int:
    """Cell where piece ``index`` stops when pushed in direction ``d``.

    ``positions`` holds every piece's current cell; the other pieces block
    like walls. Returns the piece's own cell when it cannot move at all.
    """
    dr, dc = DIR_DELTAS[d]
    others = set(positions)
    others.discard(positions[index])
    r, c = divmod(positions[index], board.cols)
    while True:
        nr, nc = r + dr, c + dc
        if not (0 <= nr < board.rows and 0 <= nc < board.cols):
            break
        cell = nr * board.cols + nc
        if board.walls[cell] or cell in others:
            break
        r, c = nr, nc
    return r * board.cols + c
