import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import {
  CONTAINER_CONFIG_DIR,
  CONTAINER_STATE_DIR,
  CONTAINER_WORKSPACE_DIR,
} from './context';
import { resolveOrgKubernetesDefaults } from './deployment';
import { ValidationError } from './errors';
import { InstanceContext } from './types';
import { asRecord, ensureDir, runCommand } from './utils';

export interface KubernetesTarget {
  namespace: string;
  context?: string;
  kubeconfig?: string;
  deploymentName: string;
  serviceName: string;
  containerName: string;
  instanceLabel: string;
}

export const DEFAULT_KUBERNETES_MANIFEST = 'kubernetes.yaml';

export function kubernetesManifestPath(context: InstanceContext): string {
  return resolve(context.generatedDir, DEFAULT_KUBERNETES_MANIFEST);
}

export function resolveKubernetesTarget(
  inventory: Record<string, unknown>,
  instance: Record<string, unknown>,
): KubernetesTarget {
  const defaults = resolveOrgKubernetesDefaults(inventory);
  const openclaw = asRecord(instance.openclaw);
  const kubernetes = asRecord(openclaw.kubernetes);

  const id = normalizeString(instance.id) ?? 'instance';
  const instanceLabel = sanitizeLabelValue(id);
  const baseName = sanitizeKubernetesName(`oco-${id}`);

  const namespace = normalizeString(kubernetes.namespace) ?? defaults.namespace;
  const context = normalizeString(kubernetes.context) ?? defaults.context;
  const kubeconfig = normalizeString(kubernetes.kubeconfig) ?? defaults.kubeconfig;
  const deploymentName = normalizeString(kubernetes.deployment_name) ?? baseName;
  const serviceName = normalizeString(kubernetes.service_name) ?? deploymentName;
  const containerName = normalizeString(kubernetes.container_name) ?? baseName;

  return {
    namespace,
    context,
    kubeconfig,
    deploymentName,
    serviceName,
    containerName,
    instanceLabel,
  };
}

export function generateKubernetesManifest(
  inventory: Record<string, unknown>,
  instance: Record<string, unknown>,
  context: InstanceContext,
  configPath: string,
): string {
  ensureDir(context.generatedDir);

  const target = resolveKubernetesTarget(inventory, instance);
  const openclaw = asRecord(instance.openclaw);
  const docker = asRecord(openclaw.docker);
  const kubernetes = asRecord(openclaw.kubernetes);

  const image =
    normalizeString(kubernetes.image) ??
    normalizeString(docker.image) ??
    'ghcr.io/openclaw/openclaw:latest';
  const replicas = readPositiveInt(kubernetes.replicas, 1);
  const imagePullPolicy = normalizeString(kubernetes.image_pull_policy) ?? 'IfNotPresent';
  const serviceType = normalizeString(kubernetes.service_type) ?? 'ClusterIP';
  const nodePort = readNodePort(kubernetes.node_port);
  const command = kubernetes.command ?? docker.command;

  if (command !== undefined && typeof command !== 'string' && !Array.isArray(command)) {
    throw new ValidationError('openclaw.kubernetes.command must be string or list');
  }

  const env: Record<string, string> = {
    OPENCLAW_CONFIG_PATH: `${CONTAINER_CONFIG_DIR}/openclaw.json5`,
    OPENCLAW_STATE_DIR: CONTAINER_STATE_DIR,
    OPENCLAW_WORKSPACE_ROOT: CONTAINER_WORKSPACE_DIR,
  };

  injectProviderApiKeys(env);
  applyEnvironmentMap(env, docker.environment);
  applyEnvironmentMap(env, kubernetes.environment);

  const labels = {
    'app.kubernetes.io/name': 'openclaw',
    'app.kubernetes.io/component': 'gateway',
    'app.kubernetes.io/managed-by': 'oco',
    'app.kubernetes.io/instance': target.instanceLabel,
    ...stringMap(kubernetes.labels),
  };

  const containerSpec: Record<string, unknown> = {
    name: target.containerName,
    image,
    imagePullPolicy,
    ports: [{ containerPort: context.gatewayPort, name: 'gateway' }],
    env: Object.entries(env).map(([name, value]) => ({ name, value })),
    volumeMounts: [
      {
        name: 'config',
        mountPath: `${CONTAINER_CONFIG_DIR}/openclaw.json5`,
        subPath: 'openclaw.json5',
      },
      {
        name: 'state',
        mountPath: CONTAINER_STATE_DIR,
      },
      {
        name: 'workspace',
        mountPath: CONTAINER_WORKSPACE_DIR,
      },
    ],
  };

  const commandArray = commandToArray(command);
  if (commandArray) {
    containerSpec.command = commandArray;
  }

  const deploymentSpec: Record<string, unknown> = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: target.deploymentName,
      namespace: target.namespace,
      labels,
    },
    spec: {
      replicas,
      selector: {
        matchLabels: {
          'app.kubernetes.io/instance': target.instanceLabel,
          'app.kubernetes.io/component': 'gateway',
        },
      },
      template: {
        metadata: {
          labels,
        },
        spec: {
          containers: [containerSpec],
          volumes: [
            {
              name: 'config',
              configMap: {
                name: `${target.deploymentName}-config`,
              },
            },
            pvcOrEmptyDir('state', normalizeString(kubernetes.state_pvc)),
            pvcOrEmptyDir('workspace', normalizeString(kubernetes.workspace_pvc)),
          ],
        },
      },
    },
  };

  const servicePort: Record<string, unknown> = {
    name: 'gateway',
    port: context.gatewayPort,
    targetPort: context.gatewayPort,
  };

  if (serviceType === 'NodePort' && nodePort !== undefined) {
    servicePort.nodePort = nodePort;
  }

  const serviceSpec: Record<string, unknown> = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: target.serviceName,
      namespace: target.namespace,
      labels,
    },
    spec: {
      type: serviceType,
      selector: {
        'app.kubernetes.io/instance': target.instanceLabel,
        'app.kubernetes.io/component': 'gateway',
      },
      ports: [servicePort],
    },
  };

  if (!existsSync(configPath)) {
    throw new ValidationError(`rendered config missing: ${configPath}`);
  }
  const configData = readFileSync(configPath, 'utf-8');

  const configMapSpec: Record<string, unknown> = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: `${target.deploymentName}-config`,
      namespace: target.namespace,
      labels,
    },
    data: {
      'openclaw.json5': configData,
    },
  };

  const docs: Record<string, unknown>[] = [];
  if (target.namespace !== 'default' && shouldCreateNamespace(kubernetes.create_namespace)) {
    docs.push({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: target.namespace,
      },
    });
  }
  docs.push(configMapSpec, deploymentSpec, serviceSpec);

  const manifest = docs
    .map((doc) => YAML.stringify(doc).trimEnd())
    .join('\n---\n')
    .concat('\n');

  const output = kubernetesManifestPath(context);
  writeFileSync(output, manifest, 'utf-8');

  const debugConfig = resolve(context.generatedDir, 'openclaw.resolved.json');
  if (!existsSync(debugConfig)) {
    writeFileSync(debugConfig, configData, 'utf-8');
  }

  return output;
}

export function runKubernetesAction(
  inventory: Record<string, unknown>,
  instance: Record<string, unknown>,
  context: InstanceContext,
  action: string,
): string {
  const normalized = action.trim().toLowerCase();
  if (!['up', 'down', 'restart', 'ps', 'pull', 'logs'].includes(normalized)) {
    throw new ValidationError(`unsupported compose action: ${action}`);
  }

  const target = resolveKubernetesTarget(inventory, instance);
  const manifestPath = kubernetesManifestPath(context);
  const base = kubectlBaseArgs(target);

  const withOutput = (args: string[]): string => {
    const result = runCommand(args);
    return (result.stdout || result.stderr).trim();
  };

  if (normalized === 'up') {
    if (!existsSync(manifestPath)) {
      throw new ValidationError(`kubernetes manifest not generated: ${manifestPath}`);
    }
    return withOutput([...base, 'apply', '-f', manifestPath]);
  }

  if (normalized === 'down') {
    if (!existsSync(manifestPath)) {
      throw new ValidationError(`kubernetes manifest not generated: ${manifestPath}`);
    }
    return withOutput([...base, 'delete', '-f', manifestPath, '--ignore-not-found=true']);
  }

  if (normalized === 'restart' || normalized === 'pull') {
    return withOutput([...base, 'rollout', 'restart', `deployment/${target.deploymentName}`]);
  }

  if (normalized === 'ps') {
    return withOutput([
      ...base,
      'get',
      'pods',
      '-l',
      `app.kubernetes.io/instance=${target.instanceLabel}`,
      '-o',
      'wide',
    ]);
  }

  return withOutput([...base, 'logs', `deployment/${target.deploymentName}`, '--tail=200']);
}

export function kubernetesRunning(
  inventory: Record<string, unknown>,
  instance: Record<string, unknown>,
): boolean {
  const target = resolveKubernetesTarget(inventory, instance);
  const result = runCommand(
    [
      ...kubectlBaseArgs(target),
      'get',
      'deployment',
      target.deploymentName,
      '-o',
      'jsonpath={.status.readyReplicas}',
    ],
    undefined,
    false,
  );

  if (result.code !== 0) {
    return false;
  }

  const value = `${result.stdout}${result.stderr}`.trim();
  if (!value) {
    return false;
  }

  const ready = Number.parseInt(value, 10);
  return Number.isInteger(ready) && ready > 0;
}

export function runKubernetesGatewayCommand(
  inventory: Record<string, unknown>,
  instance: Record<string, unknown>,
  commandArgs: string[],
): string {
  const target = resolveKubernetesTarget(inventory, instance);
  const args = [
    ...kubectlBaseArgs(target),
    'exec',
    '-i',
    `deployment/${target.deploymentName}`,
    '--',
    'node',
    '/app/openclaw.mjs',
    ...commandArgs,
  ];

  const result = runCommand(args);
  return (result.stdout || result.stderr).trim();
}

export function currentKubernetesContext(target?: KubernetesTarget): string {
  const args = ['kubectl'];
  if (target?.kubeconfig) {
    args.push('--kubeconfig', target.kubeconfig);
  }
  if (target?.context) {
    args.push('--context', target.context);
  }
  args.push('config', 'current-context');
  const result = runCommand(args, undefined, false);
  if (result.code !== 0) {
    return '';
  }
  return (result.stdout || result.stderr).trim();
}

function kubectlBaseArgs(target: KubernetesTarget): string[] {
  const args = ['kubectl'];
  if (target.kubeconfig) {
    args.push('--kubeconfig', target.kubeconfig);
  }
  if (target.context) {
    args.push('--context', target.context);
  }
  args.push('--namespace', target.namespace);
  return args;
}

function shouldCreateNamespace(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return true;
}

function commandToArray(command: unknown): string[] | undefined {
  if (command === undefined) {
    return undefined;
  }
  if (typeof command === 'string') {
    return ['/bin/sh', '-lc', command];
  }
  if (!Array.isArray(command)) {
    throw new ValidationError('openclaw.kubernetes.command must be string or list');
  }

  const normalized = command
    .map((part) => (typeof part === 'string' ? part.trim() : String(part)))
    .filter((part) => part.length > 0);
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized;
}

function applyEnvironmentMap(env: Record<string, string>, raw: unknown): void {
  const map = stringMap(raw);
  for (const [key, value] of Object.entries(map)) {
    env[key] = value;
  }
}

function pvcOrEmptyDir(name: string, pvc: string | undefined): Record<string, unknown> {
  if (pvc) {
    return {
      name,
      persistentVolumeClaim: {
        claimName: pvc,
      },
    };
  }
  return {
    name,
    emptyDir: {},
  };
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = String(item);
  }
  return out;
}

function readPositiveInt(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    return fallback;
  }
  return raw;
}

function readNodePort(raw: unknown): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 65535) {
    throw new ValidationError('openclaw.kubernetes.node_port must be an integer between 1 and 65535');
  }
  return raw;
}

function sanitizeKubernetesName(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 63);

  if (!normalized) {
    return 'openclaw';
  }
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(normalized)) {
    throw new ValidationError(`invalid kubernetes name: ${raw}`);
  }
  return normalized;
}

function sanitizeLabelValue(raw: string): string {
  const normalized = raw
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, '-')
    .slice(0, 63);
  return normalized || 'instance';
}

function injectProviderApiKeys(env: Record<string, string>): void {
  const passthrough = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENROUTER_API_KEY',
    'BRAVE_API_KEY',
    'GITHUB_TOKEN',
    'NOTION_API_KEY',
    'BETTERSTACK_API_TOKEN',
    'BETTERSTACK_API_BASE_URL',
  ];

  for (const key of passthrough) {
    const value = process.env[key];
    if (!value || !value.trim()) {
      continue;
    }
    env[key] = value.trim();
  }
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
