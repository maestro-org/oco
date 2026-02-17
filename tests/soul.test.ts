import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import YAML from 'yaml';
import { ValidationError } from '../src/errors';
import { applySoulTemplate, listSoulTemplates } from '../src/soul';

function setupSoulFixture(): { root: string; invPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'oco-soul-'));

  mkdirSync(join(root, 'inventory'), { recursive: true });
  mkdirSync(join(root, 'templates', 'souls'), { recursive: true });
  mkdirSync(join(root, 'templates'), { recursive: true });

  writeFileSync(join(root, 'templates', 'base.json5'), '{ gateway: { bind: "127.0.0.1" } }\n', 'utf-8');
  writeFileSync(
    join(root, 'templates', 'souls', 'business-development.md'),
    '# SOUL.md\nName: {{AGENT_NAME}}\nId: {{AGENT_ID}}\nRole: {{AGENT_ROLE}}\nOrg: {{ORG_NAME}}\nPrimary: {{PRIMARY_CHANNEL}}/{{PRIMARY_ACCOUNT_ID}}\nBindings: {{BINDINGS}}\n',
    'utf-8',
  );
  writeFileSync(
    join(root, 'templates', 'souls', 'operations.md'),
    '# SOUL.md\nOperations template for {{AGENT_ID}}\n',
    'utf-8',
  );

  const inventory = {
    version: 1,
    organization: {
      org_id: 'maestro',
      org_slug: 'maestro',
      display_name: 'Maestro',
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
        channels: {
          telegram: {
            accounts: {
              davis_rich: {},
            },
          },
        },
        agents: [
          {
            id: 'drichardson',
            name: 'Davis Richardson',
            role: 'business-development',
            workspace: 'drichardson',
            bindings: [{ match: { channel: 'telegram', accountId: 'davis_rich' } }],
          },
        ],
      },
    ],
  };

  const invPath = join(root, 'inventory', 'instances.yaml');
  writeFileSync(invPath, YAML.stringify(inventory), 'utf-8');

  return { root, invPath };
}

describe('soul', () => {
  test('listSoulTemplates discovers template files', () => {
    const { root, invPath } = setupSoulFixture();

    try {
      const result = listSoulTemplates(invPath);
      const templates = result.templates as Array<Record<string, unknown>>;
      expect(templates.map((item) => item.id)).toEqual(['business-development', 'operations']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('applySoulTemplate writes SOUL.md with template variables resolved', () => {
    const { root, invPath } = setupSoulFixture();

    try {
      const result = applySoulTemplate(
        invPath,
        'core',
        'drichardson',
        'business-development',
        false,
      );
      const soulPath = String((result as Record<string, unknown>).soul_path);
      const soul = readFileSync(soulPath, 'utf-8');

      expect(soul).toContain('Name: Davis Richardson');
      expect(soul).toContain('Id: drichardson');
      expect(soul).toContain('Role: business-development');
      expect(soul).toContain('Org: Maestro');
      expect(soul).toContain('Primary: telegram/davis_rich');
      expect(soul).toContain('Bindings: telegram:davis_rich');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('applySoulTemplate requires --force to overwrite existing SOUL.md', () => {
    const { root, invPath } = setupSoulFixture();

    try {
      applySoulTemplate(invPath, 'core', 'drichardson', 'operations', false);

      expect(() => applySoulTemplate(invPath, 'core', 'drichardson', 'operations', false)).toThrow(
        ValidationError,
      );

      const overwritten = applySoulTemplate(invPath, 'core', 'drichardson', 'operations', true);
      expect((overwritten as Record<string, unknown>).status).toBe('overwritten');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
