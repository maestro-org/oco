import { existsSync } from 'node:fs';
import { composeFilePath, composeRunning, generateCompose, runComposeAction } from './compose';
import { buildInstanceContext } from './context';
import { ValidationError } from './errors';
import {
  findInstance,
  getInstances,
  inventoryPath,
  loadInventoryFile,
  saveInventoryFile,
  validateInventory,
} from './inventory';
import { effectivePolicySummary, validatePolicies } from './policy';
import { renderInstanceConfig } from './render';
import { createRevision, listRevisions, loadRevisionInstance } from './revisions';
import { runCommand, writeJson } from './utils';

export function loadAndValidate(invFile?: string): {
  invPath: string;
  inventory: Record<string, unknown>;
} {
  const invPath = inventoryPath(invFile);
  const inventory = loadInventoryFile(invPath);
  validateInventory(inventory, invPath);
  validatePolicies(inventory, getInstances(inventory));
  return { invPath, inventory };
}

export function validateOnly(invFile?: string): { invPath: string; inventory: Record<string, unknown> } {
  return loadAndValidate(invFile);
}

export function renderInstance(
  invFile: string | undefined,
  instanceId: string,
  dryRun = false,
): Record<string, unknown> {
  const { invPath, inventory } = loadAndValidate(invFile);
  const instance = findInstance(inventory, instanceId);

  const { context, rendered, generatedPath } = renderInstanceConfig(instance, invPath, dryRun);

  if (dryRun) {
    const agents = ((rendered.agents as Record<string, unknown>)?.list as unknown[]) ?? [];
    const bindings = (rendered.bindings as unknown[]) ?? [];
    const channels = Object.keys((rendered.channels as Record<string, unknown>) ?? {}).length;

    return {
      instance: instanceId,
      dry_run: true,
      generated_path: generatedPath,
      summary: {
        agents: agents.length,
        bindings: bindings.length,
        channels,
      },
    };
  }

  return {
    instance: instanceId,
    dry_run: false,
    generated_path: generatedPath,
    runtime_config_path: `${context.configDir}/openclaw.json5`,
  };
}

export function generateComposeForInstance(
  invFile: string | undefined,
  instanceId: string,
): Record<string, unknown> {
  const { invPath, inventory } = loadAndValidate(invFile);
  const instance = findInstance(inventory, instanceId);

  const { context, rendered, generatedPath } = renderInstanceConfig(instance, invPath, false);
  const composePath = generateCompose(instance, context, generatedPath);

  writeJson(`${context.generatedDir}/openclaw.resolved.json`, rendered);

  return {
    instance: instanceId,
    compose_path: composePath,
  };
}

export function runCompose(
  invFile: string | undefined,
  instanceId: string,
  action: string,
): Record<string, unknown> {
  const { invPath, inventory } = loadAndValidate(invFile);
  const instance = findInstance(inventory, instanceId);
  const context = buildInstanceContext(instance, invPath);

  if (['up', 'restart', 'pull'].includes(action)) {
    renderInstanceConfig(instance, invPath, false);
    generateCompose(instance, context, `${context.configDir}/openclaw.json5`);
  }

  const output = runComposeAction(context, action);
  return {
    instance: instanceId,
    action,
    output,
  };
}

export function pairingList(
  invFile: string | undefined,
  instanceId: string,
  channel: string,
  accountId: string,
  jsonOutput = false,
): Record<string, unknown> {
  const args = ['pairing', 'list', channel, '--account', accountId];
  if (jsonOutput) {
    args.push('--json');
  }

  const raw = runGatewayCommand(invFile, instanceId, args);
  return {
    instance: instanceId,
    channel,
    account: accountId,
    output: jsonOutput ? parseOutputJson(raw) : raw,
  };
}

export function pairingApprove(
  invFile: string | undefined,
  instanceId: string,
  channel: string,
  code: string,
  accountId: string,
): Record<string, unknown> {
  const raw = runGatewayCommand(invFile, instanceId, [
    'pairing',
    'approve',
    channel,
    code,
    '--account',
    accountId,
  ]);

  return {
    instance: instanceId,
    channel,
    account: accountId,
    output: raw,
  };
}

export function preflightInstance(
  invFile: string | undefined,
  instanceId: string,
): Record<string, unknown> {
  const { invPath, inventory } = loadAndValidate(invFile);
  const instance = findInstance(inventory, instanceId);

  const dockerVersion = runCommand(['docker', '--version']).stdout.trim();
  const composeVersion = runCommand(['docker', 'compose', 'version']).stdout.trim();

  const { context, rendered, generatedPath } = renderInstanceConfig(instance, invPath, false);
  const composePath = generateCompose(instance, context, generatedPath);

  const policies: Record<string, unknown> = {
    instance: effectivePolicySummary(inventory, instance).policy,
    agents: {},
  };

  const agents = Array.isArray(instance.agents) ? instance.agents : [];
  for (const rawAgent of agents) {
    if (typeof rawAgent !== 'object' || rawAgent === null || Array.isArray(rawAgent)) {
      continue;
    }
    const agent = rawAgent as Record<string, unknown>;
    const agentId = typeof agent.id === 'string' ? agent.id : '';
    if (!agentId) {
      continue;
    }
    (policies.agents as Record<string, unknown>)[agentId] = effectivePolicySummary(
      inventory,
      instance,
      agent,
    ).policy;
  }

  writeJson(`${context.generatedDir}/effective-policy.json`, policies);
  writeJson(`${context.generatedDir}/render-summary.json`, rendered);

  return {
    instance: instanceId,
    docker: dockerVersion,
    compose: composeVersion,
    generated_config: generatedPath,
    generated_compose: composePath,
    effective_policy: `${context.generatedDir}/effective-policy.json`,
  };
}

export function healthInstance(invFile: string | undefined, instanceId: string): Record<string, unknown> {
  const { invPath, inventory } = loadAndValidate(invFile);
  const instance = findInstance(inventory, instanceId);
  const context = buildInstanceContext(instance, invPath);

  const running = composeRunning(context);
  const composePath = composeFilePath(context);
  const ps = existsSync(composePath) ? runComposeAction(context, 'ps') : '';

  return {
    instance: instanceId,
    status: running ? 'running' : 'degraded',
    compose: composePath,
    ps,
  };
}

export function updateInstance(
  invFile: string | undefined,
  instanceId: string,
  imageTag?: string,
): Record<string, unknown> {
  const { invPath, inventory } = loadAndValidate(invFile);
  const instance = findInstance(inventory, instanceId);

  const { context, rendered, generatedPath } = renderInstanceConfig(instance, invPath, false);
  const composePath = generateCompose(instance, context, generatedPath);
  const revision = createRevision(invPath, instance, rendered, composePath);

  if (imageTag) {
    if (!isRecord(instance.openclaw)) {
      instance.openclaw = {};
    }
    const openclaw = instance.openclaw as Record<string, unknown>;

    if (!isRecord(openclaw.docker)) {
      openclaw.docker = {};
    }
    const docker = openclaw.docker as Record<string, unknown>;

    const image = typeof docker.image === 'string' ? docker.image : 'ghcr.io/openclaw/openclaw:latest';
    const base = image.includes(':') ? image.split(':', 1)[0] : image;
    docker.image = `${base}:${imageTag}`;

    saveInventoryFile(invPath, inventory);
  }

  validateInventory(inventory, invPath);
  validatePolicies(inventory, getInstances(inventory));

  const rerender = renderInstanceConfig(instance, invPath, false);
  generateCompose(instance, rerender.context, rerender.generatedPath);

  const pullOutput = runComposeAction(rerender.context, 'pull');
  const upOutput = runComposeAction(rerender.context, 'up');

  return {
    instance: instanceId,
    revision,
    status: composeRunning(rerender.context) ? 'running' : 'degraded',
    pull: pullOutput,
    up: upOutput,
  };
}

export function rollbackInstance(
  invFile: string | undefined,
  instanceId: string,
  revision: string,
): Record<string, unknown> {
  const invPath = inventoryPath(invFile);
  const inventory = loadInventoryFile(invPath);
  const snapshot = loadRevisionInstance(instanceId, revision);

  if (!Array.isArray(inventory.instances)) {
    throw new ValidationError('instances must be a list');
  }

  let replaced = false;
  for (let i = 0; i < inventory.instances.length; i += 1) {
    const raw = inventory.instances[i];
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const item = raw as Record<string, unknown>;
      if (item.id === instanceId) {
        inventory.instances[i] = snapshot;
        replaced = true;
        break;
      }
    }
  }

  if (!replaced) {
    throw new ValidationError(`instance not found in current inventory: ${instanceId}`);
  }

  saveInventoryFile(invPath, inventory);
  validateInventory(inventory, invPath);
  validatePolicies(inventory, getInstances(inventory));

  const instance = findInstance(inventory, instanceId);
  const render = renderInstanceConfig(instance, invPath, false);
  generateCompose(instance, render.context, render.generatedPath);

  const upOutput = runComposeAction(render.context, 'up');

  return {
    instance: instanceId,
    revision,
    status: composeRunning(render.context) ? 'running' : 'degraded',
    up: upOutput,
  };
}

export function revisionsForInstance(instanceId: string): string[] {
  return listRevisions(instanceId);
}

function runGatewayCommand(
  invFile: string | undefined,
  instanceId: string,
  commandArgs: string[],
): string {
  const { invPath, inventory } = loadAndValidate(invFile);
  const instance = findInstance(inventory, instanceId);
  const context = buildInstanceContext(instance, invPath);
  const composePath = composeFilePath(context);

  if (!existsSync(composePath)) {
    throw new ValidationError(
      `compose file not generated: ${composePath}. Run 'oco compose up --instance ${instanceId}' first.`,
    );
  }

  const service = resolveComposeService(instance);
  const args = [
    'docker',
    'compose',
    '-f',
    composePath,
    'exec',
    '-T',
    service,
    'node',
    '/app/openclaw.mjs',
    ...commandArgs,
  ];

  const result = runCommand(args);
  return (result.stdout || result.stderr).trim();
}

function resolveComposeService(instance: Record<string, unknown>): string {
  const openclaw = isRecord(instance.openclaw) ? instance.openclaw : {};
  const docker = isRecord(openclaw.docker) ? openclaw.docker : {};

  if (typeof docker.service_name === 'string' && docker.service_name.trim()) {
    return docker.service_name.trim();
  }

  return 'gateway';
}

function parseOutputJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
