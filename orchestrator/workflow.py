"""High-level orchestration workflows used by CLI commands."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

from .compose_ops import compose_file_path, compose_running, generate_compose, run_compose_action
from .context import build_instance_context
from .errors import ValidationError
from .inventory import (
    find_instance,
    get_instances,
    inventory_path,
    load_inventory_file,
    save_inventory_file,
    validate_inventory,
)
from .policy import effective_policy_summary, validate_policies
from .render import render_instance_config
from .revisions import create_revision, list_revisions, load_revision_instance
from .utils import run_command, write_json


def load_and_validate(inv_file: str | None) -> tuple[Path, dict[str, Any]]:
    inv_path = inventory_path(inv_file)
    inventory = load_inventory_file(inv_path)
    validate_inventory(inventory, inv_path)
    validate_policies(inventory, get_instances(inventory))
    return inv_path, inventory


def validate_only(inv_file: str | None) -> tuple[Path, dict[str, Any]]:
    return load_and_validate(inv_file)


def render_instance(inv_file: str | None, instance_id: str, dry_run: bool = False) -> dict[str, Any]:
    inv_path, inventory = load_and_validate(inv_file)
    instance = find_instance(inventory, instance_id)
    context, rendered, generated_path = render_instance_config(instance, inv_path, dry_run=dry_run)

    if dry_run:
        return {
            "instance": instance_id,
            "dry_run": True,
            "generated_path": str(generated_path),
            "summary": {
                "agents": len((rendered.get("agents") or {}).get("list") or []),
                "bindings": len(rendered.get("bindings") or []),
                "channels": len(rendered.get("channels") or {}),
            },
        }

    return {
        "instance": instance_id,
        "dry_run": False,
        "generated_path": str(generated_path),
        "runtime_config_path": str(context.config_dir / "openclaw.json5"),
    }


def generate_compose_for_instance(inv_file: str | None, instance_id: str) -> dict[str, Any]:
    inv_path, inventory = load_and_validate(inv_file)
    instance = find_instance(inventory, instance_id)
    context, rendered, generated_path = render_instance_config(instance, inv_path, dry_run=False)
    compose = generate_compose(instance, context, generated_path)

    # Keep rendered config copy in generated path for troubleshooting.
    write_json(context.generated_dir / "openclaw.resolved.json", rendered)

    return {
        "instance": instance_id,
        "compose_path": str(compose),
    }


def run_compose(inv_file: str | None, instance_id: str, action: str) -> dict[str, Any]:
    inv_path, inventory = load_and_validate(inv_file)
    instance = find_instance(inventory, instance_id)
    context = build_instance_context(instance, inv_path)

    if action in {"up", "restart", "pull"}:
        render_instance_config(instance, inv_path, dry_run=False)
        generate_compose(instance, context, context.config_dir / "openclaw.json5")

    output = run_compose_action(context, action)
    return {
        "instance": instance_id,
        "action": action,
        "output": output,
    }


def preflight_instance(inv_file: str | None, instance_id: str) -> dict[str, Any]:
    inv_path, inventory = load_and_validate(inv_file)
    instance = find_instance(inventory, instance_id)

    docker_v = run_command(["docker", "--version"]).stdout.strip()
    compose_v = run_command(["docker", "compose", "version"]).stdout.strip()

    context, rendered, generated_path = render_instance_config(instance, inv_path, dry_run=False)
    compose_path = generate_compose(instance, context, generated_path)

    # Keep effective policies for operational inspection.
    policies = {
        "instance": effective_policy_summary(inventory, instance, None).policy,
        "agents": {},
    }
    for agent in instance.get("agents") or []:
        agent_id = agent.get("id")
        if isinstance(agent_id, str):
            policies["agents"][agent_id] = effective_policy_summary(
                inventory, instance, agent
            ).policy

    write_json(context.generated_dir / "effective-policy.json", policies)
    write_json(context.generated_dir / "render-summary.json", rendered)

    return {
        "instance": instance_id,
        "docker": docker_v,
        "compose": compose_v,
        "generated_config": str(generated_path),
        "generated_compose": str(compose_path),
        "effective_policy": str(context.generated_dir / "effective-policy.json"),
    }


def health_instance(inv_file: str | None, instance_id: str) -> dict[str, Any]:
    inv_path, inventory = load_and_validate(inv_file)
    instance = find_instance(inventory, instance_id)
    context = build_instance_context(instance, inv_path)

    running = compose_running(context)
    ps_text = run_compose_action(context, "ps") if compose_file_path(context).exists() else ""

    return {
        "instance": instance_id,
        "status": "running" if running else "degraded",
        "compose": str(compose_file_path(context)),
        "ps": ps_text,
    }


def update_instance(
    inv_file: str | None,
    instance_id: str,
    image_tag: str | None,
) -> dict[str, Any]:
    inv_path, inventory = load_and_validate(inv_file)
    instance = find_instance(inventory, instance_id)

    # Snapshot before mutating runtime config/image.
    context, rendered, generated_path = render_instance_config(instance, inv_path, dry_run=False)
    compose_path = generate_compose(instance, context, generated_path)
    revision = create_revision(inv_path, instance, rendered, compose_path)

    if image_tag:
        docker_cfg = (instance.setdefault("openclaw", {}).setdefault("docker", {}))
        image = str(docker_cfg.get("image") or "ghcr.io/openclaw/openclaw:latest")
        base = image.split(":", 1)[0]
        docker_cfg["image"] = f"{base}:{image_tag}"
        save_inventory_file(inv_path, inventory)

    # Re-run full validation post-mutation.
    validate_inventory(inventory, inv_path)
    validate_policies(inventory, get_instances(inventory))

    context, _, generated_path = render_instance_config(instance, inv_path, dry_run=False)
    generate_compose(instance, context, generated_path)
    pull_out = run_compose_action(context, "pull")
    up_out = run_compose_action(context, "up")

    status = "running" if compose_running(context) else "degraded"
    return {
        "instance": instance_id,
        "revision": revision,
        "status": status,
        "pull": pull_out,
        "up": up_out,
    }


def rollback_instance(inv_file: str | None, instance_id: str, revision: str) -> dict[str, Any]:
    inv_path = inventory_path(inv_file)
    inventory = load_inventory_file(inv_path)

    snap = load_revision_instance(instance_id, revision)

    instances = inventory.get("instances") or []
    replaced = False
    if isinstance(instances, list):
        for idx, instance in enumerate(instances):
            if isinstance(instance, dict) and instance.get("id") == instance_id:
                instances[idx] = copy.deepcopy(snap)
                replaced = True
                break

    if not replaced:
        raise ValidationError(f"instance not found in current inventory: {instance_id}")

    save_inventory_file(inv_path, inventory)
    validate_inventory(inventory, inv_path)
    validate_policies(inventory, get_instances(inventory))

    instance = find_instance(inventory, instance_id)
    context, _, generated_path = render_instance_config(instance, inv_path, dry_run=False)
    generate_compose(instance, context, generated_path)
    up_out = run_compose_action(context, "up")

    status = "running" if compose_running(context) else "degraded"
    return {
        "instance": instance_id,
        "revision": revision,
        "status": status,
        "up": up_out,
    }


def revisions_for_instance(instance_id: str) -> list[str]:
    return list_revisions(instance_id)
