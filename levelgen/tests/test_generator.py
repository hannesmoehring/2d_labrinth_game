"""What the generator promises about every level it accepts."""
import random

import pytest

from levelgen.analysis import replay
from levelgen.board import Board, floor_region
from levelgen.candidates import random_board
from levelgen.check import check_level
from levelgen.generator import search
from levelgen.tiers import TIERS


def is_one_compartment(board: Board) -> bool:
    return bool((floor_region(board.walls, board.cols, board.start) | board.walls).all())


@pytest.mark.parametrize("tier_index", range(len(TIERS)))
def test_candidates_are_one_compartment(tier_index):
    rng = random.Random(tier_index)
    boards = [random_board(TIERS[tier_index], rng) for _ in range(300)]
    assert all(is_one_compartment(b) for b in boards if b is not None)


def test_check_flags_a_block_in_a_corner_pocket():
    # Block 3's pocket meets the rest only diagonally, at (6,2)-(7,1); the
    # level solves with blocks 2 and 4 alone, so the solver cannot catch it.
    level = {"opt": 14, "solo": None, "blocks": 3, "essential": 2,
             "solution": "4U 1D 4L 1U 1R 2D 2L 2U 2L 2D 4R 1L 2U 1R", "map": [
                 "#############",
                 "##..3.#####.#",
                 "#...######..#",
                 "##.#######..#",
                 "##.########.#",
                 "#..#######..#",
                 "##..#####2#.#",
                 "#.####......#",
                 "#S.....#..#.#",
                 "#....G....###",
                 "#.#..4..#.###",
                 "###....#....#",
                 "#############",
             ]}
    assert "compartment" in check_level(level)


@pytest.mark.parametrize("tier_index", [0, 1, 3, 4])
def test_accepted_levels_keep_the_tier_promises(tier_index):
    tier = TIERS[tier_index]
    _, found = search(tier_index, seed=7, seconds=3, want=5, max_states=10**6)
    assert found, "the tier should yield levels within seconds"
    for level in found:
        board = Board.parse(level["map"])
        lo, hi = tier.opt
        assert lo <= level["opt"] <= hi
        assert len(board.blocks) == tier.blocks
        assert is_one_compartment(board)
        assert replay(board, level["solution"])
        if tier.blocks:
            # The blocks must matter: ignoring them is impossible or slower.
            assert level["essential"] >= max(1, tier.min_essential)
            assert level["solo"] is None or level["solo"] - level["opt"] >= tier.min_gain
            if tier.alone is not None:
                assert (level["solo"] is not None) == tier.alone
            assert any(move[0] != "1" for move in level["solution"].split())
        else:
            assert level["solo"] == level["opt"]
