import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSON5 from 'json5';
import {
  CONTAINER_STATE_DIR,
  CONTAINER_WORKSPACE_DIR,
  buildInstanceContext,
} from './context';
import { ValidationError } from './errors';
import { resolveRelative } from './inventory';
import { InstanceContext } from './types';
import { asRecord, deepMerge, ensureDir, isRecord, writeJson } from './utils';

const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export function renderInstanceConfig(
  instance: Record<string, unknown>,
  invPath: string,
  dryRun = false,
): { context: InstanceContext; rendered: Record<string, unknown>; generatedPath: string } {
  const context = buildInstanceContext(instance, invPath);
  ensureDir(context.generatedDir);
  ensureDir(context.configDir);
  ensureDir(context.stateDir);
  ensureDir(context.workspaceRoot);

  const invDir = resolve(invPath, '..');
  const openclaw = asRecord(instance.openclaw);
  const layers = Array.isArray(openclaw.config_layers) ? openclaw.config_layers : [];

  if (layers.length === 0) {
    throw new ValidationError(`instance '${String(instance.id)}' has no openclaw.config_layers`);
  }

  let merged: unknown = {};
  for (const layer of layers) {
    if (typeof layer !== 'string') {
      continue;
    }
    const layerPath = resolveRelative(invDir, layer);
    const layerData = loadJson5WithIncludes(layerPath, new Set<string>());
    merged = deepMerge(merged, layerData);
  }

  merged = deepMerge(merged, runtimeOverlay(instance, context));
  merged = substituteEnv(merged);

  if (!isRecord(merged)) {
    throw new ValidationError(`resolved config is not an object for instance '${String(instance.id)}'`);
  }

  const generatedPath = resolve(context.generatedDir, 'openclaw.resolved.json');

  if (!dryRun) {
    writeJson(generatedPath, merged);
    writeJson(resolve(context.configDir, 'openclaw.json5'), merged);
  }

  return {
    context,
    rendered: merged,
    generatedPath,
  };
}

function runtimeOverlay(
  instance: Record<string, unknown>,
  context: InstanceContext,
): Record<string, unknown> {
  const host = asRecord(instance.host);
  const channels = asRecord(instance.channels);
  const agents = Array.isArray(instance.agents) ? instance.agents : [];

  const runtimeAgents: Record<string, unknown>[] = [];
  const runtimeBindings: Record<string, unknown>[] = [];
  let defaultAgentModel: string | undefined;

  for (const rawAgent of agents) {
    if (!isRecord(rawAgent)) {
      continue;
    }
    const agentId = String(rawAgent.id ?? '');
    if (!agentId) {
      continue;
    }

    const workspace =
      typeof rawAgent.workspace === 'string' && rawAgent.workspace ? rawAgent.workspace : agentId;
    const agentDir =
      typeof rawAgent.agent_dir === 'string' && rawAgent.agent_dir
        ? rawAgent.agent_dir
        : `agents/${agentId}`;

    const runtimeAgent: Record<string, unknown> = {
      id: agentId,
      workspace: `${CONTAINER_WORKSPACE_DIR}/${workspace}`,
      agentDir: `${CONTAINER_STATE_DIR}/${agentDir}`,
    };

    if (typeof rawAgent.model === 'string' && rawAgent.model.trim()) {
      const model = rawAgent.model.trim();
      runtimeAgent.model = model;
      if (!defaultAgentModel) {
        defaultAgentModel = model;
      }
    }

    runtimeAgents.push(runtimeAgent);

    const bindings = Array.isArray(rawAgent.bindings) ? rawAgent.bindings : [];
    for (const bindingRaw of bindings) {
      if (!isRecord(bindingRaw)) {
        continue;
      }
      runtimeBindings.push({ ...bindingRaw, agentId });
    }
  }

  const runtimeChannels: Record<string, unknown> = {};
  for (const [provider, config] of Object.entries(channels)) {
    runtimeChannels[provider] = normalizeChannelAccounts(config);
  }

  const runtimeAgentConfig: Record<string, unknown> = {
    list: runtimeAgents,
  };
  if (defaultAgentModel) {
    runtimeAgentConfig.defaults = {
      model: {
        primary: defaultAgentModel,
      },
    };
  }

  return {
    gateway: {
      port:
        typeof host.gateway_port === 'number' && Number.isInteger(host.gateway_port)
          ? host.gateway_port
          : context.gatewayPort,
      bind: normalizeGatewayBind(host.bind, context.gatewayBind),
    },
    agents: runtimeAgentConfig,
    bindings: runtimeBindings,
    channels: runtimeChannels,
  };
}

function normalizeGatewayBind(raw: unknown, fallbackDockerBind: string): 'loopback' | 'all' {
  const source = typeof raw === 'string' ? raw : fallbackDockerBind;
  const normalized = source.trim().toLowerCase();

  if (normalized === 'all' || normalized === '0.0.0.0') {
    return 'all';
  }

  return 'loopback';
}

function normalizeChannelAccounts(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) {
    const accounts: Record<string, unknown> = {};
    for (const item of raw) {
      if (typeof item === 'string') {
        accounts[item] = {};
      }
    }
    return { accounts };
  }

  if (!isRecord(raw)) {
    return {};
  }

  const accounts = raw.accounts;
  if (Array.isArray(accounts)) {
    const normalized: Record<string, unknown> = {};
    for (const item of accounts) {
      if (typeof item === 'string') {
        normalized[item] = {};
      }
    }
    return { ...raw, accounts: normalized };
  }

  return { ...raw };
}

function loadJson5WithIncludes(path: string, seen: Set<string>): Record<string, unknown> {
  if (seen.has(path)) {
    throw new ValidationError(`cyclic $include detected at: ${path}`);
  }
  if (!existsSync(path)) {
    throw new ValidationError(`config layer not found: ${path}`);
  }

  const nextSeen = new Set(seen);
  nextSeen.add(path);

  let parsed: unknown;
  try {
    parsed = JSON5.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new ValidationError(`failed to parse config layer ${path}: ${String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new ValidationError(`config layer must be object mapping: ${path}`);
  }

  const includesRaw = parsed.$include;
  const includeList: string[] =
    typeof includesRaw === 'string'
      ? [includesRaw]
      : Array.isArray(includesRaw)
        ? includesRaw.filter((item): item is string => typeof item === 'string')
        : [];

  let base: unknown = {};
  for (const includePath of includeList) {
    const abs = resolveRelative(resolve(path, '..'), includePath);
    const includeData = loadJson5WithIncludes(abs, nextSeen);
    base = deepMerge(base, includeData);
  }

  const body = { ...parsed };
  delete body.$include;

  const merged = deepMerge(base, body);
  return asRecord(merged);
}

function substituteEnv(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => substituteEnv(item));
  }

  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = substituteEnv(item);
    }
    return out;
  }

  if (typeof value === 'string') {
    return value.replace(ENV_PATTERN, (_full, key: string, fallback: string | undefined) => {
      const envValue = process.env[key];
      if (envValue !== undefined) {
        return envValue;
      }
      if (fallback !== undefined) {
        return fallback;
      }
      throw new ValidationError(`missing required environment variable: ${key}`);
    });
  }

  return value;
}
