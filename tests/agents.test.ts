import { describe, expect, test } from 'bun:test';
import { addAgent, listAgents, removeAgent } from '../src/agents';
import { ValidationError } from '../src/errors';

describe('agents', () => {
  test('addAgent creates agent and channel account mapping', () => {
    const instance: Record<string, unknown> = {
      id: 'core',
      channels: {
        telegram: {
          accounts: ['alex'],
        },
      },
      agents: [],
    };

    addAgent(
      instance,
      'qa-bot',
      'usecase',
      ['telegram:qa_bot'],
      ['telegram'],
      ['qa-review'],
      'openai/gpt-5.1',
    );

    const agents = listAgents(instance);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('qa-bot');
    expect(agents[0].bindings).toEqual([
      {
        match: {
          channel: 'telegram',
          accountId: 'qa_bot',
        },
      },
    ]);

    const channels = instance.channels as Record<string, unknown>;
    const telegram = channels.telegram as Record<string, unknown>;
    const accounts = telegram.accounts as Record<string, unknown>;
    expect(accounts.qa_bot).toEqual({});
    expect(accounts.alex).toEqual({});
  });

  test('removeAgent prunes unused channel accounts by default', () => {
    const instance: Record<string, unknown> = {
      id: 'core',
      channels: {
        telegram: {
          accounts: {
            alex: {},
            qa_bot: {},
          },
        },
      },
      agents: [
        {
          id: 'alex',
          bindings: [{ match: { channel: 'telegram', accountId: 'alex' } }],
        },
        {
          id: 'qa-bot',
          bindings: [{ match: { channel: 'telegram', accountId: 'qa_bot' } }],
        },
      ],
    };

    removeAgent(instance, 'qa-bot', true);

    const channels = instance.channels as Record<string, unknown>;
    const telegram = channels.telegram as Record<string, unknown>;
    const accounts = telegram.accounts as Record<string, unknown>;

    expect(accounts.qa_bot).toBeUndefined();
    expect(accounts.alex).toEqual({});
    expect(listAgents(instance)).toHaveLength(1);
  });

  test('addAgent rejects invalid account format', () => {
    const instance: Record<string, unknown> = { id: 'core', agents: [] };

    expect(() => {
      addAgent(instance, 'broken', 'usecase', ['not-valid'], [], [], undefined);
    }).toThrow(ValidationError);
  });
});
