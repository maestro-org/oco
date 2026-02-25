import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  countTrailingOpenAiReasoningLoopErrors,
  isOpenAiReasoningChainError,
  resetSessionDirectory,
} from '../src/sessions';

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

  test('resetSessionDirectory dry-run reports reset candidates without modifying files', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-sessions-dry-'));
    const sessionsDir = root;

    try {
      writeFileSync(
        join(sessionsDir, 'sessions.json'),
        JSON.stringify(
          {
            alpha: { sessionId: 's1', sessionFile: './s1.jsonl' },
            beta: { sessionId: 's2', sessionFile: './s2.jsonl' },
          },
          null,
          2,
        ),
        'utf-8',
      );
      writeFileSync(join(sessionsDir, 's1.jsonl'), '{"type":"message"}\n', 'utf-8');
      writeFileSync(join(sessionsDir, 's2.jsonl.tmp'), '{"type":"message"}\n', 'utf-8');
      writeFileSync(join(sessionsDir, 'notes.txt'), 'keep me\n', 'utf-8');

      const result = resetSessionDirectory(sessionsDir, false, 'dry-run-test');

      expect(result.applied).toBe(false);
      expect(result.session_keys).toBe(2);
      expect(result.session_files).toBe(2);
      expect(result.backup_dir).toBe(null);
      expect(result.backed_up_files).toBe(0);
      expect(result.cleared_session_keys).toBe(0);
      expect(result.deleted_session_files).toBe(0);
      expect(JSON.parse(readFileSync(join(sessionsDir, 'sessions.json'), 'utf-8'))).toEqual({
        alpha: { sessionId: 's1', sessionFile: './s1.jsonl' },
        beta: { sessionId: 's2', sessionFile: './s2.jsonl' },
      });
      expect(existsSync(join(sessionsDir, 's1.jsonl'))).toBe(true);
      expect(existsSync(join(sessionsDir, 's2.jsonl.tmp'))).toBe(true);
      expect(existsSync(join(sessionsDir, 'notes.txt'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('resetSessionDirectory apply backs up and clears index plus session files', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-sessions-apply-'));
    const sessionsDir = root;

    try {
      writeFileSync(
        join(sessionsDir, 'sessions.json'),
        JSON.stringify(
          {
            alpha: { sessionId: 's1', sessionFile: './s1.jsonl' },
          },
          null,
          2,
        ),
        'utf-8',
      );
      writeFileSync(join(sessionsDir, 's1.jsonl'), '{"type":"message"}\n', 'utf-8');
      writeFileSync(join(sessionsDir, 's1.jsonl.rotated'), '{"type":"message"}\n', 'utf-8');
      writeFileSync(join(sessionsDir, 'notes.txt'), 'keep me\n', 'utf-8');

      const result = resetSessionDirectory(sessionsDir, true, 'apply-test');
      const backupDir = join(sessionsDir, 'reset-backup-apply-test');

      expect(result.applied).toBe(true);
      expect(result.backup_dir).toBe(backupDir);
      expect(result.session_keys).toBe(1);
      expect(result.session_files).toBe(2);
      expect(result.backed_up_files).toBe(3);
      expect(result.cleared_session_keys).toBe(1);
      expect(result.deleted_session_files).toBe(2);

      expect(existsSync(backupDir)).toBe(true);
      expect(existsSync(join(backupDir, 'sessions.json'))).toBe(true);
      expect(existsSync(join(backupDir, 's1.jsonl'))).toBe(true);
      expect(existsSync(join(backupDir, 's1.jsonl.rotated'))).toBe(true);

      expect(readFileSync(join(sessionsDir, 'sessions.json'), 'utf-8')).toBe('{}\n');
      expect(existsSync(join(sessionsDir, 's1.jsonl'))).toBe(false);
      expect(existsSync(join(sessionsDir, 's1.jsonl.rotated'))).toBe(false);
      expect(existsSync(join(sessionsDir, 'notes.txt'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('resetSessionDirectory apply creates empty sessions.json when index is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-sessions-no-index-'));
    const sessionsDir = root;

    try {
      writeFileSync(join(sessionsDir, 's2.jsonl'), '{"type":"message"}\n', 'utf-8');

      const result = resetSessionDirectory(sessionsDir, true, 'missing-index-test');
      const backupDir = join(sessionsDir, 'reset-backup-missing-index-test');

      expect(result.applied).toBe(true);
      expect(result.session_keys).toBe(0);
      expect(result.session_files).toBe(1);
      expect(result.backup_dir).toBe(backupDir);
      expect(result.backed_up_files).toBe(1);
      expect(result.cleared_session_keys).toBe(0);
      expect(result.deleted_session_files).toBe(1);

      expect(readFileSync(join(sessionsDir, 'sessions.json'), 'utf-8')).toBe('{}\n');
      expect(existsSync(join(sessionsDir, 's2.jsonl'))).toBe(false);
      expect(existsSync(join(backupDir, 's2.jsonl'))).toBe(true);
      expect(existsSync(join(backupDir, 'sessions.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
