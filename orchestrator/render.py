"""Config rendering from layered JSON5-style files plus inventory overlays."""

from __future__ import annotations

import os
import re
import json
from pathlib import Path
from typing import Any

from .context import (
    CONTAINER_STATE_DIR,
    CONTAINER_WORKSPACE_DIR,
    InstanceContext,
    build_instance_context,
)
from .errors import ValidationError
from .inventory import resolve_relative
from .utils import deep_merge, ensure_dir, write_json

_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")
_TRAILING_COMMA_PATTERN = re.compile(r",\s*([}\]])")


def render_instance_config(
    instance: dict[str, Any],
    inv_path: Path,
    dry_run: bool = False,
) -> tuple[InstanceContext, dict[str, Any], Path]:
    context = build_instance_context(instance, inv_path)
    ensure_dir(context.generated_dir)
    ensure_dir(context.config_dir)
    ensure_dir(context.state_dir)
    ensure_dir(context.workspace_root)

    inv_dir = inv_path.parent
    layers = instance.get("openclaw", {}).get("config_layers") or []
    if not layers:
        raise ValidationError(f"instance '{instance['id']}' has no openclaw.config_layers")

    merged: dict[str, Any] = {}
    for layer in layers:
        layer_path = resolve_relative(inv_dir, layer)
        layer_data = _load_json5_with_includes(layer_path, set())
        merged = deep_merge(merged, layer_data)

    merged = deep_merge(merged, _runtime_overlay(instance, context))
    merged = _substitute_env(merged)

    generated_path = context.generated_dir / "openclaw.resolved.json"
    if not dry_run:
        write_json(generated_path, merged)

        # Keep the mounted config path in sync for Docker runtime.
        runtime_config_path = context.config_dir / "openclaw.json5"
        write_json(runtime_config_path, merged)

    return context, merged, generated_path


def _runtime_overlay(instance: dict[str, Any], context: InstanceContext) -> dict[str, Any]:
    host = instance.get("host") or {}
    agents = instance.get("agents") or []
    channels = instance.get("channels") or {}

    runtime_agents: list[dict[str, Any]] = []
    runtime_bindings: list[dict[str, Any]] = []

    for agent in agents:
        agent_id = agent["id"]
        workspace = str(agent.get("workspace") or agent_id)
        agent_dir = str(agent.get("agent_dir") or f"agents/{agent_id}")

        runtime_agents.append(
            {
                "id": agent_id,
                "workspace": f"{CONTAINER_WORKSPACE_DIR}/{workspace}",
                "agentDir": f"{CONTAINER_STATE_DIR}/{agent_dir}",
                "role": agent.get("role", "usecase"),
            }
        )

        for binding in agent.get("bindings") or []:
            bound = dict(binding)
            bound["agentId"] = agent_id
            runtime_bindings.append(bound)

    runtime_channels: dict[str, Any] = {}
    if isinstance(channels, dict):
        for provider, cfg in channels.items():
            runtime_channels[provider] = _normalize_channel_accounts(cfg)

    return {
        "gateway": {
            "port": int(host.get("gateway_port", context.gateway_port)),
            "bind": str(host.get("bind", context.gateway_bind)),
        },
        "agents": {
            "list": runtime_agents,
        },
        "bindings": runtime_bindings,
        "channels": runtime_channels,
    }


def _normalize_channel_accounts(raw: Any) -> dict[str, Any]:
    if isinstance(raw, list):
        accounts = {str(v): {} for v in raw if isinstance(v, str)}
        return {"accounts": accounts}

    if not isinstance(raw, dict):
        return {}

    accounts = raw.get("accounts")
    if isinstance(accounts, list):
        normalized = {str(v): {} for v in accounts if isinstance(v, str)}
        out = dict(raw)
        out["accounts"] = normalized
        return out

    if isinstance(accounts, dict):
        return raw

    return raw


def _load_json5_with_includes(path: Path, seen: set[Path]) -> dict[str, Any]:
    if path in seen:
        raise ValidationError(f"cyclic $include detected at: {path}")
    if not path.exists():
        raise ValidationError(f"config layer not found: {path}")

    seen_next = set(seen)
    seen_next.add(path)

    parsed = _parse_json5_text(path.read_text(encoding="utf-8"), path)

    if parsed is None:
        parsed = {}

    if not isinstance(parsed, dict):
        raise ValidationError(f"config layer must be object mapping: {path}")

    includes = parsed.get("$include")
    body = {k: v for k, v in parsed.items() if k != "$include"}

    base: dict[str, Any] = {}
    include_list: list[str] = []
    if isinstance(includes, str):
        include_list = [includes]
    elif isinstance(includes, list):
        include_list = [i for i in includes if isinstance(i, str)]

    for inc in include_list:
        inc_path = resolve_relative(path.parent, inc)
        inc_data = _load_json5_with_includes(inc_path, seen_next)
        base = deep_merge(base, inc_data)

    return deep_merge(base, body)


def _parse_json5_text(text: str, path: Path) -> Any:
    try:
        import json5  # type: ignore

        return json5.loads(text)
    except ModuleNotFoundError:
        pass
    except Exception as exc:  # pragma: no cover - pass through to fallback
        raise ValidationError(f"failed to parse JSON5 layer {path}: {exc}") from exc

    try:
        transformed = _to_json_compatible(text)
        return json.loads(transformed)
    except Exception as exc:
        raise ValidationError(
            f"failed to parse JSON5-like layer {path} without json5 dependency: {exc}"
        ) from exc


def _to_json_compatible(text: str) -> str:
    stripped = _strip_comments(text)
    normalized = stripped

    while True:
        updated = _TRAILING_COMMA_PATTERN.sub(r"\1", normalized)
        if updated == normalized:
            break
        normalized = updated

    normalized = _quote_unquoted_keys(normalized)
    return normalized


def _strip_comments(text: str) -> str:
    out: list[str] = []
    i = 0
    n = len(text)
    in_string = False
    quote = ""
    escape = False

    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""

        if in_string:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                in_string = False
            i += 1
            continue

        if ch in {'"', "'"}:
            in_string = True
            quote = ch
            out.append(ch)
            i += 1
            continue

        if ch == "/" and nxt == "/":
            i += 2
            while i < n and text[i] != "\n":
                i += 1
            continue

        if ch == "/" and nxt == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def _quote_unquoted_keys(text: str) -> str:
    out: list[str] = []
    i = 0
    n = len(text)
    in_string = False
    quote = ""
    escape = False

    while i < n:
        ch = text[i]

        if in_string:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                in_string = False
            i += 1
            continue

        if ch in {'"', "'"}:
            in_string = True
            quote = ch
            out.append(ch)
            i += 1
            continue

        if ch in "{,":
            out.append(ch)
            i += 1

            while i < n and text[i].isspace():
                out.append(text[i])
                i += 1

            start = i
            if i < n and _is_ident_start(text[i]):
                i += 1
                while i < n and _is_ident_char(text[i]):
                    i += 1
                key = text[start:i]

                j = i
                while j < n and text[j].isspace():
                    j += 1

                if j < n and text[j] == ":":
                    out.append(f'"{key}"')
                    out.append(text[i:j])
                    out.append(":")
                    i = j + 1
                    continue

                out.append(text[start:i])
                continue

            continue

        out.append(ch)
        i += 1

    return "".join(out)


def _is_ident_start(ch: str) -> bool:
    return ch == "_" or ("a" <= ch <= "z") or ("A" <= ch <= "Z")


def _is_ident_char(ch: str) -> bool:
    return _is_ident_start(ch) or ("0" <= ch <= "9") or ch == "-"


def _substitute_env(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _substitute_env(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_substitute_env(v) for v in obj]
    if isinstance(obj, str):
        return _ENV_PATTERN.sub(_replace_env_match, obj)
    return obj


def _replace_env_match(match: re.Match[str]) -> str:
    key = match.group(1)
    fallback = match.group(2)
    value = os.getenv(key)
    if value is not None:
        return value
    if fallback is not None:
        return fallback
    raise ValidationError(f"missing required environment variable: {key}")
