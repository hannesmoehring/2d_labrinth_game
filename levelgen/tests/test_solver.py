"""The vectorised solver against hand-checked maps and a plain reference BFS."""
from collections import deque
import random

import numpy as np
import pytest

from levelgen.analysis import analyse, replay
from levelgen.board import Board, slide
from levelgen.solver import solve


def reference_solve(board: Board) -> int | None:
    """Textbook BFS over labelled pieces, one state at a time."""
    start = tuple(board.pieces())
    seen, queue = {start}, deque([(start, 0)])
    while queue:
        state, dist = queue.popleft()
        for index in range(len(state)):
            for d in range(4):
                stop = slide(board, list(state), index, d)
                if stop == state[index]:
                    continue
                if index == 0 and stop == board.goal:
                    return dist + 1
                nxt = state[:index] + (stop,) + state[index + 1:]
                if nxt not in seen:
                    seen.add(nxt)
                    queue.append((nxt, dist + 1))
    return None


def random_board(rng: random.Random, rows: int, cols: int, k: int) -> Board | None:
    lines = [["#" if r in (0, rows - 1) or c in (0, cols - 1) or rng.random() < 0.25 else "."
              for c in range(cols)] for r in range(rows)]
    floor = [(r, c) for r in range(rows) for c in range(cols) if lines[r][c] == "."]
    if len(floor) < k + 2:
        return None
    picks = rng.sample(floor, k + 2)
    for (r, c), ch in zip(picks, ["S", "G", "2", "3", "4"][:k + 2]):
        lines[r][c] = ch
    return Board.parse(["".join(line) for line in lines])


def test_player_alone_stops_on_walls():
    board = Board.parse([
        "#####",
        "#S..#",
        "#..G#",
        "#####",
    ])
    assert solve(board).opt == 2


def test_block_is_needed_as_a_stopper():
    # The only way into column 3 is to stop against block 2 once it has
    # dropped onto row 4.
    board = Board.parse([
        "#######",
        "#G..#S#",
        "#.#.#.#",
        "###.2.#",
        "#.....#",
        "#######",
    ])
    assert solve(board, movable=()).opt is None
    result = analyse(board, max_opt=20, max_states=10**6)
    assert result is not None and result.solo is None and result.essential == 1
    assert result.solution == "1D 1L 2D 1R 1U 1L"
    assert replay(board, result.solution)
    assert result.opt == reference_solve(board) == 6


def test_replay_rejects_wrong_solutions():
    board = Board.parse(["#####", "#S..#", "#..G#", "#####"])
    assert replay(board, "1R 1D")
    assert not replay(board, "1R")          # ends off the goal
    assert not replay(board, "1R 1D 1U")    # moves after the win
    assert not replay(board, "1L 1R 1D")    # 1L cannot move
    assert not replay(board, "2R")          # no such piece


def test_pieces_block_each_other():
    board = Board.parse([
        "#######",
        "#S.2.G#",
        "#######",
    ])
    positions = board.pieces()
    assert slide(board, positions, 0, 3) == board.start + 1   # player stops at 2
    assert slide(board, positions, 1, 2) == board.start + 1   # 2 stops at the player


@pytest.mark.parametrize("k", [0, 1, 2, 3])
def test_matches_reference_on_random_boards(k):
    rng = random.Random(1000 + k)
    checked = 0
    while checked < 40:
        board = random_board(rng, rng.randint(5, 7), rng.randint(5, 8), k)
        if board is None:
            continue
        expected = reference_solve(board)
        got = solve(board)
        assert got.opt == expected, board.to_rows()
        if expected is not None:
            result = analyse(board, max_opt=200, max_states=10**7)
            assert result.opt == expected
            assert replay(board, result.solution), (board.to_rows(), result.solution)
            assert len(result.solution.split()) == expected
        checked += 1


def test_round_trip_map():
    rows = ["#####", "#S2G#", "#.34#", "#####"]
    assert Board.parse(rows).to_rows() == rows
    assert np.count_nonzero(Board.parse(rows).walls) == 14
