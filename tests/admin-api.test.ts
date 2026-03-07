import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import YAML from 'yaml';
import { startAdminApiServer, type AdminApiServer } from '../src/admin/api';

interface JsonResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
}

function randomTestPort(): number {
  return 20000 + Math.floor(Math.random() * 40000);
}

async function startServerWithRetries(root: string): Promise<AdminApiServer> {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = randomTestPort();
    try {
      return await startAdminApiServer({
        host: '127.0.0.1',
        port,
        dbPath: join(root, 'dashboard.sqlite'),
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' || attempt === maxAttempts - 1) {
        throw error;
      }
    }
  }
  throw new Error('unable to allocate admin API port');
}

async function jsonRequest<T = Record<string, unknown>>(
  url: string,
  method: string,
  body?: Record<string, unknown>,
  token?: string,
): Promise<JsonResponse<T>> {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = (await response.json()) as T;
  return {
    status: response.status,
    body: json,
  };
}

describe('admin api', () => {
  let root: string;
  let server: AdminApiServer | undefined;
  let baseUrl: string;
  let inventoryPath: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'oco-admin-api-'));
    process.env.OCO_ADMIN_MASTER_KEY = 'test-master-key';
    server = await startServerWithRetries(root);
    baseUrl = `http://${server.host}:${server.port}`;
    inventoryPath = createInventoryFixture(root);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    rmSync(root, { recursive: true, force: true });
    delete process.env.OCO_ADMIN_MASTER_KEY;
  });

  test('supports auth, CRUD, provider key management, and audit events', async () => {
    const adminUi = await fetch(`${baseUrl}/admin`);
    expect(adminUi.status).toBe(200);
    expect((await adminUi.text()).includes('OCO Admin')).toBeTrue();

    const health = await jsonRequest(`${baseUrl}/healthz`, 'GET');
    expect(health.status).toBe(200);
    expect((health.body as { status: string }).status).toBe('ok');

    const unauthorized = await jsonRequest(`${baseUrl}/api/v1/organizations`, 'GET');
    expect(unauthorized.status).toBe(401);

    const login = await jsonRequest<{ token: string }>(`${baseUrl}/api/v1/auth/login`, 'POST', {
      username: 'admin',
      password: 'admin',
    });
    expect(login.status).toBe(200);
    const token = login.body.token;
    expect(typeof token).toBe('string');

    const createOrg = await jsonRequest(
      `${baseUrl}/api/v1/organizations`,
      'POST',
      {
        id: 'maestro',
        org_id: 'maestro',
        org_slug: 'maestro',
        display_name: 'Maestro',
      },
      token,
    );
    expect(createOrg.status).toBe(201);

    const createInstance = await jsonRequest(
      `${baseUrl}/api/v1/organizations/maestro/instances`,
      'POST',
      {
        id: 'core-human',
        profile: 'human',
        enabled: true,
        host: {
          gateway_port: 19789,
          bind: '127.0.0.1',
        },
      },
      token,
    );
    expect(createInstance.status).toBe(201);

    const createAgent = await jsonRequest(
      `${baseUrl}/api/v1/instances/core-human/agents`,
      'POST',
      {
        id: 'owner',
        role: 'human',
        model: 'openai/gpt-5.1',
        integrations: ['telegram'],
        skills: ['github'],
      },
      token,
    );
    expect(createAgent.status).toBe(201);

    const applySoul = await jsonRequest<{ status: string; agent: { soulTemplate: string } }>(
      `${baseUrl}/api/v1/agents/owner/soul/apply`,
      'POST',
      {
        template: 'operations',
      },
      token,
    );
    expect(applySoul.status).toBe(200);
    expect(applySoul.body.status).toBe('applied');
    expect(applySoul.body.agent.soulTemplate).toBe('operations');

    const applyTools = await jsonRequest<{ status: string; agent: { toolsTemplate: string } }>(
      `${baseUrl}/api/v1/agents/owner/tools/apply`,
      'POST',
      {
        template: 'operations',
      },
      token,
    );
    expect(applyTools.status).toBe(200);
    expect(applyTools.body.status).toBe('applied');
    expect(applyTools.body.agent.toolsTemplate).toBe('operations');

    const createKey = await jsonRequest(
      `${baseUrl}/api/v1/settings/providers/openai/keys`,
      'POST',
      {
        label: 'primary',
        secret: 'sk-test-secret-1234',
      },
      token,
    );
    expect(createKey.status).toBe(201);
    expect((createKey.body as { last4: string }).last4).toBe('1234');

    const providers = await jsonRequest<{ providers: Array<Record<string, unknown>> }>(
      `${baseUrl}/api/v1/settings/providers`,
      'GET',
      undefined,
      token,
    );
    expect(providers.status).toBe(200);
    const openaiProvider = providers.body.providers.find((provider) => provider.provider === 'openai');
    expect(openaiProvider).toBeDefined();
    const keyList = (openaiProvider?.keys as Array<Record<string, unknown>>) || [];
    expect(keyList).toHaveLength(1);
    expect(keyList[0].last4).toBe('1234');
    expect(keyList[0].secret).toBeUndefined();

    const settingsUpdate = await jsonRequest<{ settings: Record<string, unknown> }>(
      `${baseUrl}/api/v1/organizations/maestro/settings`,
      'PATCH',
      {
        timezone: 'UTC',
        notes: 'primary org',
      },
      token,
    );
    expect(settingsUpdate.status).toBe(200);
    expect(settingsUpdate.body.settings.timezone).toBe('UTC');

    const usageEvent = await jsonRequest<{ status: string }>(
      `${baseUrl}/api/v1/usage/events`,
      'POST',
      {
        provider: 'openai',
        model: 'gpt-5.1',
        agent_id: 'owner',
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cost_usd: 0.015,
      },
      token,
    );
    expect(usageEvent.status).toBe(201);
    expect(usageEvent.body.status).toBe('recorded');

    const usageProviders = await jsonRequest<{ providers: Array<Record<string, unknown>> }>(
      `${baseUrl}/api/v1/usage/providers`,
      'GET',
      undefined,
      token,
    );
    expect(usageProviders.status).toBe(200);
    const openaiUsage = usageProviders.body.providers.find((item) => item.provider === 'openai');
    expect(openaiUsage).toBeDefined();
    expect(openaiUsage?.total_tokens).toBe(150);

    const auditEvents = await jsonRequest<{ events: Array<Record<string, unknown>> }>(
      `${baseUrl}/api/v1/audit-events`,
      'GET',
      undefined,
      token,
    );
    expect(auditEvents.status).toBe(200);
    expect(auditEvents.body.events.length).toBeGreaterThanOrEqual(4);

    const overview = await jsonRequest<{ summary: { instances: number; agents: number } }>(
      `${baseUrl}/api/v1/organizations/maestro/overview`,
      'GET',
      undefined,
      token,
    );
    expect(overview.status).toBe(200);
    expect(overview.body.summary.instances).toBe(1);
    expect(overview.body.summary.agents).toBe(1);

    const renderDryRun = await jsonRequest<{ result: { dry_run: boolean } }>(
      `${baseUrl}/api/v1/instances/core-human/runtime/render`,
      'POST',
      {
        inventory_path: inventoryPath,
        dry_run: true,
      },
      token,
    );
    expect(renderDryRun.status).toBe(200);
    expect(renderDryRun.body.result.dry_run).toBeTrue();

    const deployDryRun = await jsonRequest<{ target: { provider: string } }>(
      `${baseUrl}/api/v1/instances/core-human/runtime/deploy`,
      'POST',
      {
        inventory_path: inventoryPath,
        dry_run: true,
      },
      token,
    );
    expect(deployDryRun.status).toBe(200);
    expect(deployDryRun.body.target.provider).toBe('docker');

    const instanceHealth = await jsonRequest<{ status: string }>(
      `${baseUrl}/api/v1/instances/core-human/health?inventory_path=${encodeURIComponent(inventoryPath)}`,
      'GET',
      undefined,
      token,
    );
    expect(instanceHealth.status).toBe(200);
    expect(['running', 'degraded']).toContain(instanceHealth.body.status);

    const importDryRun = await jsonRequest<{ status: string; summary: { instances: number; agents: number } }>(
      `${baseUrl}/api/v1/organizations/maestro/inventory/import`,
      'POST',
      {
        inventory_path: inventoryPath,
        dry_run: true,
      },
      token,
    );
    expect(importDryRun.status).toBe(200);
    expect(importDryRun.body.status).toBe('valid');
    expect(importDryRun.body.summary.instances).toBe(1);
    expect(importDryRun.body.summary.agents).toBe(1);

    const exportInventory = await jsonRequest<{ version: number; instances: Array<Record<string, unknown>> }>(
      `${baseUrl}/api/v1/organizations/maestro/inventory/export`,
      'POST',
      {},
      token,
    );
    expect(exportInventory.status).toBe(200);
    expect(exportInventory.body.version).toBe(1);
    expect(exportInventory.body.instances.length).toBeGreaterThanOrEqual(1);
  });

  test('supports onboarding validate and commit flows', async () => {
    const login = await jsonRequest<{ token: string }>(`${baseUrl}/api/v1/auth/login`, 'POST', {
      username: 'admin',
      password: 'admin',
    });
    const token = login.body.token;

    const previewOrg = await jsonRequest<{ status: string; payload: Record<string, unknown> }>(
      `${baseUrl}/api/v1/onboarding/organization/validate`,
      'POST',
      {
        organization: {
          id: 'acme',
          org_id: 'acme',
          org_slug: 'acme',
          display_name: 'Acme Inc',
        },
        initial_instance: {
          id: 'acme-core',
          profile: 'usecase',
          enabled: true,
          host: {
            gateway_port: 19899,
            bind: '127.0.0.1',
          },
        },
      },
      token,
    );
    expect(previewOrg.status).toBe(200);
    expect(previewOrg.body.status).toBe('valid');

    const commitOrg = await jsonRequest<{ status: string; organization: { id: string } }>(
      `${baseUrl}/api/v1/onboarding/organization/commit`,
      'POST',
      {
        organization: {
          id: 'acme',
          org_id: 'acme',
          org_slug: 'acme',
          display_name: 'Acme Inc',
        },
        initial_instance: {
          id: 'acme-core',
          profile: 'usecase',
          enabled: true,
          host: {
            gateway_port: 19899,
            bind: '127.0.0.1',
          },
        },
      },
      token,
    );
    expect(commitOrg.status).toBe(201);
    expect(commitOrg.body.status).toBe('committed');
    expect(commitOrg.body.organization.id).toBe('acme');

    const previewAgent = await jsonRequest<{ status: string }>(
      `${baseUrl}/api/v1/onboarding/agent/validate`,
      'POST',
      {
        instance_id: 'acme-core',
        agent: {
          id: 'ops',
          role: 'operations',
          model: 'openai/gpt-5.1',
          integrations: ['telegram'],
          skills: ['github'],
        },
      },
      token,
    );
    expect(previewAgent.status).toBe(200);
    expect(previewAgent.body.status).toBe('valid');

    const commitAgent = await jsonRequest<{ status: string; agent: { id: string } }>(
      `${baseUrl}/api/v1/onboarding/agent/commit`,
      'POST',
      {
        instance_id: 'acme-core',
        agent: {
          id: 'ops',
          role: 'operations',
          model: 'openai/gpt-5.1',
          integrations: ['telegram'],
          skills: ['github'],
        },
      },
      token,
    );
    expect(commitAgent.status).toBe(201);
    expect(commitAgent.body.status).toBe('committed');
    expect(commitAgent.body.agent.id).toBe('ops');
  });
});

function createInventoryFixture(root: string): string {
  const inventoryDir = join(root, 'inventory');
  const templatesDir = join(root, 'templates');
  const instanceConfigDir = join(root, 'instances', 'core-human', 'config');
  mkdirSync(inventoryDir, { recursive: true });
  mkdirSync(templatesDir, { recursive: true });
  mkdirSync(instanceConfigDir, { recursive: true });

  writeFileSync(join(templatesDir, 'base.json5'), '{ gateway: { bind: "loopback" } }\n', 'utf-8');
  writeFileSync(join(instanceConfigDir, 'instance.overrides.json5'), '{}\n', 'utf-8');

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
          config_layers: ['../templates/base.json5', '../instances/core-human/config/instance.overrides.json5'],
          docker: {
            image: 'ghcr.io/openclaw/openclaw:2026.2.22',
            container_name: 'openclaw-core-human',
            restart: 'unless-stopped',
          },
        },
        channels: {
          telegram: {
            accounts: {
              owner: {},
            },
          },
        },
        agents: [
          {
            id: 'owner',
            role: 'human',
            workspace: 'owner',
            agent_dir: 'agents/owner',
            model: 'openai/gpt-5.1',
            integrations: ['telegram'],
            skills: ['github'],
            bindings: [{ match: { channel: 'telegram', accountId: 'owner' } }],
          },
        ],
      },
    ],
  };

  const inventoryPath = join(inventoryDir, 'instances.local.yaml');
  writeFileSync(inventoryPath, YAML.stringify(inventory), 'utf-8');
  return inventoryPath;
}
