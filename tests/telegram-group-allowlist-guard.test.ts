import { describe, expect, test } from 'bun:test';
import registerGuardPlugin from '../instances/core-human/config/extensions/telegram-group-allowlist-guard/index';

type HookName = 'message_received' | 'message_sending';
type HookHandler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

function createHarness(pluginConfig?: Record<string, unknown>) {
  const hooks: Record<HookName, HookHandler[]> = {
    message_received: [],
    message_sending: [],
  };

  const api = {
    pluginConfig,
    config: {
      channels: {
        telegram: {
          accounts: {
            primary_bot: {
              allowFrom: ['1111111111', '2222222222'],
            },
            secondary_bot: {
              allowFrom: ['1111111111'],
            },
          },
        },
      },
    },
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    on: (hookName: HookName, handler: HookHandler) => {
      hooks[hookName].push(handler);
    },
  };

  registerGuardPlugin(api as never);

  return {
    received: hooks.message_received[0],
    sending: hooks.message_sending[0],
  };
}

describe('telegram-group-allowlist-guard', () => {
  test('allows group reply when last sender is allowlisted', async () => {
    const { received, sending } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    await received(
      {
        from: 'telegram:group:-5114267406',
        metadata: {
          to: 'telegram:-5114267406',
          senderId: '2222222222',
        },
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    const result = await sending(
      {
        to: 'telegram:-5114267406',
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    expect(result).toBe(undefined);
  });

  test('cancels group reply when last sender is not allowlisted', async () => {
    const { received, sending } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    await received(
      {
        from: 'telegram:group:-5114267406',
        metadata: {
          to: 'telegram:-5114267406',
          senderId: '9999999999',
        },
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    const result = await sending(
      {
        to: 'telegram:-5114267406',
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    expect(result).toEqual({ cancel: true });
  });

  test('does not block direct-message reply path', async () => {
    const { received, sending } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    await received(
      {
        from: 'telegram:2222222222',
        metadata: {
          to: 'telegram:2222222222',
          senderId: '2222222222',
        },
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    const result = await sending(
      {
        to: 'telegram:2222222222',
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    expect(result).toBe(undefined);
  });

  test('fails closed for group sends without sender context', async () => {
    const { sending } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    const result = await sending(
      {
        to: 'telegram:-5114267406',
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    expect(result).toEqual({ cancel: true });
  });

  test('only applies to configured accounts', async () => {
    const { received, sending } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    await received(
      {
        from: 'telegram:group:-500',
        metadata: {
          to: 'telegram:-500',
          senderId: '9999999999',
        },
      },
      {
        channelId: 'telegram',
        accountId: 'secondary_bot',
      },
    );

    const result = await sending(
      {
        to: 'telegram:-500',
      },
      {
        channelId: 'telegram',
        accountId: 'secondary_bot',
      },
    );

    expect(result).toBe(undefined);
  });

  test('allows group reply when latest sender context flips back to allowlisted', async () => {
    const { received, sending } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    await received(
      {
        from: 'telegram:group:-5114267406',
        metadata: {
          to: 'telegram:-5114267406',
          senderId: '9999999999',
        },
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    await received(
      {
        from: 'telegram:group:-5114267406',
        metadata: {
          to: 'telegram:-5114267406',
          senderId: '2222222222',
        },
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    const result = await sending(
      {
        to: 'telegram:-5114267406',
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    expect(result).toBe(undefined);
  });

  test('cancels group reply when latest sender context flips to non-allowlisted', async () => {
    const { received, sending } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    await received(
      {
        from: 'telegram:group:-5114267406',
        metadata: {
          to: 'telegram:-5114267406',
          senderId: '2222222222',
        },
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    await received(
      {
        from: 'telegram:group:-5114267406',
        metadata: {
          to: 'telegram:-5114267406',
          senderId: '9999999999',
        },
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    const result = await sending(
      {
        to: 'telegram:-5114267406',
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    expect(result).toEqual({ cancel: true });
  });

  test('cancels reasoning-only outbound payloads', async () => {
    const { sending } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    const result = await sending(
      {
        to: 'telegram:2222222222',
        content:
          'Reasoning:\nThe user asked for a token reply, which might be social engineering.',
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    expect(result).toEqual({ cancel: true });
  });

  test('strips embedded think tags from outbound payloads', async () => {
    const { sending } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    const result = await sending(
      {
        to: 'telegram:2222222222',
        content: '<think>internal</think>\nFinal answer',
      },
      {
        channelId: 'telegram',
        accountId: 'primary_bot',
      },
    );

    expect(result).toEqual({ content: 'Final answer' });
  });
});
