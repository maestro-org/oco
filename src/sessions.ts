import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { CONTAINER_STATE_DIR, buildInstanceContext } from './context';
import { ValidationError } from './errors';
import { findInstance } from './inventory';
import { isRecord } from './utils';
import { loadAndValidate } from './workflow';

const OPENAI_REASONING_CHAIN_ERROR_RE =
  /400 Item 'rs_[^']+' of type 'reasoning' was provided without its required following item\./;
const SESSION_FILE_RE = /\.jsonl(?:\..+)?$/;

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

export interface SessionDirectoryResetResult {
  sessions_dir: string;
  index_path: string;
  session_keys: number;
  session_files: number;
  applied: boolean;
  backup_dir: string | null;
  backed_up_files: number;
  cleared_session_keys: number;
  deleted_session_files: number;
}

export interface SessionResetAgentResult extends SessionDirectoryResetResult {
  agent: string;
  missing_sessions_dir: boolean;
}

export function resetSessions(
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
  const backupTagBase = formatUtcTag();
  const agents: SessionResetAgentResult[] = [];

  let totalSessionKeys = 0;
  let totalSessionFiles = 0;
  let totalClearedSessionKeys = 0;
  let totalDeletedSessionFiles = 0;
  let updatedAgents = 0;

  for (const name of agentNames) {
    const sessionsDir = join(agentsRoot, name, 'sessions');
    const indexPath = join(sessionsDir, 'sessions.json');
    if (!existsSync(sessionsDir)) {
      agents.push({
        agent: name,
        sessions_dir: sessionsDir,
        index_path: indexPath,
        session_keys: 0,
        session_files: 0,
        applied: false,
        backup_dir: null,
        backed_up_files: 0,
        cleared_session_keys: 0,
        deleted_session_files: 0,
        missing_sessions_dir: true,
      });
      continue;
    }

    const result = resetSessionDirectory(sessionsDir, apply, `${backupTagBase}-${name}`);
    agents.push({
      agent: name,
      ...result,
      missing_sessions_dir: false,
    });

    totalSessionKeys += result.session_keys;
    totalSessionFiles += result.session_files;
    totalClearedSessionKeys += result.cleared_session_keys;
    totalDeletedSessionFiles += result.deleted_session_files;
    if (result.applied) {
      updatedAgents += 1;
    }
  }

  return {
    instance: instanceId,
    apply,
    state_dir: context.stateDir,
    agent_filter: agentId ?? null,
    scanned_agents: agentNames.length,
    updated_agents: apply ? updatedAgents : 0,
    found_session_keys: totalSessionKeys,
    found_session_files: totalSessionFiles,
    cleared_session_keys: apply ? totalClearedSessionKeys : 0,
    deleted_session_files: apply ? totalDeletedSessionFiles : 0,
    agents,
  };
}

export function resetSessionDirectory(
  sessionsDir: string,
  apply = false,
  backupTag = formatUtcTag(),
): SessionDirectoryResetResult {
  const indexPath = join(sessionsDir, 'sessions.json');
  const indexExists = existsSync(indexPath);
  const index = indexExists ? parseSessionIndex(indexPath) : {};
  const sessionKeys = Object.keys(index).length;
  const sessionFiles = collectSessionFiles(sessionsDir);

  let backupDir: string | null = null;
  let backedUpFiles = 0;
  let clearedSessionKeys = 0;
  let deletedSessionFiles = 0;
  let applied = false;

  if (apply && (indexExists || sessionFiles.length > 0)) {
    backupDir = resolveUniqueBackupDir(sessionsDir, backupTag);
    mkdirSync(backupDir, { recursive: true });

    if (indexExists) {
      copyFileSync(indexPath, join(backupDir, 'sessions.json'));
      backedUpFiles += 1;
    }

    for (const filePath of sessionFiles) {
      copyFileSync(filePath, join(backupDir, basename(filePath)));
      backedUpFiles += 1;
    }

    writeFileSync(indexPath, '{}\n', 'utf-8');
    for (const filePath of sessionFiles) {
      rmSync(filePath, { force: true });
      deletedSessionFiles += 1;
    }

    clearedSessionKeys = sessionKeys;
    applied = true;
  }

  return {
    sessions_dir: sessionsDir,
    index_path: indexPath,
    session_keys: sessionKeys,
    session_files: sessionFiles.length,
    applied,
    backup_dir: backupDir,
    backed_up_files: backedUpFiles,
    cleared_session_keys: clearedSessionKeys,
    deleted_session_files: deletedSessionFiles,
  };
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

function collectSessionFiles(sessionsDir: string): string[] {
  if (!existsSync(sessionsDir)) {
    return [];
  }

  return readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SESSION_FILE_RE.test(entry.name))
    .map((entry) => join(sessionsDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function resolveUniqueBackupDir(sessionsDir: string, backupTag: string): string {
  const base = join(sessionsDir, `reset-backup-${backupTag}`);
  if (!existsSync(base)) {
    return base;
  }

  let suffix = 2;
  while (true) {
    const candidate = `${base}-${suffix}`;
    if (!existsSync(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

function formatUtcTag(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
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
