"""Command line: ``python -m levelgen {generate,check,show} ...``"""
from __future__ import annotations

import argparse
import os
import random
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .check import check_pack
from .orchestrate import generate
from .pack import read_pack, write_pack
from .scoring import difficulty
from .tiers import TIERS

DEFAULT_PACK = Path("levels/levels.json")


def parse_tiers(spec: str | None) -> list[int]:
    """``"0,3,5-8"`` -> [0, 3, 5, 6, 7, 8]; None means every tier."""
    if not spec:
        return list(range(len(TIERS)))
    picked = []
    for part in spec.split(","):
        lo, _, hi = part.partition("-")
        picked.extend(range(int(lo), int(hi or lo) + 1))
    if any(not 0 <= t < len(TIERS) for t in picked):
        raise SystemExit(f"tiers run from 0 to {len(TIERS) - 1}")
    return sorted(set(picked))


def split_budget(count: int, tiers: list[int]) -> dict[int, int]:
    base, extra = divmod(count, len(tiers))
    return {t: base + (i < extra) for i, t in enumerate(tiers)}


def cmd_generate(args: argparse.Namespace) -> int:
    seed = args.seed if args.seed is not None else random.getrandbits(32)
    budgets = split_budget(args.count, parse_tiers(args.tiers))
    print(f"Generating {args.count} levels on {args.workers} workers (seed {seed}), "
          f"keeping the best 1 of {args.oversample} per tier.")
    started = time.monotonic()
    levels = generate(budgets, workers=args.workers, seed=seed, batch_seconds=args.batch_seconds,
                      oversample=args.oversample, max_states=args.max_states)
    levels.sort(key=lambda lv: (difficulty(lv), lv["states"]))

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seed": seed,
        "count": len(levels),
    }
    write_pack(args.out, levels, meta)
    minutes = (time.monotonic() - started) / 60
    print(f"\nWrote {len(levels)} levels to {args.out} in {minutes:.1f} min.")
    _summary(levels)
    return 0


def _summary(levels: list[dict]) -> None:
    by_blocks = Counter(lv["blocks"] for lv in levels)
    alone = sum(lv["blocks"] > 0 and lv["solo"] is not None for lv in levels)
    needed = sum(lv["blocks"] > 0 and lv["solo"] is None for lv in levels)
    print("Blocks per level: " + ", ".join(f"{k}: {by_blocks[k]}" for k in sorted(by_blocks)))
    print(f"With blocks: {needed} impossible alone, {alone} solvable alone but slower.")
    opts = Counter(lv["opt"] for lv in levels)
    print("Optimal moves:")
    for opt in sorted(opts):
        print(f"  {opt:3}: {opts[opt]:4}  {'#' * min(opts[opt], 60)}")


def cmd_check(args: argparse.Namespace) -> int:
    _, levels = read_pack(args.pack)
    print(f"Re-solving {len(levels)} levels from {args.pack}...")
    failures = check_pack(levels, args.workers)
    print("All levels verified." if not failures else f"{failures} level(s) failed.")
    return 1 if failures else 0


def cmd_show(args: argparse.Namespace) -> int:
    _, levels = read_pack(args.pack)
    for n in args.numbers:
        lv = levels[n - 1]
        print(f"#{n}  tier {lv['tier']}  opt {lv['opt']}  alone {lv['solo'] or '-'}  "
              f"blocks {lv['blocks']} (must move {lv['essential']})  states {lv['states']}")
        print("\n".join(lv["map"]))
        print(lv["solution"], end="\n\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m levelgen")
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="generate a level pack")
    gen.add_argument("--count", type=int, default=240, help="levels in total (default 240)")
    gen.add_argument("--out", type=Path, default=DEFAULT_PACK)
    gen.add_argument("--tiers", help="subset of tiers, e.g. 0,3,5-8 (default all)")
    gen.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    gen.add_argument("--seed", type=int)
    gen.add_argument("--oversample", type=int, default=2,
                     help="find N times the levels needed per tier and keep the most intricate")
    gen.add_argument("--batch-seconds", type=float, default=10.0)
    gen.add_argument("--max-states", type=int, default=30_000_000,
                     help="skip a candidate whose search grows past this many states")
    gen.set_defaults(run=cmd_generate)

    chk = sub.add_parser("check", help="re-solve every level of a pack")
    chk.add_argument("pack", type=Path, nargs="?", default=DEFAULT_PACK)
    chk.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    chk.set_defaults(run=cmd_check)

    show = sub.add_parser("show", help="print levels of a pack with their solutions")
    show.add_argument("numbers", type=int, nargs="+", help="1-based positions in the pack")
    show.add_argument("--pack", type=Path, default=DEFAULT_PACK)
    show.set_defaults(run=cmd_show)

    args = parser.parse_args(argv)
    if getattr(args, "count", 1) < 1:
        parser.error("--count must be at least 1")
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
