import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { ensureDir, saveYaml, writeJson } from './utils';

export const DEFAULT_REVISIONS_DIR = '.revisions';

export function createRevision(
  inventoryPath: string,
  instance: Record<string, unknown>,
  renderedConfig?: Record<string, unknown>,
  composePath?: string,
): string {
  const revision = revisionIdNow();
  const instanceId = String(instance.id);

  const root = resolve(DEFAULT_REVISIONS_DIR, instanceId, revision);
  ensureDir(root);

  saveYaml(resolve(root, 'instance.yaml'), instance);

  if (renderedConfig) {
    writeJson(resolve(root, 'openclaw.resolved.json'), renderedConfig);
  }

  if (composePath && existsSync(composePath)) {
    writeFileSync(resolve(root, 'docker-compose.yaml'), readFileSync(composePath, 'utf-8'), 'utf-8');
  }

  writeJson(resolve(root, 'manifest.json'), {
    revision,
    created_at: new Date().toISOString(),
    instance_id: instanceId,
    inventory_path: inventoryPath,
  });

  return revision;
}

export function listRevisions(instanceId: string): string[] {
  const root = resolve(DEFAULT_REVISIONS_DIR, instanceId);
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

export function loadRevisionInstance(
  instanceId: string,
  revision: string,
): Record<string, unknown> {
  const path = resolve(DEFAULT_REVISIONS_DIR, instanceId, revision, 'instance.yaml');
  if (!existsSync(path)) {
    throw new Error(`revision not found: ${instanceId}/${revision}`);
  }

  const parsed = YAML.parse(readFileSync(path, 'utf-8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`invalid revision payload: ${path}`);
  }

  return parsed as Record<string, unknown>;
}

function revisionIdNow(): string {
  const now = new Date();

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  const minute = String(now.getUTCMinutes()).padStart(2, '0');
  const second = String(now.getUTCSeconds()).padStart(2, '0');

  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}
