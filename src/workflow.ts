import { existsSync } from 'node:fs';
import { composeFilePath, composeRunning, generateCompose, runComposeAction } from './compose';
import { buildInstanceContext } from './context';
import { resolveDeploymentProvider } from './deployment';
import { ValidationError } from './errors';
import {
  currentKubernetesContext,
  generateKubernetesManifest,
  kubernetesManifestPath,
  kubernetesRunning,
  resolveKubernetesTarget,
  runKubernetesAction,
  runKubernetesGatewayCommand,
} from './kubernetes';
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

export function deploymentTargetForInstance(
  invFile: string | undefined,
  instanceId: string,
): Record<string, unknown> {
  const { inventory } = loadAndValidate(invFile);
  const instance = findInstance(inventory, instanceId);
  const resolved = resolveDeploymentProvider(inventory);

  if (resolved.provider === 'docker') {
    return {
      instance: instanceId,
      provider: resolved.provider,
      provider_source: resolved.source,
    };
  }

  const target = resolveKubernetesTarget(inventory, instance);
  return {
    instance: instanceId,
    provider: resolved.provider,
    provider_source: resolved.source,
    kubernetes: {
      namespace: target.namespace,
      context: target.context || currentKubernetesContext(target),
      kubeconfig: target.kubeconfig,
      deployment: target.deploymentName,
      service: target.serviceName,
    },
  };
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
  const provider = resolveDeploymentProvider(inventory).provider;
  const runtimePath =
    provider === 'docker'
      ? generateCompose(instance, context, generatedPath)
      : generateKubernetesManifest(inventory, instance, context, generatedPath);

  writeJson(`${context.generatedDir}/openclaw.resolved.json`, rendered);

  return {
    instance: instanceId,
    provider,
    runtime_manifest: runtimePath,
  };
}

export function runCompose(
  invFile: string | undefined,
  instanceId: string,
  action: string,
): Record<string, unknown> {
  const { invPath, inventory } = loadAndValidate(invFile);
  const instance = findInstance(inventory, instanceId);
  const provider = resolveDeploymentProvider(inventory).provider;
  const context = buildInstanceContext(instance, invPath);

  if (['up', 'restart', 'pull'].includes(action)) {
    renderInstanceConfig(instance, invPath, false);
    if (provider === 'docker') {
      generateCompose(instance, context, `${context.configDir}/openclaw.json5`);
    } else {
      generateKubernetesManifest(inventory, instance, context, `${context.configDir}/openclaw.json5`);
    }
  }

  const output =
    provider === 'docker'
      ? runComposeAction(context, action)
      : runKubernetesAction(inventory, instance, context, action);
  return {
    instance: instanceId,
    provider,
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
  const provider = resolveDeploymentProvider(inventory).provider;

  const { context, rendered, generatedPath } = renderInstanceConfig(instance, invPath, false);
  const runtimePath =
    provider === 'docker'
      ? generateCompose(instance, context, generatedPath)
      : generateKubernetesManifest(inventory, instance, context, generatedPath);

  const policies: Record<string, unknown> = {
    instance: effectivePolicySummary(inventory, instance).policy,
    agents: {},
  };

  const agents = Array.isArray(instance.agents) ? instance.agents : [];
  for (const rawAgent of agents) {
    if (!isRecord(rawAgent)) {
      continue;
    }
    const agentId = typeof rawAgent.id === 'string' ? rawAgent.id : '';
    if (!agentId) {
      continue;
    }
    (policies.agents as Record<string, unknown>)[agentId] = effectivePolicySummary(
      inventory,
      instance,
      rawAgent,
    ).policy;
  }

  writeJson(`${context.generatedDir}/effective-policy.json`, policies);
  writeJson(`${context.generatedDir}/render-summary.json`, rendered);

  if (provider === 'docker') {
    const dockerVersion = runCommand(['docker', '--version']).stdout.trim();
    const composeVersion = runCommand(['docker', 'compose', 'version']).stdout.trim();

    return {
      instance: instanceId,
      provider,
      docker: dockerVersion,
      compose: composeVersion,
      generated_config: generatedPath,
      runtime_manifest: runtimePath,
      effective_policy: `${context.generatedDir}/effective-policy.json`,
    };
  }

  const target = resolveKubernetesTarget(inventory, instance);
  const kubectlVersion = runCommand(['kubectl', 'version', '--client']).stdout.trim();
  const kubeContext = target.context || currentKubernetesContext(target);

  return {
    instance: instanceId,
    provider,
    kubectl: kubectlVersion,
    kube_context: kubeContext,
    kube_namespace: target.namespace,
    generated_config: generatedPath,
    runtime_manifest: runtimePath,
    effective_policy: `${context.generatedDir}/effective-policy.json`,
  };
}

export function healthInstance(invFile: string | undefined, instanceId: string): Record<string, unknown> {
  const { invPath, inventory } = loadAndValidate(invFile);
  const instance = findInstance(inventory, instanceId);
  const provider = resolveDeploymentProvider(inventory).provider;
  const context = buildInstanceContext(instance, invPath);

  if (provider === 'docker') {
    const running = composeRunning(context);
    const composePath = composeFilePath(context);
    const ps = existsSync(composePath) ? runComposeAction(context, 'ps') : '';

    return {
      instance: instanceId,
      provider,
      status: running ? 'running' : 'degraded',
      runtime_manifest: composePath,
      ps,
    };
  }

  const running = kubernetesRunning(inventory, instance);
  const manifestPath = kubernetesManifestPath(context);
  const ps = runKubernetesAction(inventory, instance, context, 'ps');

  return {
    instance: instanceId,
    provider,
    status: running ? 'running' : 'degraded',
    runtime_manifest: manifestPath,
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
  const provider = resolveDeploymentProvider(inventory).provider;

  const rendered = renderInstanceConfig(instance, invPath, false);
  const runtimePath =
    provider === 'docker'
      ? generateCompose(instance, rendered.context, rendered.generatedPath)
      : generateKubernetesManifest(inventory, instance, rendered.context, rendered.generatedPath);
  const revision = createRevision(invPath, instance, rendered.rendered, runtimePath);

  if (imageTag) {
    updateImageTag(instance, provider, imageTag);
    saveInventoryFile(invPath, inventory);
  }

  validateInventory(inventory, invPath);
  validatePolicies(inventory, getInstances(inventory));

  const rerender = renderInstanceConfig(instance, invPath, false);
  if (provider === 'docker') {
    generateCompose(instance, rerender.context, rerender.generatedPath);
    const pullOutput = runComposeAction(rerender.context, 'pull');
    const upOutput = runComposeAction(rerender.context, 'up');
    return {
      instance: instanceId,
      provider,
      revision,
      status: composeRunning(rerender.context) ? 'running' : 'degraded',
      pull: pullOutput,
      up: upOutput,
    };
  }

  generateKubernetesManifest(inventory, instance, rerender.context, rerender.generatedPath);
  const upOutput = runKubernetesAction(inventory, instance, rerender.context, 'up');
  const pullOutput = runKubernetesAction(inventory, instance, rerender.context, 'pull');

  return {
    instance: instanceId,
    provider,
    revision,
    status: kubernetesRunning(inventory, instance) ? 'running' : 'degraded',
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
  const provider = resolveDeploymentProvider(inventory).provider;
  const render = renderInstanceConfig(instance, invPath, false);

  if (provider === 'docker') {
    generateCompose(instance, render.context, render.generatedPath);
    const upOutput = runComposeAction(render.context, 'up');
    return {
      instance: instanceId,
      provider,
      revision,
      status: composeRunning(render.context) ? 'running' : 'degraded',
      up: upOutput,
    };
  }

  generateKubernetesManifest(inventory, instance, render.context, render.generatedPath);
  const upOutput = runKubernetesAction(inventory, instance, render.context, 'up');
  return {
    instance: instanceId,
    provider,
    revision,
    status: kubernetesRunning(inventory, instance) ? 'running' : 'degraded',
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
  const provider = resolveDeploymentProvider(inventory).provider;
  if (provider === 'kubernetes') {
    return runKubernetesGatewayCommand(inventory, instance, commandArgs);
  }

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

function updateImageTag(instance: Record<string, unknown>, provider: 'docker' | 'kubernetes', imageTag: string): void {
  if (!isRecord(instance.openclaw)) {
    instance.openclaw = {};
  }
  const openclaw = instance.openclaw as Record<string, unknown>;

  if (provider === 'docker') {
    if (!isRecord(openclaw.docker)) {
      openclaw.docker = {};
    }
    const docker = openclaw.docker as Record<string, unknown>;
    const image = typeof docker.image === 'string' ? docker.image : 'ghcr.io/openclaw/openclaw:latest';
    const base = image.includes(':') ? image.split(':', 1)[0] : image;
    docker.image = `${base}:${imageTag}`;
    return;
  }

  if (!isRecord(openclaw.kubernetes)) {
    openclaw.kubernetes = {};
  }
  const kubernetes = openclaw.kubernetes as Record<string, unknown>;
  const docker = isRecord(openclaw.docker) ? (openclaw.docker as Record<string, unknown>) : {};
  const image =
    (typeof kubernetes.image === 'string' && kubernetes.image.trim()) ||
    (typeof docker.image === 'string' && docker.image.trim()) ||
    'ghcr.io/openclaw/openclaw:latest';
  const base = image.includes(':') ? image.split(':', 1)[0] : image;
  kubernetes.image = `${base}:${imageTag}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
