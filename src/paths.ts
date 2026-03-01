import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PACKAGE_ROOT = resolve(__dirname, '..');

export function resolveBundledPath(relativePath: string): string {
  return resolve(PACKAGE_ROOT, relativePath);
}

export function resolveExistingLocalOrBundledPath(relativePath: string): string | undefined {
  const localPath = resolve(relativePath);
  if (existsSync(localPath)) {
    return localPath;
  }

  const bundledPath = resolveBundledPath(relativePath);
  if (existsSync(bundledPath)) {
    return bundledPath;
  }

  return undefined;
}
