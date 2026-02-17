import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationError } from './errors';
import { asRecord, isRecord, loadYaml, saveYaml } from './utils';

export const DEFAULT_INVENTORY = 'inventory/instances.yaml';

export function inventoryPath(path?: string): string {
  return path ? resolve(path) : resolve(DEFAULT_INVENTORY);
}

export function loadInventoryFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new ValidationError(`inventory file not found: ${path}`);
  }
  return loadYaml(path);
}

export function saveInventoryFile(path: string, data: Record<string, unknown>): void {
  saveYaml(path, data);
}

export function getDefaults(inventory: Record<string, unknown>): Record<string, unknown> {
  const defaults = inventory.defaults;
  if (defaults === undefined) {
    return {};
  }
  if (!isRecord(defaults)) {
    throw new ValidationError('defaults must be a mapping');
  }
  return defaults;
}

export function getInstances(
  inventory: Record<string, unknown>,
  enabledOnly = false,
): Record<string, unknown>[] {
  const instances = inventory.instances;
  if (instances === undefined) {
    return [];
  }
  if (!Array.isArray(instances)) {
    throw new ValidationError('instances must be a list');
  }

  const typed = instances.filter((x): x is Record<string, unknown> => isRecord(x));
  if (!enabledOnly) {
    return typed;
  }

  return typed.filter((instance) => {
    const enabled = instance.enabled;
    return enabled === undefined ? true : Boolean(enabled);
  });
}

export function findInstance(
  inventory: Record<string, unknown>,
  instanceId: string,
): Record<string, unknown> {
  for (const instance of getInstances(inventory, false)) {
    if (instance.id === instanceId) {
      return instance;
    }
  }
  throw new ValidationError(`instance not found: ${instanceId}`);
}

export function resolveRelative(base: string, maybeRel: string): string {
  return resolve(base, maybeRel);
}

export function validateInventory(inventory: Record<string, unknown>, invPath: string): void {
  const errors: string[] = [];

  if (inventory.version !== 1) {
    errors.push('version must be 1');
  }

  if (!Array.isArray(inventory.instances) || inventory.instances.length === 0) {
    errors.push('instances must be a non-empty list');
    raiseIfErrors(errors);
    return;
  }

  const defaults = getDefaults(inventory);
  const strideRaw = defaults.port_stride;
  const portStride =
    typeof strideRaw === 'number' && Number.isInteger(strideRaw) && strideRaw > 0
      ? strideRaw
      : 20;

  if (strideRaw !== undefined && portStride !== strideRaw) {
    errors.push('defaults.port_stride must be a positive integer');
  }

  const invDir = resolve(invPath, '..');
  const seenIds = new Set<string>();
  const usedRanges: Array<{ start: number; end: number; id: string }> = [];

  const usedConfigPaths = new Map<string, string>();
  const usedStatePaths = new Map<string, string>();
  const usedWorkspacePaths = new Map<string, string>();
  const usedGeneratedPaths = new Map<string, string>();

  for (const [index, raw] of inventory.instances.entries()) {
    const label = `instances[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${label} must be a mapping`);
      continue;
    }

    const instanceId = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!instanceId) {
      errors.push(`${label}.id must be a non-empty string`);
      continue;
    }

    if (seenIds.has(instanceId)) {
      errors.push(`duplicate instance id: ${instanceId}`);
      continue;
    }
    seenIds.add(instanceId);

    const host = requiredMapping(errors, raw, 'host', label);
    const paths = requiredMapping(errors, raw, 'paths', label);
    const openclaw = requiredMapping(errors, raw, 'openclaw', label);

    const port = host.gateway_port;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`${label}.host.gateway_port must be a valid port integer`);
    } else {
      const start = port;
      const end = Math.min(65535, port + portStride - 1);
      for (const prev of usedRanges) {
        if (!(end < prev.start || start > prev.end)) {
          errors.push(
            `port range collision ${instanceId}(${start}-${end}) overlaps ${prev.id}(${prev.start}-${prev.end})`,
          );
        }
      }
      usedRanges.push({ start, end, id: instanceId });
    }

    checkPathUniqueness(errors, invDir, paths, 'config_dir', instanceId, usedConfigPaths, label);
    checkPathUniqueness(errors, invDir, paths, 'state_dir', instanceId, usedStatePaths, label);
    checkPathUniqueness(
      errors,
      invDir,
      paths,
      'workspace_root',
      instanceId,
      usedWorkspacePaths,
      label,
    );
    checkPathUniqueness(
      errors,
      invDir,
      paths,
      'generated_dir',
      instanceId,
      usedGeneratedPaths,
      label,
    );

    const layers = Array.isArray(openclaw.config_layers) ? openclaw.config_layers : [];
    if (layers.length === 0) {
      errors.push(`${label}.openclaw.config_layers must be a non-empty list`);
    } else {
      for (const [i, layer] of layers.entries()) {
        if (typeof layer !== 'string') {
          errors.push(`${label}.openclaw.config_layers[${i}] must be a string`);
          continue;
        }
        const layerPath = resolveRelative(invDir, layer);
        if (!existsSync(layerPath)) {
          errors.push(`missing config layer for ${instanceId}: ${layer}`);
        }
      }
    }

    const agents = Array.isArray(raw.agents) ? raw.agents : [];
    validateAgents(errors, label, agents);
  }

  raiseIfErrors(errors);
}

function validateAgents(errors: string[], label: string, agents: unknown[]): void {
  const seenAgentIds = new Set<string>();
  const seenWorkspaces = new Set<string>();
  const seenAgentDirs = new Set<string>();
  const seenBindings = new Set<string>();

  for (const [index, raw] of agents.entries()) {
    const alabel = `${label}.agents[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${alabel} must be a mapping`);
      continue;
    }

    const agentId = typeof raw.id === 'string' ? raw.id : '';
    if (!agentId) {
      errors.push(`${alabel}.id must be a non-empty string`);
      continue;
    }
    if (seenAgentIds.has(agentId)) {
      errors.push(`duplicate agent id in instance: ${agentId}`);
      continue;
    }
    seenAgentIds.add(agentId);

    const workspace = typeof raw.workspace === 'string' ? raw.workspace : agentId;
    if (!workspace) {
      errors.push(`${alabel}.workspace must be a non-empty string`);
    } else if (seenWorkspaces.has(workspace)) {
      errors.push(`duplicate workspace in instance: ${workspace}`);
    } else {
      seenWorkspaces.add(workspace);
    }

    const agentDir = typeof raw.agent_dir === 'string' ? raw.agent_dir : `agents/${agentId}`;
    if (!agentDir) {
      errors.push(`${alabel}.agent_dir must be a non-empty string`);
    } else if (seenAgentDirs.has(agentDir)) {
      errors.push(`duplicate agent_dir in instance: ${agentDir}`);
    } else {
      seenAgentDirs.add(agentDir);
    }

    const bindings = Array.isArray(raw.bindings) ? raw.bindings : [];
    if (bindings.length === 0) {
      errors.push(`${alabel}.bindings must be a non-empty list`);
      continue;
    }

    for (const [j, bindingRaw] of bindings.entries()) {
      const blabel = `${alabel}.bindings[${j}]`;
      if (!isRecord(bindingRaw)) {
        errors.push(`${blabel} must be a mapping`);
        continue;
      }
      const match = asRecord(bindingRaw.match);
      const channel = typeof match.channel === 'string' ? match.channel : '';
      const account =
        typeof match.accountId === 'string'
          ? match.accountId
          : typeof match.account_id === 'string'
            ? match.account_id
            : '';

      if (!channel || !account) {
        errors.push(`${blabel}.match requires channel and accountId/account_id for routing`);
        continue;
      }

      const key = `${channel}:${account}`;
      if (seenBindings.has(key)) {
        errors.push(`duplicate channel/account binding in instance: ${key}`);
      } else {
        seenBindings.add(key);
      }
    }
  }
}

function requiredMapping(
  errors: string[],
  obj: Record<string, unknown>,
  key: string,
  parent: string,
): Record<string, unknown> {
  const value = obj[key];
  if (!isRecord(value)) {
    errors.push(`${parent}.${key} must be a mapping`);
    return {};
  }
  return value;
}

function checkPathUniqueness(
  errors: string[],
  invDir: string,
  paths: Record<string, unknown>,
  key: string,
  instanceId: string,
  used: Map<string, string>,
  label: string,
): void {
  const raw = paths[key];
  if (typeof raw !== 'string' || !raw) {
    errors.push(`${label}.paths.${key} must be a non-empty string`);
    return;
  }

  const resolved = resolveRelative(invDir, raw);
  const prev = used.get(resolved);
  if (prev) {
    errors.push(`path collision for ${key}: ${instanceId} shares ${raw} with ${prev}`);
  }
  used.set(resolved, instanceId);
}

function raiseIfErrors(errors: string[]): void {
  if (errors.length === 0) {
    return;
  }
  throw new ValidationError(`Inventory validation failed:\n- ${errors.join('\n- ')}`);
}
