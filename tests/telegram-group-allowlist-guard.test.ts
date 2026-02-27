import { describe, expect, test } from 'bun:test';
import registerGuardPlugin from '../instances/core-human/config/extensions/telegram-group-allowlist-guard/index';

type HookName = 'message_received' | 'message_sending' | 'before_tool_call' | 'before_prompt_build';
type HookHandler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

function createHarness(pluginConfig?: Record<string, unknown>) {
  const hooks: Record<HookName, HookHandler[]> = {
    message_received: [],
    message_sending: [],
    before_tool_call: [],
    before_prompt_build: [],
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
    beforeToolCall: hooks.before_tool_call[0],
    beforePromptBuild: hooks.before_prompt_build[0],
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

  test('blocks tool execution when latest group sender is not allowlisted', async () => {
    const { received, beforeToolCall } = createHarness({
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

    const result = await beforeToolCall(
      {
        toolName: 'web_search',
        params: { query: 'latest updates' },
      },
      {
        toolName: 'web_search',
        sessionKey: 'agent:primary_bot:telegram:group:-5114267406',
      },
    );

    expect(result).toEqual({
      block: true,
      blockReason: 'tool execution blocked: triggering sender is not allowlisted',
    });
  });

  test('allows tool execution when latest group sender is allowlisted', async () => {
    const { received, beforeToolCall } = createHarness({
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

    const result = await beforeToolCall(
      {
        toolName: 'web_search',
        params: { query: 'latest updates' },
      },
      {
        toolName: 'web_search',
        sessionKey: 'agent:primary_bot:telegram:group:-5114267406',
      },
    );

    expect(result).toBe(undefined);
  });

  test('does not block tool execution in direct sessions', async () => {
    const { beforeToolCall } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    const result = await beforeToolCall(
      {
        toolName: 'web_search',
        params: { query: 'latest updates' },
      },
      {
        toolName: 'web_search',
        sessionKey: 'agent:primary_bot:telegram:direct:2222222222',
      },
    );

    expect(result).toBe(undefined);
  });

  test('fails closed for tool execution when no recent sender context exists', async () => {
    const { beforeToolCall } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    const result = await beforeToolCall(
      {
        toolName: 'web_search',
        params: { query: 'latest updates' },
      },
      {
        toolName: 'web_search',
        sessionKey: 'agent:primary_bot:telegram:group:-600',
      },
    );

    expect(result).toEqual({
      block: true,
      blockReason: 'tool execution blocked: missing recent sender context',
    });
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

  test('injects DM awareness context for enabled telegram account', async () => {
    const { received, beforePromptBuild } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    await received(
      {
        from: 'telegram:group:-5114267406',
        content:
          'Conversation info (untrusted metadata): {"conversation_label":"AI Bot Testing id:-5114267406","group_subject":"AI Bot Testing"}',
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

    const result = await beforePromptBuild(
      {
        prompt: 'Did you see what happened in the group?',
        messages: [],
      },
      {
        sessionKey: 'agent:primary_bot:telegram:primary_bot:direct:2222222222',
      },
    );

    expect(result).toBeDefined();
    const prependContext = String((result as { prependContext?: unknown }).prependContext ?? '');
    expect(prependContext.includes('Telegram policy context (plugin-enforced):')).toBe(true);
    expect(prependContext.includes('AI Bot Testing')).toBe(true);
    expect(prependContext.includes('id:-5114267406')).toBe(true);
  });

  test('injects latest observed group text preview into DM awareness context', async () => {
    const { received, beforePromptBuild } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    await received(
      {
        from: 'telegram:group:-5114267406',
        content: [
          {
            type: 'text',
            text:
              'Conversation info (untrusted metadata): {"conversation_label":"AI Bot Testing id:-5114267406"}\n\nDid you see this latest group message?',
          },
        ],
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

    const result = await beforePromptBuild(
      {
        prompt: 'What happened in the group?',
        messages: [],
      },
      {
        sessionKey: 'agent:primary_bot:telegram:primary_bot:direct:2222222222',
      },
    );

    expect(result).toBeDefined();
    const prependContext = String((result as { prependContext?: unknown }).prependContext ?? '');
    expect(prependContext.includes('latest observed text:')).toBe(true);
    expect(prependContext.includes('Did you see this latest group message?')).toBe(true);
    expect(prependContext.includes("answer from it directly without calling sessions_list first")).toBe(true);
  });

  test('does not inject awareness context for group sessions', async () => {
    const { beforePromptBuild } = createHarness({
      enabledAccounts: ['primary_bot'],
    });

    const result = await beforePromptBuild(
      {
        prompt: 'group prompt',
        messages: [],
      },
      {
        sessionKey: 'agent:primary_bot:telegram:primary_bot:group:-5114267406',
      },
    );

    expect(result).toBe(undefined);
  });
});
