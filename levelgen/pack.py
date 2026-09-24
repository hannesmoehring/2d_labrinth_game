"""The level pack: the JSON file import-levels.js loads into the database."""
from __future__ import annotations

import json
from pathlib import Path

VERSION = 1


def write_pack(path: Path, levels: list[dict], meta: dict) -> None:
    """One level per block, one map row per line, so diffs stay readable."""
    path.parent.mkdir(parents=True, exist_ok=True)
    body = ",\n".join(_level_json(level) for level in levels)
    head = json.dumps({"version": VERSION, **meta})[:-1]
    path.write_text(f'{head}, "levels": [\n{body}\n]}}\n')


def _level_json(level: dict) -> str:
    fields = {k: v for k, v in level.items() if k != "map"}
    rows = ",\n".join(f"    {json.dumps(r)}" for r in level["map"])
    return f'  {json.dumps(fields)[:-1]}, "map": [\n{rows}\n  ]}}'


def read_pack(path: Path) -> tuple[dict, list[dict]]:
    data = json.loads(path.read_text())
    if data.get("version") != VERSION:
        raise ValueError(f"{path}: unsupported pack version {data.get('version')}")
    levels = data.pop("levels")
    return data, levels
