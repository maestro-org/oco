import { ValidationError } from './errors';
import { asRecord } from './utils';

export type DeploymentProvider = 'docker' | 'kubernetes';

export interface ResolvedDeploymentProvider {
  provider: DeploymentProvider;
  source: 'default' | 'organization' | 'env';
}

export interface KubernetesDefaults {
  context?: string;
  namespace: string;
  kubeconfig?: string;
}

export function resolveDeploymentProvider(
  inventory: Record<string, unknown>,
): ResolvedDeploymentProvider {
  const envRaw = process.env.OCO_DEPLOYMENT_PROVIDER;
  if (typeof envRaw === 'string' && envRaw.trim()) {
    const envProvider = normalizeProvider(envRaw);
    if (!envProvider) {
      throw new ValidationError('OCO_DEPLOYMENT_PROVIDER must be "docker" or "kubernetes"');
    }
    return {
      provider: envProvider,
      source: 'env',
    };
  }

  const organization = asRecord(inventory.organization);
  const deployment = asRecord(organization.deployment);
  const configured = normalizeProvider(deployment.provider);
  if (configured) {
    return {
      provider: configured,
      source: 'organization',
    };
  }

  return {
    provider: 'docker',
    source: 'default',
  };
}

export function resolveOrgKubernetesDefaults(inventory: Record<string, unknown>): KubernetesDefaults {
  const organization = asRecord(inventory.organization);
  const deployment = asRecord(organization.deployment);
  const kubernetes = asRecord(deployment.kubernetes);

  const namespace =
    normalizeString(process.env.OCO_KUBE_NAMESPACE) ??
    normalizeString(kubernetes.namespace) ??
    'default';
  const context = normalizeString(process.env.OCO_KUBE_CONTEXT) ?? normalizeString(kubernetes.context);
  const kubeconfig =
    normalizeString(process.env.OCO_KUBECONFIG) ?? normalizeString(kubernetes.kubeconfig);

  return { namespace, context, kubeconfig };
}

export function validateDeploymentConfig(inventory: Record<string, unknown>, errors: string[]): void {
  const organization = asRecord(inventory.organization);
  const deployment = asRecord(organization.deployment);
  const rawProvider = deployment.provider;

  if (rawProvider !== undefined && normalizeProvider(rawProvider) === undefined) {
    errors.push('organization.deployment.provider must be "docker" or "kubernetes"');
  }

  const kubernetes = deployment.kubernetes;
  if (kubernetes === undefined) {
    return;
  }
  if (!isRecord(kubernetes)) {
    errors.push('organization.deployment.kubernetes must be a mapping');
    return;
  }

  const namespace = normalizeString(kubernetes.namespace);
  if (kubernetes.namespace !== undefined && namespace === undefined) {
    errors.push('organization.deployment.kubernetes.namespace must be a non-empty string');
  }

  const context = normalizeString(kubernetes.context);
  if (kubernetes.context !== undefined && context === undefined) {
    errors.push('organization.deployment.kubernetes.context must be a non-empty string');
  }

  const kubeconfig = normalizeString(kubernetes.kubeconfig);
  if (kubernetes.kubeconfig !== undefined && kubeconfig === undefined) {
    errors.push('organization.deployment.kubernetes.kubeconfig must be a non-empty string');
  }
}

export function requireSupportedProvider(raw: unknown): DeploymentProvider {
  const provider = normalizeProvider(raw);
  if (!provider) {
    throw new ValidationError('deployment provider must be "docker" or "kubernetes"');
  }
  return provider;
}

function normalizeProvider(raw: unknown): DeploymentProvider | undefined {
  const value = normalizeString(raw)?.toLowerCase();
  if (value === 'docker' || value === 'kubernetes') {
    return value;
  }
  return undefined;
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
