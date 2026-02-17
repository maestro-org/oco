import { ValidationError } from './errors';
import { isRecord, uniqueStrings } from './utils';

export function addAgent(
  instance: Record<string, unknown>,
  agentId: string,
  role: 'human' | 'usecase',
  accounts: string[],
  integrations: string[],
  skills: string[],
  model?: string,
): void {
  if (!Array.isArray(instance.agents)) {
    instance.agents = [];
  }

  const agents = instance.agents as unknown[];

  for (const agent of agents) {
    if (isRecord(agent) && agent.id === agentId) {
      throw new ValidationError(`agent already exists in instance '${String(instance.id)}': ${agentId}`);
    }
  }

  const bindings: Record<string, unknown>[] = [];
  const normalizedIntegrations = uniqueStrings(integrations);

  for (const account of accounts) {
    if (!account.includes(':')) {
      throw new ValidationError(`account must follow channel:accountId format, got '${account}'`);
    }

    const [channelRaw, accountRaw] = account.split(':', 2);
    const channel = channelRaw.trim();
    const accountId = accountRaw.trim();

    if (!channel || !accountId) {
      throw new ValidationError(`account must follow channel:accountId format, got '${account}'`);
    }

    bindings.push({
      match: {
        channel,
        accountId,
      },
    });

    if (!normalizedIntegrations.includes(channel)) {
      normalizedIntegrations.push(channel);
    }

    ensureChannelAccount(instance, channel, accountId);
  }

  const agent: Record<string, unknown> = {
    id: agentId,
    role,
    workspace: agentId,
    agent_dir: `agents/${agentId}`,
    bindings,
    integrations: normalizedIntegrations,
    skills: uniqueStrings(skills),
    skill_sources: ['workspace'],
  };

  if (model) {
    agent.model = model;
  }

  agents.push(agent);
}

export function removeAgent(
  instance: Record<string, unknown>,
  agentId: string,
  pruneAccounts = true,
): void {
  const agents = Array.isArray(instance.agents) ? instance.agents : [];
  const remaining: unknown[] = [];
  let removed = false;

  for (const agent of agents) {
    if (isRecord(agent) && agent.id === agentId) {
      removed = true;
      continue;
    }
    remaining.push(agent);
  }

  if (!removed) {
    throw new ValidationError(`agent not found: ${String(instance.id)}/${agentId}`);
  }

  instance.agents = remaining;

  if (pruneAccounts) {
    pruneUnusedAccounts(instance);
  }
}

export function listAgents(instance: Record<string, unknown>): Record<string, unknown>[] {
  const agents = Array.isArray(instance.agents) ? instance.agents : [];
  return agents.filter((agent): agent is Record<string, unknown> => isRecord(agent));
}

function ensureChannelAccount(
  instance: Record<string, unknown>,
  channel: string,
  accountId: string,
): void {
  if (!isRecord(instance.channels)) {
    instance.channels = {};
  }

  const channels = instance.channels as Record<string, unknown>;
  if (!isRecord(channels[channel])) {
    channels[channel] = {};
  }

  const channelConfig = channels[channel] as Record<string, unknown>;
  const rawAccounts = channelConfig.accounts;

  if (Array.isArray(rawAccounts)) {
    const normalized: Record<string, unknown> = {};
    for (const value of rawAccounts) {
      if (typeof value === 'string') {
        normalized[value] = {};
      }
    }
    channelConfig.accounts = normalized;
  }

  if (!isRecord(channelConfig.accounts)) {
    channelConfig.accounts = {};
  }

  const accounts = channelConfig.accounts as Record<string, unknown>;
  if (!(accountId in accounts)) {
    accounts[accountId] = {};
  }
}

function pruneUnusedAccounts(instance: Record<string, unknown>): void {
  if (!isRecord(instance.channels)) {
    return;
  }

  const channels = instance.channels as Record<string, unknown>;
  const used = new Set<string>();

  for (const agent of listAgents(instance)) {
    const bindings = Array.isArray(agent.bindings) ? agent.bindings : [];
    for (const rawBinding of bindings) {
      if (!isRecord(rawBinding)) {
        continue;
      }
      const match = isRecord(rawBinding.match) ? rawBinding.match : {};
      const channel = typeof match.channel === 'string' ? match.channel : '';
      const accountId =
        typeof match.accountId === 'string'
          ? match.accountId
          : typeof match.account_id === 'string'
            ? match.account_id
            : '';
      if (channel && accountId) {
        used.add(`${channel}:${accountId}`);
      }
    }
  }

  for (const [channel, rawConfig] of Object.entries(channels)) {
    if (!isRecord(rawConfig)) {
      continue;
    }

    if (Array.isArray(rawConfig.accounts)) {
      const normalized: Record<string, unknown> = {};
      for (const value of rawConfig.accounts) {
        if (typeof value === 'string') {
          normalized[value] = {};
        }
      }
      rawConfig.accounts = normalized;
    }

    if (!isRecord(rawConfig.accounts)) {
      continue;
    }

    const accounts = rawConfig.accounts as Record<string, unknown>;
    for (const accountId of Object.keys(accounts)) {
      if (!used.has(`${channel}:${accountId}`)) {
        delete accounts[accountId];
      }
    }
  }
}
