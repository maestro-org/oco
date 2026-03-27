import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import YAML from 'yaml';
import { devLogs, stackDown, stackStatus, stackUp } from '../src/admin/stack';

function createInventoryFixture(): { root: string; inventoryPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'oco-stack-'));
  const inventoryDir = join(root, 'inventory');
  const templatesDir = join(root, 'templates');
  mkdirSync(inventoryDir, { recursive: true });
  mkdirSync(templatesDir, { recursive: true });
  writeFileSync(join(templatesDir, 'base.json5'), '{ gateway: { bind: "loopback" } }\n', 'utf-8');

  const inventory = {
    version: 1,
    organization: {
      org_id: 'maestro',
      org_slug: 'maestro',
      display_name: 'Maestro',
      deployment: {
        provider: 'docker',
      },
    },
    instances: [
      {
        id: 'core-human',
        enabled: true,
        profile: 'human',
        host: {
          bind: '127.0.0.1',
          gateway_port: 19789,
        },
        paths: {
          config_dir: '../instances/core-human/config',
          state_dir: '../instances/core-human/state',
          workspace_root: '../instances/core-human/workspaces',
          generated_dir: '../.generated/core-human',
        },
        openclaw: {
          config_layers: ['../templates/base.json5'],
        },
        agents: [
          {
            id: 'owner',
            bindings: [{ match: { channel: 'telegram', accountId: 'owner' } }],
          },
        ],
      },
    ],
  };

  const inventoryPath = join(inventoryDir, 'instances.local.yaml');
  writeFileSync(inventoryPath, YAML.stringify(inventory), 'utf-8');

  return { root, inventoryPath };
}

describe('admin stack', () => {
  test('stack up/down dry-run plans runtime actions', () => {
    const fixture = createInventoryFixture();
    try {
      const up = stackUp({
        inventoryPath: fixture.inventoryPath,
        dryRun: true,
        startAdminApi: false,
      });
      expect(up.status).toBe('planned');
      expect(Array.isArray(up.runtime)).toBeTrue();
      expect((up.runtime as Array<Record<string, unknown>>)[0].status).toBe('planned');

      const down = stackDown({
        inventoryPath: fixture.inventoryPath,
        dryRun: true,
      });
      expect(down.status).toBe('planned');
      expect((down.runtime as Array<Record<string, unknown>>)[0].status).toBe('planned');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test('stack status can skip runtime health checks', () => {
    const fixture = createInventoryFixture();
    try {
      const status = stackStatus({
        inventoryPath: fixture.inventoryPath,
        includeRuntimeStatus: false,
      });
      const runtime = status.runtime as Array<Record<string, unknown>>;
      expect(runtime).toHaveLength(1);
      expect(runtime[0].status).toBe('not_checked');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test('devLogs returns empty lines when log file is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-dev-logs-'));
    try {
      const output = devLogs({
        adminLogPath: join(root, 'missing.log'),
      });
      expect(output.log_path).toContain('missing.log');
      expect(output.lines).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
