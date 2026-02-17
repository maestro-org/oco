"""Utility helpers for filesystem and subprocess operations."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Iterable, Mapping

import yaml

from .errors import CommandError


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"expected mapping in {path}")
    return data


def save_yaml(path: Path, data: Mapping[str, Any]) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(dict(data), f, sort_keys=False)


def write_json(path: Path, data: Any) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def deep_merge(left: Any, right: Any) -> Any:
    """Deterministic deep merge used for config layering.

    Rules:
    - dict + dict: recursive merge
    - list + list: append right to left
    - otherwise: right wins
    """

    if isinstance(left, dict) and isinstance(right, dict):
        merged: dict[str, Any] = {k: v for k, v in left.items()}
        for key, value in right.items():
            if key in merged:
                merged[key] = deep_merge(merged[key], value)
            else:
                merged[key] = value
        return merged

    if isinstance(left, list) and isinstance(right, list):
        return [*left, *right]

    return right


def run_command(
    args: Iterable[str],
    cwd: Path | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    command = [str(a) for a in args]
    proc = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=True,
        check=False,
    )
    if check and proc.returncode != 0:
        raise CommandError(" ".join(command), proc.returncode, proc.stderr)
    return proc
