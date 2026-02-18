import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import YAML from 'yaml';
import { generateCompose, runComposeAction } from '../src/compose';
import { ValidationError } from '../src/errors';
import { InstanceContext } from '../src/types';

describe('compose', () => {
  test('generateCompose writes expected service configuration', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-compose-'));

    try {
      const context: InstanceContext = {
        id: 'core',
        inventoryPath: join(root, 'inventory', 'instances.yaml'),
        inventoryDir: join(root, 'inventory'),
        generatedDir: join(root, '.generated', 'core'),
        configDir: join(root, 'instances', 'core', 'config'),
        stateDir: join(root, 'instances', 'core', 'state'),
        workspaceRoot: join(root, 'instances', 'core', 'workspaces'),
        gatewayPort: 19789,
        gatewayBind: '127.0.0.1',
      };

      mkdirSync(context.configDir, { recursive: true });
      mkdirSync(context.stateDir, { recursive: true });
      mkdirSync(context.workspaceRoot, { recursive: true });
      mkdirSync(context.generatedDir, { recursive: true });

      const configPath = join(context.configDir, 'openclaw.json5');
      writeFileSync(configPath, '{"ok":true}\n', 'utf-8');

      const instance: Record<string, unknown> = {
        id: 'core',
        openclaw: {
          docker: {
            image: 'ghcr.io/openclaw/openclaw:latest',
            service_name: 'gateway',
            container_name: 'openclaw-core',
            restart: 'unless-stopped',
            command: ['gateway', 'start'],
            environment: {
              OPENAI_API_KEY: 'test-key',
            },
          },
        },
      };

      const composePath = generateCompose(instance, context, configPath);
      expect(existsSync(composePath)).toBe(true);

      const parsed = YAML.parse(readFileSync(composePath, 'utf-8')) as Record<string, unknown>;
      const services = parsed.services as Record<string, unknown>;
      const gateway = services.gateway as Record<string, unknown>;
      const env = gateway.environment as Record<string, unknown>;
      const volumes = gateway.volumes as string[];

      expect(gateway.image).toBe('ghcr.io/openclaw/openclaw:latest');
      expect(gateway.container_name).toBe('openclaw-core');
      expect(gateway.command).toEqual(['gateway', 'start']);
      expect(env.OPENAI_API_KEY).toBe('test-key');
      expect(env.OPENCLAW_CONFIG_PATH).toBe('/var/lib/openclaw/config/openclaw.json5');
      expect(volumes.some((v) => v.includes('/var/lib/openclaw/state'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('generateCompose injects provider API keys from process env', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-compose-env-'));

    process.env.OPENAI_API_KEY = 'env-openai-key';
    process.env.OPENROUTER_API_KEY = 'env-openrouter-key';
    process.env.BRAVE_API_KEY = 'env-brave-key';

    try {
      const context: InstanceContext = {
        id: 'core',
        inventoryPath: join(root, 'inventory', 'instances.yaml'),
        inventoryDir: join(root, 'inventory'),
        generatedDir: join(root, '.generated', 'core'),
        configDir: join(root, 'instances', 'core', 'config'),
        stateDir: join(root, 'instances', 'core', 'state'),
        workspaceRoot: join(root, 'instances', 'core', 'workspaces'),
        gatewayPort: 19789,
        gatewayBind: '127.0.0.1',
      };

      mkdirSync(context.configDir, { recursive: true });
      mkdirSync(context.generatedDir, { recursive: true });

      const configPath = join(context.configDir, 'openclaw.json5');
      writeFileSync(configPath, '{"ok":true}\n', 'utf-8');

      const instance: Record<string, unknown> = {
        id: 'core',
        openclaw: {
          docker: {},
        },
      };

      const composePath = generateCompose(instance, context, configPath);
      const parsed = YAML.parse(readFileSync(composePath, 'utf-8')) as Record<string, unknown>;
      const services = parsed.services as Record<string, unknown>;
      const gateway = services.gateway as Record<string, unknown>;
      const env = gateway.environment as Record<string, unknown>;

      expect(env.OPENAI_API_KEY).toBe('env-openai-key');
      expect(env.OPENROUTER_API_KEY).toBe('env-openrouter-key');
      expect(env.BRAVE_API_KEY).toBe('env-brave-key');
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.BRAVE_API_KEY;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('generateCompose rejects invalid docker.command type', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-compose-invalid-'));

    try {
      const context: InstanceContext = {
        id: 'core',
        inventoryPath: join(root, 'inventory', 'instances.yaml'),
        inventoryDir: join(root, 'inventory'),
        generatedDir: join(root, '.generated', 'core'),
        configDir: join(root, 'instances', 'core', 'config'),
        stateDir: join(root, 'instances', 'core', 'state'),
        workspaceRoot: join(root, 'instances', 'core', 'workspaces'),
        gatewayPort: 19789,
        gatewayBind: '127.0.0.1',
      };

      const instance: Record<string, unknown> = {
        id: 'core',
        openclaw: {
          docker: {
            command: { bad: true },
          },
        },
      };

      expect(() => generateCompose(instance, context, join(root, 'missing-config.json'))).toThrow(
        ValidationError,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('runComposeAction rejects unsupported action without invoking docker', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-compose-action-'));

    try {
      const context: InstanceContext = {
        id: 'core',
        inventoryPath: join(root, 'inventory', 'instances.yaml'),
        inventoryDir: join(root, 'inventory'),
        generatedDir: join(root, '.generated', 'core'),
        configDir: join(root, 'instances', 'core', 'config'),
        stateDir: join(root, 'instances', 'core', 'state'),
        workspaceRoot: join(root, 'instances', 'core', 'workspaces'),
        gatewayPort: 19789,
        gatewayBind: '127.0.0.1',
      };

      mkdirSync(context.generatedDir, { recursive: true });
      writeFileSync(join(context.generatedDir, 'docker-compose.yaml'), 'services: {}\n', 'utf-8');

      expect(() => runComposeAction(context, 'explode')).toThrow('unsupported compose action');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
