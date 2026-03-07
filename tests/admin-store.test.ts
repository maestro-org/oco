import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'bun:test';
import { AdminStore } from '../src/admin/store';

describe('admin store', () => {
  test('persists org, instance, agent, and audit events', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-admin-store-'));
    const dbPath = join(root, 'admin.sqlite');

    try {
      const store = await AdminStore.open(dbPath);
      const org = store.createOrganization(
        {
          id: 'maestro',
          orgId: 'maestro',
          orgSlug: 'maestro',
          displayName: 'Maestro',
        },
        'admin',
      );
      expect(org.id).toBe('maestro');

      const instance = store.createInstance(
        'maestro',
        {
          id: 'core-human',
          profile: 'human',
          enabled: true,
          gatewayPort: 19789,
          bind: '127.0.0.1',
        },
        'admin',
      );
      expect(instance.id).toBe('core-human');

      const agent = store.createAgent(
        'core-human',
        {
          id: 'owner',
          role: 'human',
          model: 'openai/gpt-5.1',
          integrations: ['telegram', 'telegram'],
          skills: ['github'],
          soulTemplate: 'operations',
          toolsTemplate: 'operations',
        },
        'admin',
      );
      expect(agent.integrations).toEqual(['telegram']);

      store.close();

      const reopened = await AdminStore.open(dbPath);
      expect(reopened.listOrganizations()).toHaveLength(1);
      expect(reopened.listInstances('maestro')).toHaveLength(1);
      expect(reopened.listAgents('core-human')).toHaveLength(1);
      expect(reopened.listAuditEvents(10)).toHaveLength(3);
      reopened.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('stores provider keys without exposing plaintext values', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-admin-store-key-'));
    const dbPath = join(root, 'admin.sqlite');

    try {
      const store = await AdminStore.open(dbPath);
      const created = store.createProviderKey(
        'openai',
        'primary',
        'sk-test-secret-1234',
        'admin',
        'test-master-key',
      );

      expect(created.provider).toBe('openai');
      expect(created.last4).toBe('1234');

      const keys = store.listProviderKeys('openai');
      expect(keys).toHaveLength(1);
      expect(keys[0].label).toBe('primary');
      expect(keys[0].last4).toBe('1234');

      const org = store.createOrganization(
        {
          id: 'maestro',
          orgId: 'maestro',
          orgSlug: 'maestro',
          displayName: 'Maestro',
        },
        'admin',
      );
      expect(org.id).toBe('maestro');
      const settings = store.updateOrganizationSettings('maestro', { timezone: 'UTC' }, 'admin');
      expect(settings.settings.timezone).toBe('UTC');

      const instance = store.createInstance(
        'maestro',
        {
          id: 'core-human',
          profile: 'human',
          enabled: true,
          gatewayPort: 19789,
          bind: '127.0.0.1',
        },
        'admin',
      );
      expect(instance.id).toBe('core-human');

      const agent = store.createAgent(
        'core-human',
        {
          id: 'owner',
          role: 'human',
          model: 'openai/gpt-5.1',
          integrations: ['telegram'],
          skills: ['github'],
          soulTemplate: 'operations',
          toolsTemplate: 'operations',
        },
        'admin',
      );
      expect(agent.id).toBe('owner');

      store.recordUsageEvent(
        {
          provider: 'openai',
          model: 'gpt-5.1',
          agentId: 'owner',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          costUsd: 0.03,
        },
        'admin',
      );
      const usage = store.listUsageByProvider();
      expect(usage).toHaveLength(1);
      expect(usage[0].provider).toBe('openai');
      expect(usage[0].totalTokens).toBe(150);
      store.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
