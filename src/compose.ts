import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import {
  CONTAINER_CONFIG_DIR,
  CONTAINER_STATE_DIR,
  CONTAINER_WORKSPACE_DIR,
} from './context';
import { ValidationError } from './errors';
import { InstanceContext } from './types';
import { ensureDir, runCommand } from './utils';

export function composeFilePath(context: InstanceContext): string {
  return resolve(context.generatedDir, 'docker-compose.yaml');
}

export function generateCompose(
  instance: Record<string, unknown>,
  context: InstanceContext,
  configPath: string,
): string {
  ensureDir(context.generatedDir);

  const openclaw = asRecord(instance.openclaw);
  const docker = asRecord(openclaw.docker);

  const image = typeof docker.image === 'string' ? docker.image : 'ghcr.io/openclaw/openclaw:latest';
  const serviceName = typeof docker.service_name === 'string' ? docker.service_name : 'gateway';
  const containerName =
    typeof docker.container_name === 'string' ? docker.container_name : `openclaw-${String(instance.id)}`;
  const restart = typeof docker.restart === 'string' ? docker.restart : 'unless-stopped';

  const command = docker.command;
  if (command !== undefined && typeof command !== 'string' && !Array.isArray(command)) {
    throw new ValidationError('openclaw.docker.command must be string or list');
  }

  const env: Record<string, string> = {
    OPENCLAW_CONFIG_PATH: `${CONTAINER_CONFIG_DIR}/openclaw.json5`,
    OPENCLAW_STATE_DIR: CONTAINER_STATE_DIR,
    OPENCLAW_WORKSPACE_ROOT: CONTAINER_WORKSPACE_DIR,
  };

  injectProviderApiKeys(env);

  if (isRecord(docker.environment)) {
    for (const [key, value] of Object.entries(docker.environment)) {
      env[key] = String(value);
    }
  }

  const ports = [`${context.gatewayBind}:${context.gatewayPort}:${context.gatewayPort}`];

  const service: Record<string, unknown> = {
    image,
    container_name: containerName,
    restart,
    ports,
    environment: env,
    volumes: [
      `${context.configDir}:${CONTAINER_CONFIG_DIR}`,
      `${context.stateDir}:${CONTAINER_STATE_DIR}`,
      `${context.workspaceRoot}:${CONTAINER_WORKSPACE_DIR}`,
    ],
  };

  if (command !== undefined) {
    service.command = command;
  }

  const user = resolveDockerUser(docker);
  if (user) {
    service.user = user;
  }

  const compose = {
    services: {
      [serviceName]: service,
    },
  };

  const output = composeFilePath(context);
  writeFileSync(output, YAML.stringify(compose), 'utf-8');

  const debugConfig = resolve(context.generatedDir, 'openclaw.resolved.json');
  if (existsSync(configPath) && !existsSync(debugConfig)) {
    writeFileSync(debugConfig, readFileSync(configPath, 'utf-8'), 'utf-8');
  }

  return output;
}

export function runComposeAction(context: InstanceContext, action: string): string {
  const composePath = composeFilePath(context);
  if (!existsSync(composePath)) {
    throw new ValidationError(`compose file not generated: ${composePath}`);
  }

  const normalized = action.trim().toLowerCase();
  if (!['up', 'down', 'restart', 'ps', 'pull', 'logs'].includes(normalized)) {
    throw new ValidationError(`unsupported compose action: ${action}`);
  }

  const args = ['docker', 'compose', '-f', composePath];
  if (normalized === 'up') {
    args.push('up', '-d');
  } else {
    args.push(normalized);
  }

  const result = runCommand(args);
  return (result.stdout || result.stderr).trim();
}

export function composeRunning(context: InstanceContext): boolean {
  const composePath = composeFilePath(context);
  if (!existsSync(composePath)) {
    return false;
  }

  const result = runCommand(['docker', 'compose', '-f', composePath, 'ps'], undefined, false);
  if (result.code !== 0) {
    return false;
  }

  const text = `${result.stdout}${result.stderr}`.toLowerCase();
  return /\b(up|running)\b/.test(text);
}

function resolveDockerUser(docker: Record<string, unknown>): string | undefined {
  if (typeof docker.user === 'string' && docker.user.trim()) {
    return docker.user.trim();
  }

  if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
    return `${process.getuid()}:${process.getgid()}`;
  }

  return undefined;
}

function injectProviderApiKeys(env: Record<string, string>): void {
  const passthrough = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENROUTER_API_KEY',
    'BRAVE_API_KEY',
    'GITHUB_TOKEN',
    'NOTION_API_KEY',
    'BETTERSTACK_API_TOKEN',
    'BETTERSTACK_API_BASE_URL',
  ];

  for (const key of passthrough) {
    const value = process.env[key];
    if (!value || !value.trim()) {
      continue;
    }
    env[key] = value.trim();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
