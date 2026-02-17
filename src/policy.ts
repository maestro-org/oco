import { ValidationError } from './errors';
import { AnyMap, PolicyResult } from './types';
import { asRecord, isRecord, uniqueStrings } from './utils';

export const CORE_INTEGRATIONS = [
  'whatsapp',
  'telegram',
  'discord',
  'slack',
  'signal',
  'google-chat',
  'irc',
  'imessage',
  'bluebubbles',
  'webchat',
] as const;

export const PLUGIN_INTEGRATIONS = [
  'mattermost',
  'teams',
  'microsoft-teams',
  'feishu',
  'lark',
  'line',
  'matrix',
  'zalo',
  'zalo-personal',
  'nextcloud-talk',
  'nostr',
  'twitch',
  'tlon',
] as const;

export const CUSTOM_ONLY_INTEGRATIONS = ['notion', 'heygen'] as const;

export const DEFAULT_SKILL_SOURCES = ['bundled', 'managed', 'workspace', 'local', 'shared'];

export function listSupportedIntegrations(): Record<string, string[]> {
  return {
    core: [...CORE_INTEGRATIONS].sort(),
    plugin: [...PLUGIN_INTEGRATIONS].sort(),
    custom_only: [...CUSTOM_ONLY_INTEGRATIONS].sort(),
  };
}

export function resolveOrgPolicy(inventory: Record<string, unknown>): AnyMap {
  const defaults = asRecord(inventory.defaults);
  let policy = policyMerge(emptyPolicy(), asRecord(defaults.policy));
  policy = policyMerge(policy, asRecord(inventory.policy));
  return normalizePolicy(asRecord(policy));
}

export function resolveInstancePolicy(
  inventory: Record<string, unknown>,
  instance: Record<string, unknown>,
): AnyMap {
  return normalizePolicy(asRecord(policyMerge(resolveOrgPolicy(inventory), asRecord(instance.policy))));
}

export function resolveAgentPolicy(
  inventory: Record<string, unknown>,
  instance: Record<string, unknown>,
  agent: Record<string, unknown>,
): AnyMap {
  return normalizePolicy(
    asRecord(policyMerge(resolveInstancePolicy(inventory, instance), asRecord(agent.policy))),
  );
}

export function validatePolicies(
  inventory: Record<string, unknown>,
  instances: Record<string, unknown>[],
): void {
  const errors: string[] = [];

  for (const instance of instances) {
    const instanceId = String(instance.id ?? '<unknown>');
    const agents = Array.isArray(instance.agents) ? instance.agents : [];

    for (const agentRaw of agents) {
      if (!isRecord(agentRaw)) {
        continue;
      }
      const agentId = String(agentRaw.id ?? '<unknown>');
      const policy = resolveAgentPolicy(inventory, instance, agentRaw);
      errors.push(...validateAgentAgainstPolicy(instanceId, agentId, agentRaw, policy));
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(`Policy validation failed:\n- ${errors.join('\n- ')}`);
  }
}

export function effectivePolicySummary(
  inventory: Record<string, unknown>,
  instance: Record<string, unknown>,
  agent?: Record<string, unknown>,
): PolicyResult {
  if (!agent) {
    return {
      scope: `instance:${String(instance.id)}`,
      policy: resolveInstancePolicy(inventory, instance),
    };
  }

  return {
    scope: `agent:${String(instance.id)}/${String(agent.id)}`,
    policy: resolveAgentPolicy(inventory, instance, agent),
  };
}

function validateAgentAgainstPolicy(
  instanceId: string,
  agentId: string,
  agent: Record<string, unknown>,
  policy: AnyMap,
): string[] {
  const errors: string[] = [];
  const prefix = `${instanceId}/${agentId}`;

  const integrations = agentIntegrations(agent);
  const integrationsPolicy = asRecord(policy.integrations);
  const integrationAllow = new Set(toStringList(integrationsPolicy.allow));
  const integrationDeny = new Set(toStringList(integrationsPolicy.deny));

  for (const integration of integrations) {
    if (integrationAllow.size > 0 && !integrationAllow.has(integration)) {
      errors.push(`${prefix}: integration '${integration}' is not allowlisted`);
    }
    if (integrationDeny.has(integration)) {
      errors.push(`${prefix}: integration '${integration}' is denied`);
    }
  }

  const skills = toStringList(agent.skills);
  const skillSources = toStringList(agent.skill_sources, ['workspace']);
  const skillsPolicy = asRecord(policy.skills);
  const skillAllow = new Set(toStringList(skillsPolicy.allow));
  const skillDeny = new Set(toStringList(skillsPolicy.deny));
  const sourceAllow = new Set(toStringList(skillsPolicy.allow_sources));
  const sourceDeny = new Set(toStringList(skillsPolicy.deny_sources));

  for (const skill of skills) {
    if (skillAllow.size > 0 && !skillAllow.has(skill)) {
      errors.push(`${prefix}: skill '${skill}' is not allowlisted`);
    }
    if (skillDeny.has(skill)) {
      errors.push(`${prefix}: skill '${skill}' is denied`);
    }
  }

  for (const source of skillSources) {
    if (sourceAllow.size > 0 && !sourceAllow.has(source)) {
      errors.push(`${prefix}: skill source '${source}' is not allowlisted`);
    }
    if (sourceDeny.has(source)) {
      errors.push(`${prefix}: skill source '${source}' is denied`);
    }
  }

  const model = typeof agent.model === 'string' ? agent.model : '';
  if (model) {
    const modelsPolicy = asRecord(policy.models);
    const provider = model.includes('/') ? model.split('/', 1)[0] : model;

    const providerAllow = new Set(toStringList(modelsPolicy.allow_providers));
    const providerDeny = new Set(toStringList(modelsPolicy.deny_providers));
    const modelAllow = new Set(toStringList(modelsPolicy.allow_models));
    const modelDeny = new Set(toStringList(modelsPolicy.deny_models));

    if (providerAllow.size > 0 && !providerAllow.has(provider)) {
      errors.push(`${prefix}: model provider '${provider}' for '${model}' is not allowlisted`);
    }
    if (providerDeny.has(provider)) {
      errors.push(`${prefix}: model provider '${provider}' is denied`);
    }

    if (modelAllow.size > 0 && !modelAllow.has(model)) {
      errors.push(`${prefix}: model '${model}' is not allowlisted`);
    }
    if (modelDeny.has(model)) {
      errors.push(`${prefix}: model '${model}' is denied`);
    }
  }

  return errors;
}

function agentIntegrations(agent: Record<string, unknown>): string[] {
  const explicit = toStringList(agent.integrations);
  if (explicit.length > 0) {
    return explicit;
  }

  const bindings = Array.isArray(agent.bindings) ? agent.bindings : [];
  const derived: string[] = [];

  for (const binding of bindings) {
    if (!isRecord(binding)) {
      continue;
    }
    const match = asRecord(binding.match);
    const channel = typeof match.channel === 'string' ? match.channel : '';
    if (channel) {
      derived.push(channel);
    }
  }

  return uniqueStrings(derived);
}

function normalizePolicy(policy: AnyMap): AnyMap {
  const merged = asRecord(policyMerge(emptyPolicy(), policy));

  const integrations = asRecord(merged.integrations);
  integrations.allow = toStringList(integrations.allow);
  integrations.deny = toStringList(integrations.deny);

  const skills = asRecord(merged.skills);
  skills.allow = toStringList(skills.allow);
  skills.deny = toStringList(skills.deny);
  skills.allow_sources = toStringList(skills.allow_sources, DEFAULT_SKILL_SOURCES);
  skills.deny_sources = toStringList(skills.deny_sources);

  const models = asRecord(merged.models);
  models.allow_providers = toStringList(models.allow_providers);
  models.deny_providers = toStringList(models.deny_providers);
  models.allow_models = toStringList(models.allow_models);
  models.deny_models = toStringList(models.deny_models);

  merged.integrations = integrations;
  merged.skills = skills;
  merged.models = models;

  return merged;
}

function emptyPolicy(): AnyMap {
  return {
    integrations: { allow: [], deny: [] },
    skills: {
      allow: [],
      deny: [],
      allow_sources: [...DEFAULT_SKILL_SOURCES],
      deny_sources: [],
    },
    models: {
      allow_providers: [],
      deny_providers: [],
      allow_models: [],
      deny_models: [],
    },
  };
}

function toStringList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) {
    return uniqueStrings(fallback);
  }

  const items = value
    .map((item) => (typeof item === 'string' ? item : ''))
    .filter((item) => item.length > 0);

  return uniqueStrings(items);
}

function policyMerge(base: unknown, override: unknown): unknown {
  if (isRecord(base) && isRecord(override)) {
    const merged: AnyMap = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (key in merged) {
        merged[key] = policyMerge(merged[key], value);
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }

  if (Array.isArray(override)) {
    return [...override];
  }

  return override ?? base;
}
