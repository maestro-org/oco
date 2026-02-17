import { resolve } from 'node:path';
import { InstanceContext } from './types';

export const CONTAINER_CONFIG_DIR = '/var/lib/openclaw/config';
export const CONTAINER_STATE_DIR = '/var/lib/openclaw/state';
export const CONTAINER_WORKSPACE_DIR = '/var/lib/openclaw/workspaces';

export function buildInstanceContext(
  instance: Record<string, unknown>,
  invPath: string,
): InstanceContext {
  const invDir = resolve(invPath, '..');
  const paths = record(instance.paths);
  const host = record(instance.host);

  const id = String(instance.id);

  return {
    id,
    inventoryPath: invPath,
    inventoryDir: invDir,
    generatedDir: resolve(invDir, String(paths.generated_dir ?? '.generated')),
    configDir: resolve(invDir, String(paths.config_dir ?? `instances/${id}/config`)),
    stateDir: resolve(invDir, String(paths.state_dir ?? `instances/${id}/state`)),
    workspaceRoot: resolve(invDir, String(paths.workspace_root ?? `instances/${id}/workspaces`)),
    gatewayPort: Number(host.gateway_port ?? 19789),
    gatewayBind: normalizeDockerBind(String(host.bind ?? '127.0.0.1')),
  };
}

function normalizeDockerBind(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!normalized || normalized === 'loopback' || normalized === 'localhost') {
    return '127.0.0.1';
  }

  if (normalized === 'all') {
    return '0.0.0.0';
  }

  return value;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
