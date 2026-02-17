import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { renderInstanceConfig } from '../src/render';

describe('render', () => {
  test('renderInstanceConfig resolves includes, substitutes env vars and writes output', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-render-'));

    try {
      mkdirSync(join(root, 'inventory'), { recursive: true });
      mkdirSync(join(root, 'templates'), { recursive: true });

      writeFileSync(
        join(root, 'templates', 'included.json5'),
        '{\n  feature: { enabled: true }\n}\n',
        'utf-8',
      );

      writeFileSync(
        join(root, 'templates', 'base.json5'),
        '{\n  $include: "./included.json5",\n  gateway: {\n    auth: { token: "${TEST_OC_TOKEN:-fallback-token}" }\n  }\n}\n',
        'utf-8',
      );

      const invPath = join(root, 'inventory', 'instances.yaml');
      writeFileSync(invPath, 'version: 1\ninstances: []\n', 'utf-8');

      process.env.TEST_OC_TOKEN = 'from-env-token';

      const instance: Record<string, unknown> = {
        id: 'core',
        host: {
          bind: '127.0.0.1',
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
            accounts: ['alex'],
          },
        },
        agents: [
          {
            id: 'alex',
            model: 'openai/gpt-4.1-mini',
            bindings: [{ match: { channel: 'telegram', accountId: 'alex' } }],
          },
        ],
      };

      const result = renderInstanceConfig(instance, invPath, false);
      const gateway = result.rendered.gateway as Record<string, unknown>;
      const auth = (gateway.auth ?? {}) as Record<string, unknown>;
      const bindings = result.rendered.bindings as Array<Record<string, unknown>>;
      const channels = result.rendered.channels as Record<string, unknown>;
      const telegram = channels.telegram as Record<string, unknown>;
      const accounts = telegram.accounts as Record<string, unknown>;
      const agentConfig = result.rendered.agents as Record<string, unknown>;
      const agents = (agentConfig.list ?? []) as Array<Record<string, unknown>>;
      const agentDefaults = (agentConfig.defaults ?? {}) as Record<string, unknown>;

      expect(auth.token).toBe('from-env-token');
      expect(bindings[0].agentId).toBe('alex');
      expect(accounts.alex).toEqual({});
      expect(agents[0].model).toBe('openai/gpt-4.1-mini');
      expect((agentDefaults.model as Record<string, unknown>).primary).toBe('openai/gpt-4.1-mini');

      expect(existsSync(result.generatedPath)).toBe(true);
      expect(existsSync(join(root, 'instances', 'core', 'config', 'openclaw.json5'))).toBe(true);
    } finally {
      delete process.env.TEST_OC_TOKEN;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
