import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import YAML from 'yaml';
import { CommandError } from './errors';

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function loadYaml(path: string): Record<string, unknown> {
  const text = readFileSync(path, 'utf-8');
  const data = YAML.parse(text) ?? {};
  if (!isRecord(data)) {
    throw new Error(`expected mapping in ${path}`);
  }
  return data;
}

export function saveYaml(path: string, data: Record<string, unknown>): void {
  ensureDir(dirname(path));
  writeFileSync(path, YAML.stringify(data), 'utf-8');
}

export function writeJson(path: string, data: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

export function deepMerge(left: unknown, right: unknown): unknown {
  if (isRecord(left) && isRecord(right)) {
    const merged: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(right)) {
      if (key in merged) {
        merged[key] = deepMerge(merged[key], value);
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return [...left, ...right];
  }

  return right;
}

export function runCommand(
  args: string[],
  cwd?: string,
  check = true,
): { stdout: string; stderr: string; code: number } {
  const proc = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const code = proc.status ?? 1;
  const stdout = proc.stdout ?? '';
  const stderr = proc.stderr ?? '';

  if (check && code !== 0) {
    throw new CommandError(args.join(' '), code, stderr);
  }

  return { stdout, stderr, code };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of values) {
    const item = raw.trim();
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }

  return out;
}
