import { describe, expect, test } from 'bun:test';
import { countTrailingOpenAiReasoningLoopErrors, isOpenAiReasoningChainError } from '../src/sessions';

const LOOP_ERROR =
  "400 Item 'rs_123' of type 'reasoning' was provided without its required following item.";

describe('sessions', () => {
  test('isOpenAiReasoningChainError matches the known OpenAI loop error', () => {
    expect(isOpenAiReasoningChainError(LOOP_ERROR)).toBe(true);
    expect(isOpenAiReasoningChainError('429 Too Many Requests')).toBe(false);
  });

  test('countTrailingOpenAiReasoningLoopErrors counts trailing assistant loop errors', () => {
    const entries: unknown[] = [
      { type: 'message', message: { role: 'user' } },
      { type: 'message', message: { role: 'assistant', errorMessage: LOOP_ERROR } },
      { type: 'message', message: { role: 'assistant', errorMessage: LOOP_ERROR } },
    ];

    expect(countTrailingOpenAiReasoningLoopErrors(entries)).toBe(2);
  });

  test('countTrailingOpenAiReasoningLoopErrors ignores non-trailing loop errors', () => {
    const entries: unknown[] = [
      { type: 'message', message: { role: 'assistant', errorMessage: LOOP_ERROR } },
      { type: 'message', message: { role: 'assistant', stopReason: 'stop' } },
    ];

    expect(countTrailingOpenAiReasoningLoopErrors(entries)).toBe(0);
  });
});
