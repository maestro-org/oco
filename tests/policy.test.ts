import { describe, expect, test } from 'bun:test';
import {
  effectivePolicySummary,
  resolveInstancePolicy,
  validatePolicies,
} from '../src/policy';

describe('policy', () => {
  test('instance policy overrides org list values', () => {
    const inventory: Record<string, unknown> = {
      defaults: {
        policy: {
          integrations: {
            allow: ['telegram', 'slack'],
          },
          models: {
            allow_providers: ['openai', 'anthropic'],
          },
        },
      },
      instances: [],
    };

    const instance: Record<string, unknown> = {
      id: 'core',
      policy: {
        integrations: {
          allow: ['telegram'],
        },
        models: {
          allow_providers: ['openai'],
        },
      },
    };

    const policy = resolveInstancePolicy(inventory, instance);
    const integrations = policy.integrations as Record<string, unknown>;
    const models = policy.models as Record<string, unknown>;

    expect(integrations.allow).toEqual(['telegram']);
    expect(models.allow_providers).toEqual(['openai']);
  });

  test('validatePolicies blocks disallowed integration from bindings fallback', () => {
    const inventory: Record<string, unknown> = {
      defaults: {
        policy: {
          integrations: {
            allow: ['telegram'],
          },
        },
      },
    };

    const instances: Array<Record<string, unknown>> = [
      {
        id: 'core',
        policy: {
          integrations: {
            allow: ['slack'],
          },
        },
        agents: [
          {
            id: 'alex',
            bindings: [{ match: { channel: 'telegram', accountId: 'alex' } }],
          },
        ],
      },
    ];

    expect(() => validatePolicies(inventory, instances)).toThrow('not allowlisted');
  });

  test('effectivePolicySummary returns agent scope and policy', () => {
    const inventory: Record<string, unknown> = {
      defaults: {
        policy: {
          integrations: {
            allow: ['telegram'],
          },
        },
      },
    };

    const instance: Record<string, unknown> = {
      id: 'core',
      agents: [],
    };

    const agent: Record<string, unknown> = {
      id: 'alex',
    };

    const summary = effectivePolicySummary(inventory, instance, agent);

    expect(summary.scope).toBe('agent:core/alex');
    expect((summary.policy.integrations as Record<string, unknown>).allow).toEqual(['telegram']);
  });
});
