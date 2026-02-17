"""Context helpers for resolving paths and instance metadata."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .inventory import resolve_relative


@dataclass(frozen=True)
class InstanceContext:
    id: str
    inventory_path: Path
    inventory_dir: Path
    generated_dir: Path
    config_dir: Path
    state_dir: Path
    workspace_root: Path
    gateway_port: int
    gateway_bind: str


CONTAINER_CONFIG_DIR = Path("/var/lib/openclaw/config")
CONTAINER_STATE_DIR = Path("/var/lib/openclaw/state")
CONTAINER_WORKSPACE_DIR = Path("/var/lib/openclaw/workspaces")


def build_instance_context(instance: dict[str, Any], inv_path: Path) -> InstanceContext:
    inv_dir = inv_path.parent
    paths = instance["paths"]
    host = instance["host"]

    return InstanceContext(
        id=str(instance["id"]),
        inventory_path=inv_path,
        inventory_dir=inv_dir,
        generated_dir=resolve_relative(inv_dir, paths["generated_dir"]),
        config_dir=resolve_relative(inv_dir, paths["config_dir"]),
        state_dir=resolve_relative(inv_dir, paths["state_dir"]),
        workspace_root=resolve_relative(inv_dir, paths["workspace_root"]),
        gateway_port=int(host["gateway_port"]),
        gateway_bind=str(host.get("bind", "127.0.0.1")),
    )
