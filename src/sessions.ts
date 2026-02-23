import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONTAINER_STATE_DIR, buildInstanceContext } from './context';
import { ValidationError } from './errors';
import { findInstance } from './inventory';
import { isRecord } from './utils';
import { loadAndValidate } from './workflow';

const OPENAI_REASONING_CHAIN_ERROR_RE =
  /400 Item 'rs_[^']+' of type 'reasoning' was provided without its required following item\./;

export function isOpenAiReasoningChainError(message: string): boolean {
  return OPENAI_REASONING_CHAIN_ERROR_RE.test(message);
}

export function countTrailingOpenAiReasoningLoopErrors(entries: unknown[]): number {
  let count = 0;

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const rawEntry = entries[i];
    if (!isRecord(rawEntry) || rawEntry.type !== 'message') {
      continue;
    }

    const message = isRecord(rawEntry.message) ? rawEntry.message : {};
    const role = typeof message.role === 'string' ? message.role : '';

    if (role !== 'assistant') {
      if (count > 0) {
        break;
      }
      continue;
    }

    const errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage : '';
    if (isOpenAiReasoningChainError(errorMessage)) {
      count += 1;
      continue;
    }

    if (count > 0) {
      break;
    }

    return 0;
  }

  return count;
}

export interface BrokenSessionCandidate {
  agent: string;
  session_key: string;
  session_id: string;
  session_file: string;
  trailing_error_count: number;
}

export function healOpenAiReasoningSessions(
  invFile: string | undefined,
  instanceId: string,
  apply = false,
  agentId?: string,
): Record<string, unknown> {
  const { invPath, inventory } = loadAndValidate(invFile);
  const instance = findInstance(inventory, instanceId);
  const context = buildInstanceContext(instance, invPath);
  const agentsRoot = join(context.stateDir, 'agents');

  if (!existsSync(agentsRoot)) {
    throw new ValidationError(`agent state directory not found: ${agentsRoot}`);
  }

  const agentNames = collectAgentNames(agentsRoot, agentId);
  const candidates: BrokenSessionCandidate[] = [];
  let repairedSessions = 0;
  let updatedIndexes = 0;

  for (const name of agentNames) {
    const sessionsDir = join(agentsRoot, name, 'sessions');
    const indexPath = join(sessionsDir, 'sessions.json');
    if (!existsSync(indexPath)) {
      continue;
    }

    const index = parseSessionIndex(indexPath);
    const brokenKeys: string[] = [];

    for (const [sessionKey, rawEntry] of Object.entries(index)) {
      if (!isRecord(rawEntry)) {
        continue;
      }

      const sessionFileValue = typeof rawEntry.sessionFile === 'string' ? rawEntry.sessionFile.trim() : '';
      if (!sessionFileValue) {
        continue;
      }

      const localSessionPath = resolveLocalSessionPath(context.stateDir, sessionsDir, sessionFileValue);
      if (!existsSync(localSessionPath)) {
        continue;
      }

      const parsed = parseJsonl(localSessionPath);
      const trailingErrorCount = countTrailingOpenAiReasoningLoopErrors(parsed);
      if (trailingErrorCount < 1) {
        continue;
      }

      candidates.push({
        agent: name,
        session_key: sessionKey,
        session_id: typeof rawEntry.sessionId === 'string' ? rawEntry.sessionId : '',
        session_file: localSessionPath,
        trailing_error_count: trailingErrorCount,
      });
      brokenKeys.push(sessionKey);
    }

    if (!apply || brokenKeys.length === 0) {
      continue;
    }

    const timestamp = Date.now();
    copyFileSync(indexPath, `${indexPath}.bak-rs-heal-${timestamp}`);

    for (const key of brokenKeys) {
      if (key in index) {
        delete index[key];
        repairedSessions += 1;
      }
    }

    writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf-8');
    updatedIndexes += 1;
  }

  return {
    instance: instanceId,
    apply,
    state_dir: context.stateDir,
    agent_filter: agentId ?? null,
    broken_sessions: candidates.length,
    repaired_sessions: apply ? repairedSessions : 0,
    updated_session_indexes: apply ? updatedIndexes : 0,
    candidates,
  };
}

function collectAgentNames(agentsRoot: string, agentId?: string): string[] {
  if (agentId && agentId.trim()) {
    const normalized = agentId.trim();
    const target = join(agentsRoot, normalized);
    if (!existsSync(target)) {
      throw new ValidationError(`agent state not found: ${normalized}`);
    }
    return [normalized];
  }

  return readdirSync(agentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function parseSessionIndex(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new ValidationError(`failed to parse session index ${path}: ${String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new ValidationError(`session index must be a JSON object: ${path}`);
  }

  return parsed;
}

function resolveLocalSessionPath(stateDir: string, sessionsDir: string, sessionFile: string): string {
  if (sessionFile.startsWith(`${CONTAINER_STATE_DIR}/`)) {
    const relative = sessionFile.slice(CONTAINER_STATE_DIR.length + 1);
    return resolve(stateDir, relative);
  }

  if (sessionFile.startsWith('/')) {
    return sessionFile;
  }

  return resolve(sessionsDir, sessionFile);
}

function parseJsonl(path: string): unknown[] {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split(/\r?\n/);
  const out: unknown[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Ignore malformed line; keep scanning.
    }
  }

  return out;
}
