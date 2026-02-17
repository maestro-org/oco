"""Docker Compose generation and lifecycle operations."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .context import (
    CONTAINER_CONFIG_DIR,
    CONTAINER_STATE_DIR,
    CONTAINER_WORKSPACE_DIR,
    InstanceContext,
)
from .errors import ValidationError
from .utils import ensure_dir, run_command


def compose_file_path(context: InstanceContext) -> Path:
    return context.generated_dir / "docker-compose.yaml"


def generate_compose(
    instance: dict[str, Any],
    context: InstanceContext,
    config_path: Path,
) -> Path:
    ensure_dir(context.generated_dir)

    docker = ((instance.get("openclaw") or {}).get("docker") or {})
    image = str(docker.get("image") or "ghcr.io/openclaw/openclaw:latest")
    service_name = str(docker.get("service_name") or "gateway")
    container_name = str(
        docker.get("container_name") or f"openclaw-{instance['id']}"
    )
    restart_policy = str(docker.get("restart") or "unless-stopped")

    command = docker.get("command")
    if command is not None and not isinstance(command, (str, list)):
        raise ValidationError("openclaw.docker.command must be string or list")

    env: dict[str, str] = {
        "OPENCLAW_CONFIG_PATH": f"{CONTAINER_CONFIG_DIR}/openclaw.json5",
        "OPENCLAW_STATE_DIR": str(CONTAINER_STATE_DIR),
        "OPENCLAW_WORKSPACE_ROOT": str(CONTAINER_WORKSPACE_DIR),
    }

    extra_env = docker.get("environment") or {}
    if isinstance(extra_env, dict):
        for key, value in extra_env.items():
            env[str(key)] = str(value)

    ports = [f"{context.gateway_bind}:{context.gateway_port}:{context.gateway_port}"]

    compose: dict[str, Any] = {
        "services": {
            service_name: {
                "image": image,
                "container_name": container_name,
                "restart": restart_policy,
                "ports": ports,
                "environment": env,
                "volumes": [
                    f"{context.config_dir}:{CONTAINER_CONFIG_DIR}",
                    f"{context.state_dir}:{CONTAINER_STATE_DIR}",
                    f"{context.workspace_root}:{CONTAINER_WORKSPACE_DIR}",
                ],
            }
        }
    }

    if command is not None:
        compose["services"][service_name]["command"] = command

    compose_path = compose_file_path(context)
    with compose_path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(compose, f, sort_keys=False)

    # Keep a copy of resolved config alongside compose for debugging.
    if config_path.exists():
        link = context.generated_dir / "openclaw.resolved.json"
        if link != config_path and not link.exists():
            link.write_text(config_path.read_text(encoding="utf-8"), encoding="utf-8")

    return compose_path


def run_compose_action(context: InstanceContext, action: str) -> str:
    compose_file = compose_file_path(context)
    if not compose_file.exists():
        raise ValidationError(f"compose file not generated: {compose_file}")

    action = action.strip().lower()
    valid = {"up", "down", "restart", "ps", "pull"}
    if action not in valid:
        raise ValidationError(f"unsupported compose action: {action}")

    args = ["docker", "compose", "-f", str(compose_file)]
    if action == "up":
        args.extend(["up", "-d"])
    elif action == "down":
        args.append("down")
    elif action == "restart":
        args.append("restart")
    elif action == "ps":
        args.append("ps")
    elif action == "pull":
        args.append("pull")

    proc = run_command(args)
    return (proc.stdout or proc.stderr).strip()


def compose_running(context: InstanceContext) -> bool:
    compose_file = compose_file_path(context)
    if not compose_file.exists():
        return False

    proc = run_command(
        ["docker", "compose", "-f", str(compose_file), "ps"],
        check=False,
    )
    text = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        return False

    lowered = text.lower()
    return "running" in lowered
