import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ValidationError } from '../errors';
import { getInstances } from '../inventory';
import { healthInstance, loadAndValidate, runCompose } from '../workflow';
import { ensureDir } from '../utils';

const DEFAULT_ADMIN_PID_PATH = '.generated/admin/admin-api.pid';
const DEFAULT_ADMIN_LOG_PATH = '.generated/admin/admin-api.log';
const DEFAULT_ADMIN_DB_PATH = '.generated/admin/dashboard.sqlite';
const DEFAULT_ADMIN_HOST = '127.0.0.1';
const DEFAULT_ADMIN_PORT = 4180;

interface StackOptions {
  inventoryPath?: string;
  provider?: 'docker' | 'kubernetes';
  dryRun?: boolean;
  includeRuntimeStatus?: boolean;
  adminHost?: string;
  adminPort?: number;
  adminDbPath?: string;
  adminPidPath?: string;
  adminLogPath?: string;
  startAdminApi?: boolean;
}

interface DevOptions {
  adminHost?: string;
  adminPort?: number;
  adminDbPath?: string;
  adminPidPath?: string;
  adminLogPath?: string;
}

function withDeploymentProvider<T>(
  provider: 'docker' | 'kubernetes' | undefined,
  fn: () => T,
): T {
  if (!provider) {
    return fn();
  }
  const prior = process.env.OCO_DEPLOYMENT_PROVIDER;
  process.env.OCO_DEPLOYMENT_PROVIDER = provider;
  try {
    return fn();
  } finally {
    if (prior === undefined) {
      delete process.env.OCO_DEPLOYMENT_PROVIDER;
    } else {
      process.env.OCO_DEPLOYMENT_PROVIDER = prior;
    }
  }
}

function normalizePort(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    return fallback;
  }
  return value;
}

function readPid(pidPath: string): number | undefined {
  if (!existsSync(pidPath)) {
    return undefined;
  }
  const raw = readFileSync(pidPath, 'utf-8').trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveCliPath(): string {
  const candidate = resolve(__dirname, '..', 'cli.js');
  if (!existsSync(candidate)) {
    throw new ValidationError(
      `compiled CLI not found at ${candidate}; run 'bun run build' before using stack/dev commands`,
    );
  }
  return candidate;
}

function startAdminApiProcess(
  host: string,
  port: number,
  dbPath: string,
  pidPath: string,
  logPath: string,
  watchMode: boolean,
): { status: string; pid: number; host: string; port: number; dbPath: string; logPath: string } {
  ensureDir(dirname(pidPath));
  ensureDir(dirname(logPath));
  ensureDir(dirname(dbPath));

  const existingPid = readPid(pidPath);
  if (existingPid && isProcessRunning(existingPid)) {
    return {
      status: 'already_running',
      pid: existingPid,
      host,
      port,
      dbPath,
      logPath,
    };
  }

  const fd = openSync(logPath, 'a');

  let child;
  if (watchMode) {
    const bunBin = process.env.BUN_BIN || 'bun';
    child = spawn(
      bunBin,
      [
        '--watch',
        'src/cli.ts',
        'admin',
        'api',
        'serve',
        '--host',
        host,
        '--port',
        String(port),
        '--db-path',
        dbPath,
      ],
      {
        detached: true,
        stdio: ['ignore', fd, fd],
      },
    );
  } else {
    const cliPath = resolveCliPath();
    child = spawn(
      process.execPath,
      [cliPath, 'admin', 'api', 'serve', '--host', host, '--port', String(port), '--db-path', dbPath],
      {
        detached: true,
        stdio: ['ignore', fd, fd],
      },
    );
  }

  child.unref();
  writeFileSync(pidPath, `${child.pid}\n`, 'utf-8');

  return {
    status: 'started',
    pid: child.pid ?? 0,
    host,
    port,
    dbPath,
    logPath,
  };
}

function stopAdminApiProcess(pidPath: string): { status: string; pid?: number } {
  const pid = readPid(pidPath);
  if (!pid) {
    return { status: 'not_running' };
  }

  if (!isProcessRunning(pid)) {
    try {
      unlinkSync(pidPath);
    } catch {
      // noop
    }
    return { status: 'not_running', pid };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // noop
  }

  try {
    unlinkSync(pidPath);
  } catch {
    // noop
  }

  return { status: 'stopped', pid };
}

function listEnabledInstanceIds(inventory: Record<string, unknown>): string[] {
  return getInstances(inventory, true)
    .map((instance) => (typeof instance.id === 'string' ? instance.id.trim() : ''))
    .filter(Boolean);
}

export function stackUp(options: StackOptions = {}): Record<string, unknown> {
  const dryRun = options.dryRun ?? false;
  const startAdminApi = options.startAdminApi ?? true;
  const adminHost = options.adminHost?.trim() || DEFAULT_ADMIN_HOST;
  const adminPort = normalizePort(options.adminPort, DEFAULT_ADMIN_PORT);
  const adminDbPath = options.adminDbPath?.trim() || DEFAULT_ADMIN_DB_PATH;
  const adminPidPath = options.adminPidPath?.trim() || DEFAULT_ADMIN_PID_PATH;
  const adminLogPath = options.adminLogPath?.trim() || DEFAULT_ADMIN_LOG_PATH;

  const { invPath, inventory } = loadAndValidate(options.inventoryPath);
  const instances = listEnabledInstanceIds(inventory);

  const runtimeActions = withDeploymentProvider(options.provider, () => {
    if (dryRun) {
      return instances.map((instanceId) => ({
        instance: instanceId,
        action: 'up',
        status: 'planned',
      }));
    }
    return instances.map((instanceId) => runCompose(invPath, instanceId, 'up'));
  });

  const admin = startAdminApi && !dryRun
    ? startAdminApiProcess(
        adminHost,
        adminPort,
        adminDbPath,
        adminPidPath,
        adminLogPath,
        false,
      )
    : {
        status: startAdminApi ? 'planned' : 'skipped',
        host: adminHost,
        port: adminPort,
        dbPath: adminDbPath,
        logPath: adminLogPath,
      };

  return {
    status: dryRun ? 'planned' : 'ok',
    inventory: invPath,
    provider_override: options.provider,
    runtime: runtimeActions,
    admin_api: admin,
  };
}

export function stackDown(options: StackOptions = {}): Record<string, unknown> {
  const dryRun = options.dryRun ?? false;
  const adminPidPath = options.adminPidPath?.trim() || DEFAULT_ADMIN_PID_PATH;
  const { invPath, inventory } = loadAndValidate(options.inventoryPath);
  const instances = listEnabledInstanceIds(inventory);

  const runtimeActions = withDeploymentProvider(options.provider, () => {
    if (dryRun) {
      return instances.map((instanceId) => ({
        instance: instanceId,
        action: 'down',
        status: 'planned',
      }));
    }
    return instances.map((instanceId) => runCompose(invPath, instanceId, 'down'));
  });

  const admin = dryRun ? { status: 'planned' } : stopAdminApiProcess(adminPidPath);

  return {
    status: dryRun ? 'planned' : 'ok',
    inventory: invPath,
    provider_override: options.provider,
    runtime: runtimeActions,
    admin_api: admin,
  };
}

export function stackStatus(options: StackOptions = {}): Record<string, unknown> {
  const includeRuntime = options.includeRuntimeStatus ?? true;
  const adminHost = options.adminHost?.trim() || DEFAULT_ADMIN_HOST;
  const adminPort = normalizePort(options.adminPort, DEFAULT_ADMIN_PORT);
  const adminPidPath = options.adminPidPath?.trim() || DEFAULT_ADMIN_PID_PATH;

  const { invPath, inventory } = loadAndValidate(options.inventoryPath);
  const instances = listEnabledInstanceIds(inventory);
  const pid = readPid(adminPidPath);
  const adminRunning = pid ? isProcessRunning(pid) : false;

  const runtime = withDeploymentProvider(options.provider, () => {
    if (!includeRuntime) {
      return instances.map((instanceId) => ({
        instance: instanceId,
        status: 'not_checked',
      }));
    }
    return instances.map((instanceId) => {
      try {
        return healthInstance(invPath, instanceId);
      } catch (error) {
        return {
          instance: instanceId,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  });

  return {
    inventory: invPath,
    admin_api: {
      host: adminHost,
      port: adminPort,
      pid: pid ?? null,
      running: adminRunning,
      url: `http://${adminHost}:${adminPort}/admin`,
    },
    runtime,
  };
}

export function devUp(options: DevOptions = {}): Record<string, unknown> {
  const adminHost = options.adminHost?.trim() || DEFAULT_ADMIN_HOST;
  const adminPort = normalizePort(options.adminPort, DEFAULT_ADMIN_PORT);
  const adminDbPath = options.adminDbPath?.trim() || DEFAULT_ADMIN_DB_PATH;
  const adminPidPath = options.adminPidPath?.trim() || DEFAULT_ADMIN_PID_PATH;
  const adminLogPath = options.adminLogPath?.trim() || DEFAULT_ADMIN_LOG_PATH;

  const processInfo = startAdminApiProcess(
    adminHost,
    adminPort,
    adminDbPath,
    adminPidPath,
    adminLogPath,
    true,
  );

  return {
    status: processInfo.status,
    api: {
      host: adminHost,
      port: adminPort,
      pid: processInfo.pid,
      db_path: adminDbPath,
      log_path: adminLogPath,
      admin_url: `http://${adminHost}:${adminPort}/admin`,
    },
  };
}

export function devDown(options: DevOptions = {}): Record<string, unknown> {
  const adminPidPath = options.adminPidPath?.trim() || DEFAULT_ADMIN_PID_PATH;
  return {
    status: 'ok',
    api: stopAdminApiProcess(adminPidPath),
  };
}

export function devLogs(options: DevOptions & { lines?: number } = {}): Record<string, unknown> {
  const adminLogPath = options.adminLogPath?.trim() || DEFAULT_ADMIN_LOG_PATH;
  const lines = typeof options.lines === 'number' && options.lines > 0 ? Math.min(options.lines, 1000) : 120;

  if (!existsSync(adminLogPath)) {
    return {
      log_path: adminLogPath,
      lines: [],
    };
  }

  const content = readFileSync(adminLogPath, 'utf-8').split('\n');
  return {
    log_path: adminLogPath,
    lines: content.slice(Math.max(0, content.length - lines)),
  };
}
