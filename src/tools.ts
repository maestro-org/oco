import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { listAgents } from './agents';
import { buildInstanceContext } from './context';
import { ValidationError } from './errors';
import {
  findInstance,
  getInstances,
  inventoryPath,
  loadInventoryFile,
  validateInventory,
} from './inventory';
import { resolveBundledPath } from './paths';
import { validatePolicies } from './policy';
import { ensureDir, isRecord } from './utils';

const DEFAULT_TOOLS_TEMPLATES_DIR = 'templates/tools';
const DEFAULT_TOOLS_FILENAME = 'TOOLS.md';

type Binding = {
  channel: string;
  accountId: string;
};

export function listToolsTemplates(invFile?: string): Record<string, unknown> {
  const invPath = inventoryPath(invFile);
  const dir = toolsTemplatesDir(invPath);
  const templates = discoverTemplates(dir);

  return {
    inventory: invPath,
    templates_dir: dir,
    templates: templates.map((item) => ({
      id: item.id,
      path: item.path,
    })),
  };
}

export function applyToolsTemplate(
  invFile: string | undefined,
  instanceId: string,
  agentId: string,
  templateId: string,
  force = false,
): Record<string, unknown> {
  const invPath = inventoryPath(invFile);
  const inventory = loadInventoryFile(invPath);
  validateInventory(inventory, invPath);
  validatePolicies(inventory, getInstances(inventory));

  const instance = findInstance(inventory, instanceId);
  const agent = listAgents(instance).find((item) => String(item.id) === agentId);
  if (!agent) {
    throw new ValidationError(`agent not found: ${instanceId}/${agentId}`);
  }

  const context = buildInstanceContext(instance, invPath);
  const workspace = resolveWorkspace(agent, agentId);
  const workspacePath = resolve(context.workspaceRoot, workspace);
  const toolsPath = resolve(workspacePath, DEFAULT_TOOLS_FILENAME);
  const exists = existsSync(toolsPath);

  if (exists && !force) {
    throw new ValidationError(
      `TOOLS.md already exists for ${instanceId}/${agentId}: ${toolsPath}. Re-run with --force to overwrite.`,
    );
  }

  const templatePath = resolveTemplatePath(invPath, templateId);
  const template = readFileSync(templatePath, 'utf-8');
  const rendered = renderTemplate(template, inventory, instance, agent);

  ensureDir(workspacePath);
  writeFileSync(toolsPath, ensureTrailingNewline(rendered), 'utf-8');

  return {
    instance: instanceId,
    agent: agentId,
    workspace,
    template: normalizeTemplateId(templateId),
    template_path: templatePath,
    tools_path: toolsPath,
    status: exists ? 'overwritten' : 'created',
  };
}

function discoverTemplates(dir: string): Array<{ id: string; path: string }> {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const id = basename(entry.name, '.md');
      return {
        id,
        path: resolve(dir, entry.name),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return entries;
}

function resolveTemplatePath(invPath: string, templateId: string): string {
  const normalizedId = normalizeTemplateId(templateId);
  const templatePath = resolve(toolsTemplatesDir(invPath), `${normalizedId}.md`);

  if (!existsSync(templatePath)) {
    throw new ValidationError(`TOOLS template not found: ${normalizedId} (${templatePath})`);
  }

  return templatePath;
}

function normalizeTemplateId(templateId: string): string {
  const normalized = templateId.trim();

  if (!normalized) {
    throw new ValidationError('template id must be a non-empty string');
  }

  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new ValidationError(`template id must not contain path separators: ${normalized}`);
  }

  return normalized.endsWith('.md') ? basename(normalized, '.md') : normalized;
}

function toolsTemplatesDir(invPath: string): string {
  const envPath = process.env.OCO_TOOLS_TEMPLATES_DIR?.trim();
  if (envPath) {
    return resolve(envPath);
  }

  const invDir = resolve(invPath, '..');
  const localDir = resolve(invDir, `../${DEFAULT_TOOLS_TEMPLATES_DIR}`);
  if (existsSync(localDir)) {
    return localDir;
  }

  const bundledDir = resolveBundledPath(DEFAULT_TOOLS_TEMPLATES_DIR);
  if (existsSync(bundledDir)) {
    return bundledDir;
  }

  return localDir;
}

function resolveWorkspace(agent: Record<string, unknown>, fallback: string): string {
  if (typeof agent.workspace === 'string' && agent.workspace.trim()) {
    return agent.workspace.trim();
  }
  return fallback;
}

function renderTemplate(
  template: string,
  inventory: Record<string, unknown>,
  instance: Record<string, unknown>,
  agent: Record<string, unknown>,
): string {
  const agentId = String(agent.id ?? '');
  const agentName = resolveAgentName(agent, agentId);
  const agentRole =
    typeof agent.role === 'string' && agent.role.trim() ? agent.role.trim() : 'human';
  const organizationName = resolveOrganizationName(inventory);
  const bindings = extractBindings(agent);
  const primary = bindings[0];

  const vars: Record<string, string> = {
    AGENT_ID: agentId,
    AGENT_NAME: agentName,
    AGENT_ROLE: agentRole,
    INSTANCE_ID: String(instance.id ?? ''),
    ORG_NAME: organizationName,
    PRIMARY_CHANNEL: primary?.channel ?? '',
    PRIMARY_ACCOUNT_ID: primary?.accountId ?? '',
    ACCOUNT_IDS: bindings.map((item) => item.accountId).join(', '),
    BINDINGS: bindings.map((item) => `${item.channel}:${item.accountId}`).join(', '),
  };

  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (full, key: string) => vars[key] ?? full);
}

function resolveOrganizationName(inventory: Record<string, unknown>): string {
  const organization = isRecord(inventory.organization) ? inventory.organization : {};

  const candidates = [
    organization.display_name,
    organization.org_slug,
    organization.org_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return 'Organization';
}

function resolveAgentName(agent: Record<string, unknown>, fallback: string): string {
  const candidates = [agent.name, agent.display_name, agent.displayName, agent.full_name];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return fallback;
}

function extractBindings(agent: Record<string, unknown>): Binding[] {
  const out: Binding[] = [];
  const bindings = Array.isArray(agent.bindings) ? agent.bindings : [];

  for (const bindingRaw of bindings) {
    if (!isRecord(bindingRaw)) {
      continue;
    }
    const match = isRecord(bindingRaw.match) ? bindingRaw.match : {};
    const channel = typeof match.channel === 'string' ? match.channel.trim() : '';
    const accountId =
      typeof match.accountId === 'string'
        ? match.accountId.trim()
        : typeof match.account_id === 'string'
          ? match.account_id.trim()
          : '';

    if (!channel || !accountId) {
      continue;
    }

    out.push({ channel, accountId });
  }

  return out;
}

function ensureTrailingNewline(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}
