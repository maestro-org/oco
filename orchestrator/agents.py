"""Agent lifecycle mutations for inventory-backed state."""

from __future__ import annotations

from typing import Any

from .errors import ValidationError


def add_agent(
    instance: dict[str, Any],
    agent_id: str,
    role: str,
    accounts: list[str],
    integrations: list[str],
    skills: list[str],
    model: str | None,
) -> None:
    agents = instance.setdefault("agents", [])
    if not isinstance(agents, list):
        raise ValidationError(f"instance '{instance['id']}' has invalid agents list")

    for agent in agents:
        if isinstance(agent, dict) and agent.get("id") == agent_id:
            raise ValidationError(f"agent already exists in instance '{instance['id']}': {agent_id}")

    bindings: list[dict[str, Any]] = []
    normalized_integrations = _unique(integrations)

    for account in accounts:
        if ":" not in account:
            raise ValidationError(
                f"account must follow channel:accountId format, got '{account}'"
            )
        channel, account_id = account.split(":", 1)
        channel = channel.strip()
        account_id = account_id.strip()
        if not channel or not account_id:
            raise ValidationError(
                f"account must follow channel:accountId format, got '{account}'"
            )
        bindings.append(
            {
                "match": {
                    "channel": channel,
                    "accountId": account_id,
                }
            }
        )
        if channel not in normalized_integrations:
            normalized_integrations.append(channel)
        _ensure_channel_account(instance, channel, account_id)

    agent_payload: dict[str, Any] = {
        "id": agent_id,
        "role": role,
        "workspace": agent_id,
        "agent_dir": f"agents/{agent_id}",
        "bindings": bindings,
        "integrations": normalized_integrations,
        "skills": _unique(skills),
        "skill_sources": ["workspace"],
    }
    if model:
        agent_payload["model"] = model

    agents.append(agent_payload)


def remove_agent(instance: dict[str, Any], agent_id: str, prune_accounts: bool = True) -> None:
    agents = instance.get("agents") or []
    if not isinstance(agents, list):
        raise ValidationError(f"instance '{instance['id']}' has invalid agents list")

    remaining: list[dict[str, Any]] = []
    removed: dict[str, Any] | None = None

    for agent in agents:
        if isinstance(agent, dict) and agent.get("id") == agent_id:
            removed = agent
            continue
        remaining.append(agent)

    if removed is None:
        raise ValidationError(f"agent not found: {instance['id']}/{agent_id}")

    instance["agents"] = remaining

    if prune_accounts:
        _prune_unused_accounts(instance)


def list_agents(instance: dict[str, Any]) -> list[dict[str, Any]]:
    agents = instance.get("agents") or []
    if not isinstance(agents, list):
        return []
    return [a for a in agents if isinstance(a, dict)]


def _ensure_channel_account(instance: dict[str, Any], channel: str, account_id: str) -> None:
    channels = instance.setdefault("channels", {})
    if not isinstance(channels, dict):
        raise ValidationError(f"instance '{instance['id']}' has invalid channels mapping")

    cobj = channels.setdefault(channel, {})
    if not isinstance(cobj, dict):
        cobj = {}
        channels[channel] = cobj

    accounts = cobj.setdefault("accounts", {})
    if isinstance(accounts, list):
        accounts = {str(v): {} for v in accounts if isinstance(v, str)}
        cobj["accounts"] = accounts
    if not isinstance(accounts, dict):
        accounts = {}
        cobj["accounts"] = accounts

    accounts.setdefault(account_id, {})


def _prune_unused_accounts(instance: dict[str, Any]) -> None:
    channels = instance.get("channels")
    if not isinstance(channels, dict):
        return

    used: set[str] = set()
    for agent in list_agents(instance):
        for binding in agent.get("bindings") or []:
            if not isinstance(binding, dict):
                continue
            match = binding.get("match") or {}
            if not isinstance(match, dict):
                continue
            channel = match.get("channel")
            account_id = match.get("accountId") or match.get("account_id")
            if isinstance(channel, str) and isinstance(account_id, str):
                used.add(f"{channel}:{account_id}")

    for channel, cobj in list(channels.items()):
        if not isinstance(cobj, dict):
            continue
        accounts = cobj.get("accounts")
        if isinstance(accounts, list):
            accounts = {str(v): {} for v in accounts if isinstance(v, str)}
            cobj["accounts"] = accounts
        if not isinstance(accounts, dict):
            continue

        for account_id in list(accounts.keys()):
            if f"{channel}:{account_id}" not in used:
                del accounts[account_id]


def _unique(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        value = value.strip()
        if not value or value in seen:
            continue
        out.append(value)
        seen.add(value)
    return out
