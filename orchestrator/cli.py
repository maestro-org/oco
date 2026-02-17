"""CLI entrypoint for the Phase 1 OpenClaw orchestrator."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .agents import add_agent, list_agents, remove_agent
from .errors import OrchestratorError
from .inventory import (
    find_instance,
    inventory_path,
    load_inventory_file,
    save_inventory_file,
    validate_inventory,
    get_instances,
)
from .policy import (
    effective_policy_summary,
    list_supported_integrations,
    validate_policies,
)
from .workflow import (
    generate_compose_for_instance,
    health_instance,
    preflight_instance,
    render_instance,
    revisions_for_instance,
    rollback_instance,
    run_compose,
    update_instance,
    validate_only,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="openclaw-orch", description="OpenClaw orchestrator CLI"
    )
    parser.add_argument(
        "--inventory",
        default="inventory/instances.yaml",
        help="Path to inventory YAML (default: inventory/instances.yaml)",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("validate", help="Validate inventory and policies")

    render = sub.add_parser("render", help="Render resolved OpenClaw config")
    render.add_argument("--instance", required=True)
    render.add_argument("--dry-run", action="store_true")

    preflight = sub.add_parser("preflight", help="Run preflight checks for one instance")
    preflight.add_argument("--instance", required=True)

    health = sub.add_parser("health", help="Check runtime health for one instance")
    health.add_argument("--instance", required=True)

    compose = sub.add_parser("compose", help="Docker compose actions")
    compose_sub = compose.add_subparsers(dest="compose_cmd", required=True)
    compose_gen = compose_sub.add_parser("generate", help="Generate compose file")
    compose_gen.add_argument("--instance", required=True)

    for action in ["up", "down", "restart", "ps", "pull"]:
        cmd = compose_sub.add_parser(action, help=f"Compose {action}")
        cmd.add_argument("--instance", required=True)

    agent = sub.add_parser("agent", help="Agent lifecycle commands")
    agent_sub = agent.add_subparsers(dest="agent_cmd", required=True)

    agent_add = agent_sub.add_parser("add", help="Add agent to an instance")
    agent_add.add_argument("--instance", required=True)
    agent_add.add_argument("--agent-id", required=True)
    agent_add.add_argument("--role", choices=["human", "usecase"], default="usecase")
    agent_add.add_argument(
        "--account",
        action="append",
        required=True,
        help="channel:accountId mapping, repeatable",
    )
    agent_add.add_argument("--integration", action="append", default=[])
    agent_add.add_argument("--skill", action="append", default=[])
    agent_add.add_argument("--model")

    agent_remove = agent_sub.add_parser("remove", help="Remove agent from instance")
    agent_remove.add_argument("--instance", required=True)
    agent_remove.add_argument("--agent-id", required=True)
    agent_remove.add_argument("--keep-accounts", action="store_true")

    agent_list = agent_sub.add_parser("list", help="List agents for instance")
    agent_list.add_argument("--instance", required=True)

    policy = sub.add_parser("policy", help="Policy inspection and validation")
    policy_sub = policy.add_subparsers(dest="policy_cmd", required=True)

    policy_sub.add_parser("validate", help="Validate policies")

    policy_effective = policy_sub.add_parser("effective", help="Show effective policy")
    policy_effective.add_argument("--instance", required=True)
    policy_effective.add_argument("--agent-id")

    policy_sub.add_parser(
        "integrations", help="List supported integrations catalog classification"
    )

    deploy = sub.add_parser("deploy", help="Update and rollback workflows")
    deploy_sub = deploy.add_subparsers(dest="deploy_cmd", required=True)

    deploy_update = deploy_sub.add_parser("update", help="Update one instance")
    deploy_update.add_argument("--instance", required=True)
    deploy_update.add_argument("--image-tag")

    deploy_rollback = deploy_sub.add_parser("rollback", help="Rollback one instance")
    deploy_rollback.add_argument("--instance", required=True)
    deploy_rollback.add_argument("--revision", required=True)

    deploy_revisions = deploy_sub.add_parser("revisions", help="List available revisions")
    deploy_revisions.add_argument("--instance", required=True)

    return parser


def print_json(payload: object) -> None:
    print(json.dumps(payload, indent=2))


def cmd_validate(args: argparse.Namespace) -> int:
    inv_path, inventory = validate_only(args.inventory)
    payload = {
        "inventory": str(inv_path),
        "instances": len(get_instances(inventory)),
        "status": "ok",
    }
    print_json(payload)
    return 0


def cmd_render(args: argparse.Namespace) -> int:
    print_json(render_instance(args.inventory, args.instance, dry_run=args.dry_run))
    return 0


def cmd_preflight(args: argparse.Namespace) -> int:
    print_json(preflight_instance(args.inventory, args.instance))
    return 0


def cmd_health(args: argparse.Namespace) -> int:
    print_json(health_instance(args.inventory, args.instance))
    return 0


def cmd_compose(args: argparse.Namespace) -> int:
    action = args.compose_cmd
    if action == "generate":
        print_json(generate_compose_for_instance(args.inventory, args.instance))
        return 0

    print_json(run_compose(args.inventory, args.instance, action=action))
    return 0


def cmd_agent(args: argparse.Namespace) -> int:
    inv_path = inventory_path(args.inventory)
    inventory = load_inventory_file(inv_path)
    validate_inventory(inventory, inv_path)

    instance = find_instance(inventory, args.instance)

    if args.agent_cmd == "add":
        add_agent(
            instance,
            agent_id=args.agent_id,
            role=args.role,
            accounts=args.account,
            integrations=args.integration or [],
            skills=args.skill or [],
            model=args.model,
        )
        save_inventory_file(inv_path, inventory)
        validate_inventory(inventory, inv_path)
        validate_policies(inventory, get_instances(inventory))
        print_json({"status": "added", "instance": args.instance, "agent": args.agent_id})
        return 0

    if args.agent_cmd == "remove":
        remove_agent(instance, args.agent_id, prune_accounts=not args.keep_accounts)
        save_inventory_file(inv_path, inventory)
        validate_inventory(inventory, inv_path)
        validate_policies(inventory, get_instances(inventory))
        print_json({"status": "removed", "instance": args.instance, "agent": args.agent_id})
        return 0

    if args.agent_cmd == "list":
        agents = list_agents(instance)
        payload = []
        for agent in agents:
            payload.append(
                {
                    "id": agent.get("id"),
                    "role": agent.get("role"),
                    "model": agent.get("model"),
                    "integrations": agent.get("integrations") or [],
                    "skills": agent.get("skills") or [],
                    "bindings": len(agent.get("bindings") or []),
                }
            )
        print_json({"instance": args.instance, "agents": payload})
        return 0

    raise OrchestratorError(f"unsupported agent command: {args.agent_cmd}")


def cmd_policy(args: argparse.Namespace) -> int:
    inv_path = inventory_path(args.inventory)
    inventory = load_inventory_file(inv_path)
    validate_inventory(inventory, inv_path)

    if args.policy_cmd == "validate":
        validate_policies(inventory, get_instances(inventory))
        print_json({"status": "ok"})
        return 0

    if args.policy_cmd == "integrations":
        print_json(list_supported_integrations())
        return 0

    if args.policy_cmd == "effective":
        instance = find_instance(inventory, args.instance)
        if args.agent_id:
            agent = None
            for candidate in instance.get("agents") or []:
                if isinstance(candidate, dict) and candidate.get("id") == args.agent_id:
                    agent = candidate
                    break
            if agent is None:
                raise OrchestratorError(
                    f"agent not found: {args.instance}/{args.agent_id}"
                )
            payload = effective_policy_summary(inventory, instance, agent)
        else:
            payload = effective_policy_summary(inventory, instance, None)

        print_json({"scope": payload.scope, "policy": payload.policy})
        return 0

    raise OrchestratorError(f"unsupported policy command: {args.policy_cmd}")


def cmd_deploy(args: argparse.Namespace) -> int:
    if args.deploy_cmd == "update":
        print_json(update_instance(args.inventory, args.instance, args.image_tag))
        return 0

    if args.deploy_cmd == "rollback":
        print_json(rollback_instance(args.inventory, args.instance, args.revision))
        return 0

    if args.deploy_cmd == "revisions":
        print_json({"instance": args.instance, "revisions": revisions_for_instance(args.instance)})
        return 0

    raise OrchestratorError(f"unsupported deploy command: {args.deploy_cmd}")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "validate":
            return cmd_validate(args)
        if args.command == "render":
            return cmd_render(args)
        if args.command == "preflight":
            return cmd_preflight(args)
        if args.command == "health":
            return cmd_health(args)
        if args.command == "compose":
            return cmd_compose(args)
        if args.command == "agent":
            return cmd_agent(args)
        if args.command == "policy":
            return cmd_policy(args)
        if args.command == "deploy":
            return cmd_deploy(args)

        raise OrchestratorError(f"unknown command: {args.command}")
    except OrchestratorError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
