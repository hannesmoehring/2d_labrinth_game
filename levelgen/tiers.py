"""Level tiers: what each band of the level list is made of."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Tier:
    rows: int
    cols: int
    blocks: int                      # movable blocks besides the player
    density: tuple[float, float]     # interior wall share
    opt: tuple[int, int]             # accepted optimal move counts, inclusive
    min_essential: int = 0           # blocks every optimal solution must move
    min_gain: int = 2                # if solvable alone: moves the blocks must save
    # True: the player can finish alone, the blocks only make it faster.
    # False: the player cannot finish without moving a block. None: either.
    alone: bool | None = None

    @property
    def label(self) -> str:
        alone = {True: " alone", False: " needs", None: ""}[self.alone]
        return f"{self.rows}x{self.cols} b{self.blocks}{alone}"


# Small boards teach the slide; blocks arrive one at a time, first as
# shortcuts, then as the only way in. The largest boards need two or three
# blocks moved.
TIERS: list[Tier] = [
    Tier( 7,  7, 0, (0.18, 0.32), ( 2,  7)),
    Tier( 7,  9, 1, (0.18, 0.32), ( 3,  8), min_essential=1, alone=False),
    Tier( 9,  9, 0, (0.22, 0.36), ( 4, 11)),
    Tier( 9,  9, 1, (0.20, 0.34), ( 4, 10), min_essential=1, alone=True),
    Tier( 9, 11, 2, (0.20, 0.36), ( 5, 12), min_essential=1),
    Tier(11, 11, 1, (0.24, 0.38), ( 6, 14), min_essential=1, alone=True, min_gain=3),
    Tier(11, 11, 2, (0.24, 0.38), ( 6, 14), min_essential=2),
    Tier(11, 13, 2, (0.25, 0.40), ( 7, 16), min_essential=2),
    Tier(13, 13, 3, (0.26, 0.42), ( 8, 18), min_essential=2),
    Tier(13, 16, 3, (0.28, 0.44), ( 9, 20), min_essential=2),
    Tier(15, 15, 3, (0.30, 0.45), (10, 22), min_essential=2),
    Tier(15, 18, 3, (0.30, 0.46), (10, 24), min_essential=3),
]
