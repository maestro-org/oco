"""Integration, skills, and model policy resolution + validation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .errors import ValidationError

CORE_INTEGRATIONS = {
    "whatsapp",
    "telegram",
    "discord",
    "slack",
    "signal",
    "google-chat",
    "irc",
    "imessage",
    "bluebubbles",
    "webchat",
}

PLUGIN_INTEGRATIONS = {
    "mattermost",
    "teams",
    "microsoft-teams",
    "feishu",
    "lark",
    "line",
    "matrix",
    "zalo",
    "zalo-personal",
    "nextcloud-talk",
    "nostr",
    "twitch",
    "tlon",
}

CUSTOM_ONLY_INTEGRATIONS = {"notion", "heygen"}

DEFAULT_SKILL_SOURCES = ["bundled", "managed", "workspace", "local", "shared"]


@dataclass
class PolicyResult:
    scope: str
    policy: dict[str, Any]


def list_supported_integrations() -> dict[str, list[str]]:
    return {
        "core": sorted(CORE_INTEGRATIONS),
        "plugin": sorted(PLUGIN_INTEGRATIONS),
        "custom_only": sorted(CUSTOM_ONLY_INTEGRATIONS),
    }


def resolve_org_policy(inventory: dict[str, Any]) -> dict[str, Any]:
    defaults = inventory.get("defaults") or {}
    policy = _policy_merge(_empty_policy(), defaults.get("policy") or {})
    policy = _policy_merge(policy, (inventory.get("policy") or {}))
    return _normalize_policy(policy)


def resolve_instance_policy(inventory: dict[str, Any], instance: dict[str, Any]) -> dict[str, Any]:
    org = resolve_org_policy(inventory)
    merged = _policy_merge(org, instance.get("policy") or {})
    return _normalize_policy(merged)


def resolve_agent_policy(
    inventory: dict[str, Any],
    instance: dict[str, Any],
    agent: dict[str, Any],
) -> dict[str, Any]:
    base = resolve_instance_policy(inventory, instance)
    merged = _policy_merge(base, agent.get("policy") or {})
    return _normalize_policy(merged)


def validate_policies(inventory: dict[str, Any], instances: list[dict[str, Any]]) -> None:
    errors: list[str] = []

    for instance in instances:
        instance_id = instance.get("id", "<unknown>")
        agents = instance.get("agents") or []
        for agent in agents:
            agent_id = agent.get("id", "<unknown>")
            policy = resolve_agent_policy(inventory, instance, agent)
            errors.extend(
                _validate_agent_against_policy(instance_id, agent_id, agent, policy)
            )

    if errors:
        raise ValidationError("Policy validation failed:\n- " + "\n- ".join(errors))


def effective_policy_summary(
    inventory: dict[str, Any],
    instance: dict[str, Any],
    agent: dict[str, Any] | None,
) -> PolicyResult:
    if agent is None:
        return PolicyResult(
            scope=f"instance:{instance['id']}",
            policy=resolve_instance_policy(inventory, instance),
        )

    return PolicyResult(
        scope=f"agent:{instance['id']}/{agent['id']}",
        policy=resolve_agent_policy(inventory, instance, agent),
    )


def _validate_agent_against_policy(
    instance_id: str,
    agent_id: str,
    agent: dict[str, Any],
    policy: dict[str, Any],
) -> list[str]:
    errors: list[str] = []
    prefix = f"{instance_id}/{agent_id}"

    integrations = _agent_integrations(agent)
    int_policy = policy["integrations"]
    allow = set(int_policy["allow"])
    deny = set(int_policy["deny"])

    for integration in integrations:
        if allow and integration not in allow:
            errors.append(f"{prefix}: integration '{integration}' is not allowlisted")
        if integration in deny:
            errors.append(f"{prefix}: integration '{integration}' is denied")

    skills = _normalize_str_list(agent.get("skills") or [])
    skill_sources = _normalize_str_list(agent.get("skill_sources") or ["workspace"])
    skills_policy = policy["skills"]
    s_allow = set(skills_policy["allow"])
    s_deny = set(skills_policy["deny"])
    source_allow = set(skills_policy["allow_sources"])
    source_deny = set(skills_policy["deny_sources"])

    for skill in skills:
        if s_allow and skill not in s_allow:
            errors.append(f"{prefix}: skill '{skill}' is not allowlisted")
        if skill in s_deny:
            errors.append(f"{prefix}: skill '{skill}' is denied")

    for source in skill_sources:
        if source_allow and source not in source_allow:
            errors.append(f"{prefix}: skill source '{source}' is not allowlisted")
        if source in source_deny:
            errors.append(f"{prefix}: skill source '{source}' is denied")

    model = str(agent.get("model") or "")
    if model:
        model_policy = policy["models"]
        provider = model.split("/", 1)[0] if "/" in model else model
        p_allow = set(model_policy["allow_providers"])
        p_deny = set(model_policy["deny_providers"])
        m_allow = set(model_policy["allow_models"])
        m_deny = set(model_policy["deny_models"])

        if p_allow and provider not in p_allow:
            errors.append(
                f"{prefix}: model provider '{provider}' for '{model}' is not allowlisted"
            )
        if provider in p_deny:
            errors.append(f"{prefix}: model provider '{provider}' is denied")

        if m_allow and model not in m_allow:
            errors.append(f"{prefix}: model '{model}' is not allowlisted")
        if model in m_deny:
            errors.append(f"{prefix}: model '{model}' is denied")

    return errors


def _agent_integrations(agent: dict[str, Any]) -> list[str]:
    integrations = _normalize_str_list(agent.get("integrations") or [])
    if integrations:
        return integrations

    # Fallback: derive from bindings when explicit integration list is omitted.
    bindings = agent.get("bindings") or []
    result: list[str] = []
    for binding in bindings:
        if not isinstance(binding, dict):
            continue
        match = binding.get("match") or {}
        channel = match.get("channel")
        if isinstance(channel, str) and channel:
            result.append(channel)
    return _normalize_str_list(result)


def _normalize_policy(policy: dict[str, Any]) -> dict[str, Any]:
    merged = _policy_merge(_empty_policy(), policy)

    merged["integrations"]["allow"] = _normalize_str_list(
        merged["integrations"].get("allow") or []
    )
    merged["integrations"]["deny"] = _normalize_str_list(
        merged["integrations"].get("deny") or []
    )

    merged["skills"]["allow"] = _normalize_str_list(merged["skills"].get("allow") or [])
    merged["skills"]["deny"] = _normalize_str_list(merged["skills"].get("deny") or [])
    merged["skills"]["allow_sources"] = _normalize_str_list(
        merged["skills"].get("allow_sources") or DEFAULT_SKILL_SOURCES
    )
    merged["skills"]["deny_sources"] = _normalize_str_list(
        merged["skills"].get("deny_sources") or []
    )

    merged["models"]["allow_providers"] = _normalize_str_list(
        merged["models"].get("allow_providers") or []
    )
    merged["models"]["deny_providers"] = _normalize_str_list(
        merged["models"].get("deny_providers") or []
    )
    merged["models"]["allow_models"] = _normalize_str_list(
        merged["models"].get("allow_models") or []
    )
    merged["models"]["deny_models"] = _normalize_str_list(
        merged["models"].get("deny_models") or []
    )

    return merged


def _empty_policy() -> dict[str, Any]:
    return {
        "integrations": {
            "allow": [],
            "deny": [],
        },
        "skills": {
            "allow": [],
            "deny": [],
            "allow_sources": DEFAULT_SKILL_SOURCES,
            "deny_sources": [],
        },
        "models": {
            "allow_providers": [],
            "deny_providers": [],
            "allow_models": [],
            "deny_models": [],
        },
    }


def _normalize_str_list(values: list[Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        item = value.strip()
        if not item:
            continue
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _policy_merge(base: Any, override: Any) -> Any:
    if isinstance(base, dict) and isinstance(override, dict):
        merged: dict[str, Any] = {k: v for k, v in base.items()}
        for key, value in override.items():
            if key in merged:
                merged[key] = _policy_merge(merged[key], value)
            else:
                merged[key] = value
        return merged

    if isinstance(override, list):
        return list(override)

    return override
