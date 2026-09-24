"""Fans the search out over every core until each tier has its levels."""
from __future__ import annotations

import random
import time
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait

from .generator import search
from .scoring import interest
from .tiers import TIERS


def generate(budgets: dict[int, int], *, workers: int, seed: int, batch_seconds: float,
             oversample: int, max_states: int) -> list[dict]:
    """Collect ``oversample`` x budget distinct levels per tier, keep the best.

    Each batch is a (tier, seed) job; the tier least filled goes next, so once
    the quick tiers are done every core works on the slow, large ones.
    """
    targets = {t: n * oversample for t, n in budgets.items() if n > 0}
    pools: dict[int, list[dict]] = {t: [] for t in targets}
    tried = {t: 0 for t in targets}
    inflight = {t: 0 for t in targets}
    seen: set[str] = set()
    seeds = random.Random(seed)
    started = time.monotonic()

    def next_tier() -> int | None:
        open_tiers = [t for t in targets if len(pools[t]) < targets[t]]
        if not open_tiers:
            return None
        return min(open_tiers, key=lambda t: (len(pools[t]) / targets[t], inflight[t]))

    with ProcessPoolExecutor(max_workers=workers) as pool:
        jobs = {}

        def submit() -> bool:
            t = next_tier()
            if t is None:
                return False
            want = targets[t] - len(pools[t])
            job = pool.submit(search, t, seeds.getrandbits(63), batch_seconds, want, max_states)
            jobs[job] = t
            inflight[t] += 1
            return True

        for _ in range(workers):
            if not submit():
                break
        while jobs:
            done, _ = wait(jobs, return_when=FIRST_COMPLETED)
            for job in done:
                t = jobs.pop(job)
                inflight[t] -= 1
                n_tried, found = job.result()
                tried[t] += n_tried
                fresh = [lv for lv in found if "|".join(lv["map"]) not in seen]
                seen.update("|".join(lv["map"]) for lv in fresh)
                was_open = len(pools[t]) < targets[t]
                pools[t].extend(fresh)
                if was_open:
                    _progress(started, t, pools[t], targets[t], tried[t])
            while len(jobs) < workers and submit():
                pass

    chosen = []
    for t, n in budgets.items():
        if n > 0:
            chosen.extend(sorted(pools[t], key=interest, reverse=True)[:n])
    return chosen


def _progress(started: float, t: int, pool: list[dict], target: int, tried: int) -> None:
    elapsed = time.monotonic() - started
    have = min(len(pool), target)
    rate = f"1 in {tried // max(1, len(pool))}" if pool else "none yet"
    print(f"[{elapsed:7.1f}s] tier {t:2} {TIERS[t].label:18} {have:4}/{target:<4} "
          f"accepted {rate} of {tried} tried", flush=True)
