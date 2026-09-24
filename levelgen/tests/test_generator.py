"""What the generator promises about every level it accepts."""
import pytest

from levelgen.analysis import replay
from levelgen.board import Board
from levelgen.generator import search
from levelgen.tiers import TIERS


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
