"""Inventory loading, validation, and mutation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .errors import ValidationError
from .utils import load_yaml, save_yaml

DEFAULT_INVENTORY = Path("inventory/instances.yaml")


def inventory_path(path: str | None) -> Path:
    return Path(path).resolve() if path else DEFAULT_INVENTORY.resolve()


def load_inventory_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ValidationError(f"inventory file not found: {path}")
    return load_yaml(path)


def save_inventory_file(path: Path, data: dict[str, Any]) -> None:
    save_yaml(path, data)


def get_defaults(inventory: dict[str, Any]) -> dict[str, Any]:
    defaults = inventory.get("defaults") or {}
    if not isinstance(defaults, dict):
        raise ValidationError("defaults must be a mapping")
    return defaults


def get_instances(inventory: dict[str, Any], enabled_only: bool = False) -> list[dict[str, Any]]:
    instances = inventory.get("instances") or []
    if not isinstance(instances, list):
        raise ValidationError("instances must be a list")
    if not enabled_only:
        return instances
    return [instance for instance in instances if instance.get("enabled", True)]


def find_instance(inventory: dict[str, Any], instance_id: str) -> dict[str, Any]:
    for instance in get_instances(inventory, enabled_only=False):
        if instance.get("id") == instance_id:
            return instance
    raise ValidationError(f"instance not found: {instance_id}")


def resolve_relative(base: Path, maybe_rel: str) -> Path:
    p = Path(maybe_rel)
    if p.is_absolute():
        return p
    return (base / p).resolve()


def _check_required_mapping(
    errors: list[str], obj: dict[str, Any], key: str, parent: str
) -> dict[str, Any]:
    value = obj.get(key)
    if not isinstance(value, dict):
        errors.append(f"{parent}.{key} must be a mapping")
        return {}
    return value


def validate_inventory(inventory: dict[str, Any], inv_path: Path) -> None:
    errors: list[str] = []

    version = inventory.get("version")
    if version != 1:
        errors.append("version must be 1")

    instances = inventory.get("instances")
    if not isinstance(instances, list) or not instances:
        errors.append("instances must be a non-empty list")
        _raise_if_errors(errors)
        return

    defaults = get_defaults(inventory)
    port_stride = defaults.get("port_stride", 20)
    if not isinstance(port_stride, int) or port_stride < 1:
        errors.append("defaults.port_stride must be a positive integer")
        port_stride = 20

    inv_dir = inv_path.parent
    seen_ids: set[str] = set()
    used_ranges: list[tuple[int, int, str]] = []

    used_config_paths: dict[Path, str] = {}
    used_state_paths: dict[Path, str] = {}
    used_workspace_paths: dict[Path, str] = {}
    used_generated_paths: dict[Path, str] = {}

    for index, instance in enumerate(instances):
        label = f"instances[{index}]"
        if not isinstance(instance, dict):
            errors.append(f"{label} must be a mapping")
            continue

        instance_id = instance.get("id")
        if not isinstance(instance_id, str) or not instance_id.strip():
            errors.append(f"{label}.id must be a non-empty string")
            continue

        if instance_id in seen_ids:
            errors.append(f"duplicate instance id: {instance_id}")
            continue
        seen_ids.add(instance_id)

        host = _check_required_mapping(errors, instance, "host", label)
        paths = _check_required_mapping(errors, instance, "paths", label)
        openclaw = _check_required_mapping(errors, instance, "openclaw", label)

        port = host.get("gateway_port")
        if not isinstance(port, int) or port < 1 or port > 65535:
            errors.append(f"{label}.host.gateway_port must be a valid port integer")
        else:
            start = port
            end = min(65535, port + port_stride - 1)
            for prev_start, prev_end, prev_id in used_ranges:
                if not (end < prev_start or start > prev_end):
                    errors.append(
                        "port range collision "
                        f"{instance_id}({start}-{end}) overlaps {prev_id}({prev_start}-{prev_end})"
                    )
            used_ranges.append((start, end, instance_id))

        _check_path_uniqueness(
            errors,
            inv_dir,
            paths,
            "config_dir",
            instance_id,
            used_config_paths,
            label,
        )
        _check_path_uniqueness(
            errors,
            inv_dir,
            paths,
            "state_dir",
            instance_id,
            used_state_paths,
            label,
        )
        _check_path_uniqueness(
            errors,
            inv_dir,
            paths,
            "workspace_root",
            instance_id,
            used_workspace_paths,
            label,
        )
        _check_path_uniqueness(
            errors,
            inv_dir,
            paths,
            "generated_dir",
            instance_id,
            used_generated_paths,
            label,
        )

        layers = openclaw.get("config_layers") or []
        if not isinstance(layers, list) or not layers:
            errors.append(f"{label}.openclaw.config_layers must be a non-empty list")
        else:
            for i, layer in enumerate(layers):
                if not isinstance(layer, str):
                    errors.append(f"{label}.openclaw.config_layers[{i}] must be a string")
                    continue
                layer_path = resolve_relative(inv_dir, layer)
                if not layer_path.exists():
                    errors.append(f"missing config layer for {instance_id}: {layer}")

        agents = instance.get("agents") or []
        if not isinstance(agents, list):
            errors.append(f"{label}.agents must be a list")
            agents = []

        _validate_agents(errors, label, agents)

    _raise_if_errors(errors)


def _validate_agents(errors: list[str], label: str, agents: list[dict[str, Any]]) -> None:
    seen_agent_ids: set[str] = set()
    seen_workspace: set[str] = set()
    seen_agent_dir: set[str] = set()
    seen_account_bindings: set[str] = set()

    for i, agent in enumerate(agents):
        alabel = f"{label}.agents[{i}]"
        if not isinstance(agent, dict):
            errors.append(f"{alabel} must be a mapping")
            continue

        agent_id = agent.get("id")
        if not isinstance(agent_id, str) or not agent_id:
            errors.append(f"{alabel}.id must be a non-empty string")
            continue
        if agent_id in seen_agent_ids:
            errors.append(f"duplicate agent id in instance: {agent_id}")
            continue
        seen_agent_ids.add(agent_id)

        workspace = agent.get("workspace", agent_id)
        if not isinstance(workspace, str) or not workspace:
            errors.append(f"{alabel}.workspace must be a non-empty string")
        elif workspace in seen_workspace:
            errors.append(f"duplicate workspace in instance: {workspace}")
        else:
            seen_workspace.add(workspace)

        agent_dir = agent.get("agent_dir", f"agents/{agent_id}")
        if not isinstance(agent_dir, str) or not agent_dir:
            errors.append(f"{alabel}.agent_dir must be a non-empty string")
        elif agent_dir in seen_agent_dir:
            errors.append(f"duplicate agent_dir in instance: {agent_dir}")
        else:
            seen_agent_dir.add(agent_dir)

        bindings = agent.get("bindings") or []
        if not isinstance(bindings, list) or not bindings:
            errors.append(f"{alabel}.bindings must be a non-empty list")
            continue

        for j, binding in enumerate(bindings):
            blabel = f"{alabel}.bindings[{j}]"
            if not isinstance(binding, dict):
                errors.append(f"{blabel} must be a mapping")
                continue
            match = binding.get("match") or {}
            if not isinstance(match, dict):
                errors.append(f"{blabel}.match must be a mapping")
                continue
            channel = match.get("channel")
            account_id = match.get("accountId") or match.get("account_id")
            if not channel or not account_id:
                errors.append(
                    f"{blabel}.match requires channel and accountId/account_id for routing"
                )
                continue
            key = f"{channel}:{account_id}"
            if key in seen_account_bindings:
                errors.append(f"duplicate channel/account binding in instance: {key}")
            else:
                seen_account_bindings.add(key)


def _check_path_uniqueness(
    errors: list[str],
    inv_dir: Path,
    paths: dict[str, Any],
    key: str,
    instance_id: str,
    used: dict[Path, str],
    label: str,
) -> None:
    raw = paths.get(key)
    if not isinstance(raw, str) or not raw:
        errors.append(f"{label}.paths.{key} must be a non-empty string")
        return
    resolved = resolve_relative(inv_dir, raw)
    prev = used.get(resolved)
    if prev:
        errors.append(f"path collision for {key}: {instance_id} shares {raw} with {prev}")
    used[resolved] = instance_id


def _raise_if_errors(errors: list[str]) -> None:
    if not errors:
        return
    header = "Inventory validation failed:"
    raise ValidationError(header + "\n- " + "\n- ".join(errors))
