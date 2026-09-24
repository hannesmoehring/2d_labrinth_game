"""Independent re-verification of a finished level pack."""
from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor

from .analysis import analyse, replay
from .board import Board, floor_region


def check_level(level: dict) -> str | None:
    """None when every stored figure holds, else what is wrong."""
    try:
        board = Board.parse(level["map"])
    except ValueError as err:
        return f"bad map: {err}"
    if not (floor_region(board.walls, board.cols, board.start) | board.walls).all():
        return "part of the floor is a compartment the player cannot reach"
    if not replay(board, level["solution"]):
        return "stored solution does not reach the goal"
    if len(level["solution"].split()) != level["opt"]:
        return f"solution has {len(level['solution'].split())} moves, opt says {level['opt']}"
    found = analyse(board, max_opt=level["opt"], max_states=200_000_000)
    if found is None or found.opt != level["opt"]:
        return f"opt is {found.opt if found else 'worse'}, pack says {level['opt']}"
    if found.solo != level["solo"] or found.essential != level["essential"]:
        return (f"solo/essential are {found.solo}/{found.essential}, "
                f"pack says {level['solo']}/{level['essential']}")
    return None


def check_pack(levels: list[dict], workers: int) -> int:
    """Prints every failing level; returns how many failed."""
    failures = 0
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for i, problem in enumerate(pool.map(check_level, levels, chunksize=4)):
            if problem:
                failures += 1
                print(f"level {i + 1}: {problem}")
    return failures
