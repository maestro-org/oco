"""Revision snapshots for update/rollback flows."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from .utils import ensure_dir, save_yaml, write_json

DEFAULT_REVISIONS_DIR = Path(".revisions")


def create_revision(
    inventory_path: Path,
    instance: dict[str, Any],
    rendered_config: dict[str, Any] | None,
    compose_path: Path | None,
) -> str:
    revision_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    rev_root = DEFAULT_REVISIONS_DIR / str(instance["id"]) / revision_id
    ensure_dir(rev_root)

    save_yaml(rev_root / "instance.yaml", deepcopy(instance))
    if rendered_config is not None:
        write_json(rev_root / "openclaw.resolved.json", rendered_config)
    if compose_path is not None and compose_path.exists():
        (rev_root / "docker-compose.yaml").write_text(
            compose_path.read_text(encoding="utf-8"), encoding="utf-8"
        )

    manifest = {
        "revision": revision_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "instance_id": instance["id"],
        "inventory_path": str(inventory_path),
    }
    write_json(rev_root / "manifest.json", manifest)
    return revision_id


def list_revisions(instance_id: str) -> list[str]:
    root = DEFAULT_REVISIONS_DIR / instance_id
    if not root.exists():
        return []
    return sorted([p.name for p in root.iterdir() if p.is_dir()], reverse=True)


def load_revision_instance(instance_id: str, revision: str) -> dict[str, Any]:
    path = DEFAULT_REVISIONS_DIR / instance_id / revision / "instance.yaml"
    if not path.exists():
        raise FileNotFoundError(f"revision not found: {instance_id}/{revision}")
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"invalid revision payload: {path}")
    return data
