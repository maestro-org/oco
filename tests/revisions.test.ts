import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createRevision, listRevisions, loadRevisionInstance } from '../src/revisions';

describe('revisions', () => {
  test('createRevision persists artifacts and list/load returns revision data', () => {
    const root = Bun.fileURLToPath(new URL(`file://${tmpdir()}/oco-rev-${Date.now()}-${Math.random().toString(16).slice(2)}`));
    mkdirSync(root, { recursive: true });

    const prevCwd = process.cwd();
    try {
      process.chdir(root);

      mkdirSync('.generated/core', { recursive: true });
      writeFileSync('.generated/core/docker-compose.yaml', 'services: {}\n', 'utf-8');

      const instance = {
        id: 'core',
        agents: [{ id: 'alex' }],
      };

      const revision = createRevision(
        '/tmp/inventory/instances.yaml',
        instance,
        { gateway: { port: 19789 } },
        '.generated/core/docker-compose.yaml',
      );

      expect(revision).toMatch(/^\d{8}T\d{6}Z$/);

      const listed = listRevisions('core');
      expect(listed.length).toBe(1);
      expect(listed[0]).toBe(revision);

      const loaded = loadRevisionInstance('core', revision);
      expect(loaded.id).toBe('core');
      expect(loaded.agents).toEqual([{ id: 'alex' }]);
    } finally {
      process.chdir(prevCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('loadRevisionInstance fails for unknown revision', () => {
    const root = Bun.fileURLToPath(new URL(`file://${tmpdir()}/oco-rev-miss-${Date.now()}-${Math.random().toString(16).slice(2)}`));
    mkdirSync(root, { recursive: true });

    const prevCwd = process.cwd();
    try {
      process.chdir(root);
      expect(() => loadRevisionInstance('core', '19700101T000000Z')).toThrow('revision not found');
    } finally {
      process.chdir(prevCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
