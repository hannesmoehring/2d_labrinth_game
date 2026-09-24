"""Candidate filter and the per-process search loop.

A level with blocks is only kept when the blocks matter: every optimal
solution moves at least ``tier.min_essential`` of them (and at least one),
and a player who ignores them either cannot finish at all or needs
``tier.min_gain`` more moves than the optimum.
"""
from __future__ import annotations

import random
import time

from .analysis import essential_blocks, label_moves
from .board import Board
from .candidates import random_board
from .solver import solve
from .tiers import TIERS, Tier


def evaluate(board: Board, tier: Tier, max_states: int) -> dict | None:
    """The level's record when it passes the tier's bar, else None.

    Ordered cheapest check first: the player-only search is tiny, and it
    caps how deep the joint search has to look.
    """
    lo, hi = tier.opt
    solo = solve(board, movable=(), max_depth=hi + 40)

    if not board.blocks:
        if solo.opt is None or not lo <= solo.opt <= hi:
            return None
        return _record(board, solo.opt, solo.opt, 0, solo.moves, solo.states)

    if tier.alone is not None and tier.alone != (solo.opt is not None):
        return None
    if solo.opt is not None:
        hi = min(hi, solo.opt - tier.min_gain)
        if hi < lo:
            return None
    full = solve(board, max_depth=hi, max_states=max_states)
    if full.opt is None or full.opt < lo:
        return None
    essential = essential_blocks(board, full.opt, solo.opt)
    if essential < max(1, tier.min_essential):
        return None
    return _record(board, full.opt, solo.opt, essential, full.moves, full.states)


def _record(board, opt, solo, essential, moves, states) -> dict:
    return {
        "map": board.to_rows(),
        "opt": opt,
        "solo": solo,
        "blocks": len(board.blocks),
        "essential": essential,
        "solution": " ".join(label_moves(board, moves)),
        "states": states,
    }


def search(tier_index: int, seed: int, seconds: float, want: int,
           max_states: int) -> tuple[int, list[dict]]:
    """Worker entry point: try random boards for ``seconds`` or ``want`` finds.

    Returns (candidates tried, levels accepted).
    """
    tier = TIERS[tier_index]
    rng = random.Random(seed)
    deadline = time.monotonic() + seconds
    tried, found = 0, []
    while time.monotonic() < deadline and len(found) < want:
        board = random_board(tier, rng)
        tried += 1
        if board is None:
            continue
        level = evaluate(board, tier, max_states)
        if level is not None:
            found.append({**level, "tier": tier_index})
    return tried, found
