import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import YAML from 'yaml';
import { ValidationError } from '../src/errors';
import {
  initializeInventory,
  inventoryPath,
  inventoryTemplatePath,
  loadInventoryFile,
  validateInventory,
} from '../src/inventory';

function setupValidInventoryRoot(): { root: string; invPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'oco-inv-'));
  mkdirSync(join(root, 'inventory'), { recursive: true });
  mkdirSync(join(root, 'templates'), { recursive: true });
  writeFileSync(join(root, 'templates', 'base.json5'), '{ gateway: { bind: "127.0.0.1" } }\n', 'utf-8');

  const inventory = {
    version: 1,
    defaults: {
      port_stride: 20,
    },
    instances: [
      {
        id: 'core',
        host: {
          gateway_port: 19789,
        },
        paths: {
          config_dir: '../instances/core/config',
          state_dir: '../instances/core/state',
          workspace_root: '../instances/core/workspaces',
          generated_dir: '../.generated/core',
        },
        openclaw: {
          config_layers: ['../templates/base.json5'],
        },
        agents: [
          {
            id: 'alex',
            bindings: [{ match: { channel: 'telegram', accountId: 'alex' } }],
          },
        ],
      },
    ],
  };

  const invPath = join(root, 'inventory', 'instances.yaml');
  writeFileSync(invPath, YAML.stringify(inventory), 'utf-8');

  return { root, invPath };
}

describe('inventory', () => {
  test('validateInventory accepts valid inventory', () => {
    const { root, invPath } = setupValidInventoryRoot();
    try {
      const inventory = loadInventoryFile(invPath);
      expect(() => validateInventory(inventory, invPath)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('validateInventory rejects gateway port range collisions', () => {
    const { root, invPath } = setupValidInventoryRoot();
    try {
      const inventory = loadInventoryFile(invPath);
      const instances = inventory.instances as Array<Record<string, unknown>>;

      instances.push({
        id: 'conflict',
        host: {
          gateway_port: 19795,
        },
        paths: {
          config_dir: '../instances/conflict/config',
          state_dir: '../instances/conflict/state',
          workspace_root: '../instances/conflict/workspaces',
          generated_dir: '../.generated/conflict',
        },
        openclaw: {
          config_layers: ['../templates/base.json5'],
        },
        agents: [
          {
            id: 'conflict-agent',
            bindings: [{ match: { channel: 'telegram', accountId: 'conflict' } }],
          },
        ],
      });

      expect(() => validateInventory(inventory, invPath)).toThrow(ValidationError);
      expect(() => validateInventory(inventory, invPath)).toThrow('port range collision');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('validateInventory rejects duplicate channel/account bindings in one instance', () => {
    const { root, invPath } = setupValidInventoryRoot();
    try {
      const inventory = loadInventoryFile(invPath);
      const instance = (inventory.instances as Array<Record<string, unknown>>)[0];
      instance.agents = [
        {
          id: 'agent-a',
          bindings: [{ match: { channel: 'telegram', accountId: 'alex' } }],
        },
        {
          id: 'agent-b',
          bindings: [{ match: { channel: 'telegram', accountId: 'alex' } }],
        },
      ];

      expect(() => validateInventory(inventory, invPath)).toThrow('duplicate channel/account binding');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('inventoryPath prefers instances.local.yaml when present', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-inv-local-'));
    const previousCwd = process.cwd();
    const previousEnv = process.env.OCO_INVENTORY_PATH;

    try {
      delete process.env.OCO_INVENTORY_PATH;
      mkdirSync(join(root, 'inventory'), { recursive: true });
      writeFileSync(join(root, 'inventory', 'instances.local.yaml'), 'version: 1\ninstances: []\n');
      writeFileSync(join(root, 'inventory', 'instances.yaml'), 'version: 1\ninstances: []\n');

      process.chdir(root);
      expect(inventoryPath()).toBe(join(root, 'inventory', 'instances.local.yaml'));
    } finally {
      if (previousEnv === undefined) {
        delete process.env.OCO_INVENTORY_PATH;
      } else {
        process.env.OCO_INVENTORY_PATH = previousEnv;
      }
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('inventoryTemplatePath falls back to bundled template when local files are absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-inv-template-'));
    const previousCwd = process.cwd();
    const previousEnv = process.env.OCO_INVENTORY_TEMPLATE;

    try {
      delete process.env.OCO_INVENTORY_TEMPLATE;
      process.chdir(root);

      const resolved = inventoryTemplatePath();
      expect(existsSync(resolved)).toBeTrue();
      expect(resolved.includes(join('inventory', 'instances.example.yaml'))).toBeTrue();
      expect(resolved.startsWith(root)).toBeFalse();
    } finally {
      if (previousEnv === undefined) {
        delete process.env.OCO_INVENTORY_TEMPLATE;
      } else {
        process.env.OCO_INVENTORY_TEMPLATE = previousEnv;
      }
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('initializeInventory creates a local copy from template', () => {
    const { root, invPath } = setupValidInventoryRoot();
    const localPath = join(root, 'inventory', 'instances.local.yaml');

    try {
      const result = initializeInventory(localPath, invPath, false);
      expect(result.status).toBe('created');

      const source = loadInventoryFile(invPath);
      const local = loadInventoryFile(localPath);
      expect(local).toEqual(source);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('validateInventory rejects unsupported org deployment provider', () => {
    const { root, invPath } = setupValidInventoryRoot();
    try {
      const inventory = loadInventoryFile(invPath);
      inventory.organization = {
        deployment: {
          provider: 'nomad',
        },
      };

      expect(() => validateInventory(inventory, invPath)).toThrow(
        'organization.deployment.provider must be "docker" or "kubernetes"',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('validateInventory rejects kubernetes node_port without NodePort service type', () => {
    const { root, invPath } = setupValidInventoryRoot();
    try {
      const inventory = loadInventoryFile(invPath);
      const instance = (inventory.instances as Array<Record<string, unknown>>)[0];
      instance.openclaw = {
        ...(instance.openclaw as Record<string, unknown>),
        kubernetes: {
          node_port: 30080,
          service_type: 'ClusterIP',
        },
      };

      expect(() => validateInventory(inventory, invPath)).toThrow(
        'openclaw.kubernetes.node_port is only valid when service_type is NodePort',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
