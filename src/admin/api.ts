import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ValidationError } from '../errors';
import {
  findInstance,
  getInstances,
  inventoryPath as resolveInventoryPath,
  loadInventoryFile,
  validateInventory,
} from '../inventory';
import { validatePolicies } from '../policy';
import { deploymentTargetForInstance, healthInstance, renderInstance, runCompose } from '../workflow';
import { AuthService } from './auth';
import { requireRole } from './rbac';
import { AdminStore } from './store';
import { AdminRole, AuthSession, ProviderKeyRecord } from './types';
import { getAdminAsset, hasAdminAsset } from './web';

const DEFAULT_DB_PATH = '.generated/admin/dashboard.sqlite';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4180;

interface JsonMap {
  [key: string]: unknown;
}

interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  method: string;
  session?: AuthSession;
  token?: string;
  store: AdminStore;
  auth: AuthService;
}

interface StartAdminApiServerOptions {
  dbPath?: string;
  host?: string;
  port?: number;
}

export interface AdminApiServer {
  host: string;
  port: number;
  dbPath: string;
  close: () => Promise<void>;
  waitUntilClosed: () => Promise<void>;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendNoContent(response: ServerResponse): void {
  response.statusCode = 204;
  response.end();
}

function parseJsonError(statusCode: number, message: string): JsonMap {
  return {
    error: {
      status: statusCode,
      message,
    },
  };
}

async function parseJsonBody(request: IncomingMessage): Promise<JsonMap> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError('invalid JSON body');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('body must be a JSON object');
  }

  return parsed as JsonMap;
}

function extractToken(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new ValidationError('unauthorized');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new ValidationError('unauthorized');
  }
  return token;
}

function isMethod(request: RequestContext, method: string): boolean {
  return request.method === method;
}

function pathMatch(pathname: string, pattern: RegExp): RegExpExecArray | undefined {
  const match = pattern.exec(pathname);
  return match ?? undefined;
}

function requireWriteRole(role: AdminRole): void {
  requireRole(role, 'operator');
}

function requireAdminRole(role: AdminRole): void {
  requireRole(role, 'admin');
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function parseEnvNumber(value: string | undefined, fallback: number): number {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function resolveRuntimeInventoryPath(rawPath: unknown): string {
  if (typeof rawPath === 'string' && rawPath.trim()) {
    return resolveInventoryPath(rawPath.trim());
  }
  return resolveInventoryPath(undefined);
}

function asJsonMap(value: unknown): JsonMap {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonMap;
  }
  return {};
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ValidationError(`${label} is required`);
  }
  return normalized;
}

interface OrganizationOnboardingPayload {
  organization: {
    id: string;
    orgId: string;
    orgSlug: string;
    displayName: string;
  };
  initialInstance?: {
    id: string;
    profile: string;
    enabled: boolean;
    host: {
      gatewayPort: number;
      bind: string;
    };
  };
}

interface AgentOnboardingPayload {
  instanceId: string;
  agent: {
    id: string;
    role: string;
    model: string;
    integrations: string[];
    skills: string[];
    soulTemplate: string;
    toolsTemplate: string;
  };
}

const SUPPORTED_MODELS: Record<string, string[]> = {
  openai: ['gpt-5.1', 'gpt-5-mini'],
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-5'],
};

function normalizeOrganizationOnboarding(body: JsonMap): OrganizationOnboardingPayload {
  const organizationRaw = asJsonMap(body.organization);
  const initialInstanceRaw = asJsonMap(body.initial_instance ?? body.initialInstance);
  const initialHostRaw = asJsonMap(initialInstanceRaw.host);

  const organization = {
    id: requireNonEmpty(parseString(organizationRaw.id, parseString(body.id)), 'organization.id'),
    orgId: requireNonEmpty(
      parseString(
        organizationRaw.org_id,
        parseString(organizationRaw.orgId, parseString(body.org_id, parseString(body.orgId))),
      ),
      'organization.org_id',
    ),
    orgSlug: requireNonEmpty(
      parseString(
        organizationRaw.org_slug,
        parseString(organizationRaw.orgSlug, parseString(body.org_slug, parseString(body.orgSlug))),
      ),
      'organization.org_slug',
    ),
    displayName: requireNonEmpty(
      parseString(
        organizationRaw.display_name,
        parseString(
          organizationRaw.displayName,
          parseString(body.display_name, parseString(body.displayName)),
        ),
      ),
      'organization.display_name',
    ),
  };

  if (Object.keys(initialInstanceRaw).length === 0) {
    return { organization };
  }

  const gatewayPort = parseNumber(
    initialHostRaw.gateway_port,
    parseNumber(initialHostRaw.gatewayPort, 0),
  );
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) {
    throw new ValidationError('initial_instance.host.gateway_port must be a valid port integer');
  }

  return {
    organization,
    initialInstance: {
      id: requireNonEmpty(parseString(initialInstanceRaw.id), 'initial_instance.id'),
      profile: parseString(initialInstanceRaw.profile, 'usecase').trim() || 'usecase',
      enabled: parseBoolean(initialInstanceRaw.enabled, true),
      host: {
        gatewayPort,
        bind: parseString(initialHostRaw.bind, '127.0.0.1'),
      },
    },
  };
}

function normalizeAgentOnboarding(body: JsonMap): AgentOnboardingPayload {
  const agentRaw = asJsonMap(body.agent);

  const instanceId = requireNonEmpty(
    parseString(body.instance_id, parseString(body.instanceId)),
    'instance_id',
  );
  const agentId = requireNonEmpty(parseString(agentRaw.id, parseString(body.agent_id)), 'agent.id');
  const role = parseString(agentRaw.role, parseString(body.role, 'usecase')).trim() || 'usecase';
  const model = requireNonEmpty(parseString(agentRaw.model, parseString(body.model)), 'agent.model');

  return {
    instanceId,
    agent: {
      id: agentId,
      role,
      model,
      integrations: parseStringArray(agentRaw.integrations ?? body.integrations),
      skills: parseStringArray(agentRaw.skills ?? body.skills),
      soulTemplate: parseString(
        agentRaw.soul_template,
        parseString(agentRaw.soulTemplate, parseString(body.soul_template, parseString(body.soulTemplate))),
      ),
      toolsTemplate: parseString(
        agentRaw.tools_template,
        parseString(agentRaw.toolsTemplate, parseString(body.tools_template, parseString(body.toolsTemplate))),
      ),
    },
  };
}

function validateOrganizationOnboarding(
  context: RequestContext,
  payload: OrganizationOnboardingPayload,
): void {
  if (context.store.getOrganization(payload.organization.id)) {
    throw new ValidationError(`organization already exists: ${payload.organization.id}`);
  }

  if (payload.initialInstance && context.store.getInstance(payload.initialInstance.id)) {
    throw new ValidationError(`instance already exists: ${payload.initialInstance.id}`);
  }
}

function validateAgentOnboarding(context: RequestContext, payload: AgentOnboardingPayload): void {
  if (!context.store.getInstance(payload.instanceId)) {
    throw new ValidationError(`instance not found: ${payload.instanceId}`);
  }
  if (context.store.getAgent(payload.agent.id)) {
    throw new ValidationError(`agent already exists: ${payload.agent.id}`);
  }
}

function parseInventoryImportSummary(inventory: Record<string, unknown>): {
  organizationId: string;
  instances: number;
  agents: number;
} {
  const organizationRaw =
    inventory.organization && typeof inventory.organization === 'object' && !Array.isArray(inventory.organization)
      ? (inventory.organization as JsonMap)
      : {};
  const organizationId = parseString(
    organizationRaw.org_slug,
    parseString(organizationRaw.org_id, 'imported-org'),
  );
  const instances = getInstances(inventory);
  let agents = 0;
  for (const instance of instances) {
    const instanceAgents = Array.isArray(instance.agents) ? instance.agents.length : 0;
    agents += instanceAgents;
  }
  return {
    organizationId,
    instances: instances.length,
    agents,
  };
}

function groupedProviderKeys(keys: ProviderKeyRecord[]): Record<string, ProviderKeyRecord[]> {
  const groups: Record<string, ProviderKeyRecord[]> = {};
  for (const key of keys) {
    if (!groups[key.provider]) {
      groups[key.provider] = [];
    }
    groups[key.provider].push(key);
  }
  return groups;
}

function statusForError(error: unknown): number {
  if (error instanceof ValidationError) {
    if (error.message === 'unauthorized' || error.message === 'invalid credentials') {
      return 401;
    }
    if (error.message.startsWith('insufficient role:')) {
      return 403;
    }
    if (error.message.includes('not found')) {
      return 404;
    }
    return 400;
  }
  return 500;
}

async function handleLogin(context: RequestContext): Promise<void> {
  const body = await parseJsonBody(context.request);
  const username = parseString(body.username);
  const password = parseString(body.password);
  const session = context.auth.login(username, password);

  sendJson(context.response, 200, {
    token: session.token,
    user: {
      username: session.username,
      role: session.role,
    },
  });
}

function handleAuthMe(context: RequestContext): void {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }
  sendJson(context.response, 200, {
    user: {
      username: context.session.username,
      role: context.session.role,
      created_at: context.session.createdAt,
    },
  });
}

function handleLogout(context: RequestContext): void {
  if (!context.token) {
    throw new ValidationError('unauthorized');
  }
  context.auth.logout(context.token);
  sendNoContent(context.response);
}

async function handleOnboardingOrganization(
  context: RequestContext,
  mode: 'preview' | 'commit',
): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }
  requireWriteRole(context.session.role);

  if (!isMethod(context, 'POST')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  const body = await parseJsonBody(context.request);
  const payload = normalizeOrganizationOnboarding(body);
  validateOrganizationOnboarding(context, payload);

  if (mode === 'preview') {
    sendJson(context.response, 200, {
      status: 'valid',
      mode,
      payload,
    });
    return;
  }

  const createdOrganization = context.store.createOrganization(
    {
      id: payload.organization.id,
      orgId: payload.organization.orgId,
      orgSlug: payload.organization.orgSlug,
      displayName: payload.organization.displayName,
    },
    context.session.username,
  );

  let createdInstance: unknown;
  if (payload.initialInstance) {
    createdInstance = context.store.createInstance(
      payload.organization.id,
      {
        id: payload.initialInstance.id,
        profile: payload.initialInstance.profile,
        enabled: payload.initialInstance.enabled,
        gatewayPort: payload.initialInstance.host.gatewayPort,
        bind: payload.initialInstance.host.bind,
      },
      context.session.username,
    );
  }

  sendJson(context.response, 201, {
    status: 'committed',
    organization: createdOrganization,
    ...(createdInstance ? { initial_instance: createdInstance } : {}),
  });
}

async function handleOnboardingAgent(context: RequestContext, mode: 'preview' | 'commit'): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }
  requireWriteRole(context.session.role);

  if (!isMethod(context, 'POST')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  const body = await parseJsonBody(context.request);
  const payload = normalizeAgentOnboarding(body);
  validateAgentOnboarding(context, payload);

  if (mode === 'preview') {
    sendJson(context.response, 200, {
      status: 'valid',
      mode,
      payload,
    });
    return;
  }

  const created = context.store.createAgent(
    payload.instanceId,
    {
      id: payload.agent.id,
      role: payload.agent.role,
      model: payload.agent.model,
      integrations: payload.agent.integrations,
      skills: payload.agent.skills,
      soulTemplate: payload.agent.soulTemplate,
      toolsTemplate: payload.agent.toolsTemplate,
    },
    context.session.username,
  );

  sendJson(context.response, 201, {
    status: 'committed',
    agent: created,
  });
}

async function handleOrganizations(context: RequestContext): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (isMethod(context, 'GET')) {
    sendJson(context.response, 200, {
      organizations: context.store.listOrganizations(),
    });
    return;
  }

  if (isMethod(context, 'POST')) {
    requireWriteRole(context.session.role);
    const body = await parseJsonBody(context.request);
    const created = context.store.createOrganization(
      {
        id: parseString(body.id),
        orgId: parseString(body.org_id, parseString(body.orgId)),
        orgSlug: parseString(body.org_slug, parseString(body.orgSlug)),
        displayName: parseString(body.display_name, parseString(body.displayName)),
      },
      context.session.username,
    );
    sendJson(context.response, 201, created);
    return;
  }

  sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
}

async function handleOrganizationById(context: RequestContext, orgId: string): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (isMethod(context, 'GET')) {
    const organization = context.store.getOrganization(orgId);
    if (!organization) {
      sendJson(context.response, 404, parseJsonError(404, `organization not found: ${orgId}`));
      return;
    }
    sendJson(context.response, 200, organization);
    return;
  }

  if (isMethod(context, 'PATCH')) {
    requireWriteRole(context.session.role);
    const body = await parseJsonBody(context.request);
    const updated = context.store.updateOrganization(
      orgId,
      {
        orgId: parseString(body.org_id, parseString(body.orgId)) || undefined,
        orgSlug: parseString(body.org_slug, parseString(body.orgSlug)) || undefined,
        displayName: parseString(body.display_name, parseString(body.displayName)) || undefined,
      },
      context.session.username,
    );
    sendJson(context.response, 200, updated);
    return;
  }

  sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
}

function handleOrganizationOverview(context: RequestContext, orgId: string): void {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (!isMethod(context, 'GET')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  const organization = context.store.getOrganization(orgId);
  if (!organization) {
    sendJson(context.response, 404, parseJsonError(404, `organization not found: ${orgId}`));
    return;
  }

  const instances = context.store.listInstances(orgId);
  const instanceDetails = instances.map((instance) => {
    const agents = context.store.listAgents(instance.id);
    const channels = Array.from(
      new Set(
        agents.flatMap((agent) =>
          Array.isArray(agent.integrations) ? agent.integrations : [],
        ),
      ),
    );
    return {
      ...instance,
      agents,
      channels,
    };
  });
  let agentsCount = 0;
  for (const instance of instanceDetails) {
    agentsCount += instance.agents.length;
  }

  sendJson(context.response, 200, {
    organization,
    summary: {
      instances: instances.length,
      agents: agentsCount,
      enabled_instances: instances.filter((item) => item.enabled).length,
    },
    instances: instanceDetails,
  });
}

async function handleOrganizationSettings(context: RequestContext, orgId: string): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (isMethod(context, 'GET')) {
    const settings = context.store.getOrganizationSettings(orgId);
    sendJson(context.response, 200, settings);
    return;
  }

  if (isMethod(context, 'PATCH')) {
    requireWriteRole(context.session.role);
    const body = await parseJsonBody(context.request);
    const updated = context.store.updateOrganizationSettings(orgId, body, context.session.username);
    sendJson(context.response, 200, updated);
    return;
  }

  sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
}

async function handleOrganizationInventoryImport(context: RequestContext, orgId: string): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }
  requireAdminRole(context.session.role);

  if (!isMethod(context, 'POST')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  const body = await parseJsonBody(context.request);
  const importPath = resolveRuntimeInventoryPath(body.inventory_path);
  const dryRun = parseBoolean(body.dry_run, true);
  const inventory = loadInventoryFile(importPath);
  validateInventory(inventory, importPath);
  validatePolicies(inventory, getInstances(inventory));
  const summary = parseInventoryImportSummary(inventory);

  if (summary.organizationId !== orgId) {
    throw new ValidationError(
      `organization id mismatch: route=${orgId}, inventory=${summary.organizationId}`,
    );
  }

  if (dryRun) {
    sendJson(context.response, 200, {
      status: 'valid',
      dry_run: true,
      inventory_path: importPath,
      summary,
    });
    return;
  }

  const organizationRaw = asJsonMap(inventory.organization);
  if (!context.store.getOrganization(orgId)) {
    context.store.createOrganization(
      {
        id: orgId,
        orgId: parseString(organizationRaw.org_id, orgId),
        orgSlug: parseString(organizationRaw.org_slug, orgId),
        displayName: parseString(organizationRaw.display_name, orgId),
      },
      context.session.username,
    );
  }

  const instances = getInstances(inventory);
  for (const instance of instances) {
    const instanceId = parseString(instance.id);
    if (!instanceId) {
      continue;
    }
    const host = asJsonMap(instance.host);
    const existingInstance = context.store.getInstance(instanceId);
    if (!existingInstance) {
      context.store.createInstance(
        orgId,
        {
          id: instanceId,
          profile: parseString(instance.profile, 'usecase'),
          enabled: parseBoolean(instance.enabled, true),
          gatewayPort: parseNumber(host.gateway_port, 0),
          bind: parseString(host.bind, '127.0.0.1'),
        },
        context.session.username,
      );
    } else {
      context.store.updateInstance(
        instanceId,
        {
          profile: parseString(instance.profile, existingInstance.profile),
          enabled: parseBoolean(instance.enabled, existingInstance.enabled),
          gatewayPort: parseNumber(host.gateway_port, existingInstance.gatewayPort),
          bind: parseString(host.bind, existingInstance.bind),
        },
        context.session.username,
      );
    }

    const agents = Array.isArray(instance.agents) ? instance.agents : [];
    for (const rawAgent of agents) {
      const agent = asJsonMap(rawAgent);
      const agentId = parseString(agent.id);
      if (!agentId) {
        continue;
      }
      if (context.store.getAgent(agentId)) {
        context.store.updateAgent(
          agentId,
          {
            role: parseString(agent.role) || undefined,
            model: parseString(agent.model) || undefined,
            integrations: parseStringArray(agent.integrations),
            skills: parseStringArray(agent.skills),
            soulTemplate: parseString(agent.soul_template, parseString(agent.soulTemplate)) || undefined,
            toolsTemplate:
              parseString(agent.tools_template, parseString(agent.toolsTemplate)) || undefined,
          },
          context.session.username,
        );
        continue;
      }

      context.store.createAgent(
        instanceId,
        {
          id: agentId,
          role: parseString(agent.role, 'usecase'),
          model: parseString(agent.model),
          integrations: parseStringArray(agent.integrations),
          skills: parseStringArray(agent.skills),
          soulTemplate: parseString(agent.soul_template, parseString(agent.soulTemplate)),
          toolsTemplate: parseString(agent.tools_template, parseString(agent.toolsTemplate)),
        },
        context.session.username,
      );
    }
  }

  sendJson(context.response, 200, {
    status: 'imported',
    dry_run: false,
    inventory_path: importPath,
    summary,
  });
}

async function handleOrganizationInventoryExport(context: RequestContext, orgId: string): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (!isMethod(context, 'POST')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  const organization = context.store.getOrganization(orgId);
  if (!organization) {
    throw new ValidationError(`organization not found: ${orgId}`);
  }

  const settings = context.store.getOrganizationSettings(orgId);
  const instances = context.store.listInstances(orgId);
  const instancesOutput = instances.map((instance) => {
    const agents = context.store.listAgents(instance.id).map((agent) => ({
      id: agent.id,
      role: agent.role,
      model: agent.model,
      integrations: agent.integrations,
      skills: agent.skills,
      soul_template: agent.soulTemplate,
      tools_template: agent.toolsTemplate,
      bindings: [],
    }));

    return {
      id: instance.id,
      enabled: instance.enabled,
      profile: instance.profile,
      host: {
        bind: instance.bind,
        gateway_port: instance.gatewayPort,
      },
      paths: {
        config_dir: `../instances/${instance.id}/config`,
        state_dir: `../instances/${instance.id}/state`,
        workspace_root: `../instances/${instance.id}/workspaces`,
        generated_dir: `../.generated/${instance.id}`,
      },
      openclaw: {
        config_layers: [
          '../templates/openclaw/org.base.json5',
          `../templates/openclaw/profiles/${instance.profile}.base.json5`,
          `../instances/${instance.id}/config/instance.overrides.example.json5`,
        ],
      },
      agents,
    };
  });

  sendJson(context.response, 200, {
    version: 1,
    organization: {
      org_id: organization.orgId,
      org_slug: organization.orgSlug,
      display_name: organization.displayName,
    },
    settings: settings.settings,
    instances: instancesOutput,
  });
}

async function handleOrganizationInstances(context: RequestContext, orgId: string): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (isMethod(context, 'GET')) {
    sendJson(context.response, 200, {
      organization_id: orgId,
      instances: context.store.listInstances(orgId),
    });
    return;
  }

  if (isMethod(context, 'POST')) {
    requireWriteRole(context.session.role);
    const body = await parseJsonBody(context.request);
    const host = (body.host as JsonMap | undefined) ?? {};
    const created = context.store.createInstance(
      orgId,
      {
        id: parseString(body.id),
        enabled: parseBoolean(body.enabled, true),
        profile: parseString(body.profile, 'usecase'),
        gatewayPort: parseNumber(host.gateway_port, parseNumber(host.gatewayPort, 0)),
        bind: parseString(host.bind, '127.0.0.1'),
      },
      context.session.username,
    );
    sendJson(context.response, 201, created);
    return;
  }

  sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
}

async function handleInstanceById(context: RequestContext, instanceId: string): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (isMethod(context, 'PATCH')) {
    requireWriteRole(context.session.role);
    const body = await parseJsonBody(context.request);
    const host = (body.host as JsonMap | undefined) ?? {};
    const updated = context.store.updateInstance(
      instanceId,
      {
        enabled: typeof body.enabled === 'boolean' ? (body.enabled as boolean) : undefined,
        profile: parseString(body.profile) || undefined,
        gatewayPort:
          typeof host.gateway_port === 'number'
            ? (host.gateway_port as number)
            : typeof host.gatewayPort === 'number'
              ? (host.gatewayPort as number)
              : undefined,
        bind: parseString(host.bind) || undefined,
      },
      context.session.username,
    );
    sendJson(context.response, 200, updated);
    return;
  }

  if (isMethod(context, 'DELETE')) {
    requireWriteRole(context.session.role);
    context.store.deleteInstance(instanceId, context.session.username);
    sendNoContent(context.response);
    return;
  }

  sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
}

async function handleInstanceRuntime(context: RequestContext, instanceId: string, action: string): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }
  requireAdminRole(context.session.role);

  if (!isMethod(context, 'POST')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  if (!context.store.getInstance(instanceId)) {
    sendJson(context.response, 404, parseJsonError(404, `instance not found: ${instanceId}`));
    return;
  }

  const body = await parseJsonBody(context.request);
  const inventory = resolveRuntimeInventoryPath(body.inventory_path);
  const dryRun = parseBoolean(body.dry_run, action !== 'render');

  if (action === 'render') {
    const rendered = renderInstance(inventory, instanceId, dryRun);
    sendJson(context.response, 200, {
      action,
      dry_run: dryRun,
      inventory,
      result: rendered,
    });
    return;
  }

  if (dryRun) {
    const preview = renderInstance(inventory, instanceId, true);
    const target = deploymentTargetForInstance(inventory, instanceId);
    sendJson(context.response, 200, {
      action,
      dry_run: true,
      inventory,
      preview,
      target,
    });
    return;
  }

  const composeAction = action === 'deploy' ? 'up' : 'restart';
  const run = runCompose(inventory, instanceId, composeAction);
  const includeHealth = parseBoolean(body.include_health, true);
  const health = includeHealth ? healthInstance(inventory, instanceId) : undefined;

  sendJson(context.response, 200, {
    action,
    dry_run: false,
    inventory,
    run,
    ...(health ? { health } : {}),
  });
}

function handleInstanceHealth(context: RequestContext, instanceId: string): void {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (!isMethod(context, 'GET')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  if (!context.store.getInstance(instanceId)) {
    sendJson(context.response, 404, parseJsonError(404, `instance not found: ${instanceId}`));
    return;
  }

  const requestUrl = new URL(context.request.url ?? '/', 'http://localhost');
  const inventory = resolveRuntimeInventoryPath(requestUrl.searchParams.get('inventory_path'));
  const health = healthInstance(inventory, instanceId);
  sendJson(context.response, 200, health);
}

async function handleInstanceAgents(context: RequestContext, instanceId: string): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (isMethod(context, 'GET')) {
    sendJson(context.response, 200, {
      instance_id: instanceId,
      agents: context.store.listAgents(instanceId),
    });
    return;
  }

  if (isMethod(context, 'POST')) {
    requireWriteRole(context.session.role);
    const body = await parseJsonBody(context.request);
    const created = context.store.createAgent(
      instanceId,
      {
        id: parseString(body.id),
        role: parseString(body.role, 'usecase'),
        model: parseString(body.model),
        integrations: parseStringArray(body.integrations),
        skills: parseStringArray(body.skills),
        soulTemplate: parseString(body.soul_template, parseString(body.soulTemplate)),
        toolsTemplate: parseString(body.tools_template, parseString(body.toolsTemplate)),
      },
      context.session.username,
    );
    sendJson(context.response, 201, created);
    return;
  }

  sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
}

async function handleAgentById(context: RequestContext, agentId: string): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (isMethod(context, 'GET')) {
    const agent = context.store.getAgent(agentId);
    if (!agent) {
      sendJson(context.response, 404, parseJsonError(404, `agent not found: ${agentId}`));
      return;
    }
    sendJson(context.response, 200, agent);
    return;
  }

  if (isMethod(context, 'PATCH')) {
    requireWriteRole(context.session.role);
    const body = await parseJsonBody(context.request);
    const updated = context.store.updateAgent(
      agentId,
      {
        role: parseString(body.role) || undefined,
        model: parseString(body.model) || undefined,
        integrations: Array.isArray(body.integrations) ? parseStringArray(body.integrations) : undefined,
        skills: Array.isArray(body.skills) ? parseStringArray(body.skills) : undefined,
        soulTemplate: parseString(body.soul_template, parseString(body.soulTemplate)) || undefined,
        toolsTemplate: parseString(body.tools_template, parseString(body.toolsTemplate)) || undefined,
      },
      context.session.username,
    );
    sendJson(context.response, 200, updated);
    return;
  }

  if (isMethod(context, 'DELETE')) {
    requireWriteRole(context.session.role);
    context.store.deleteAgent(agentId, context.session.username);
    sendNoContent(context.response);
    return;
  }

  sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
}

async function handleAgentTemplateApply(
  context: RequestContext,
  agentId: string,
  kind: 'soul' | 'tools',
): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }
  requireWriteRole(context.session.role);
  if (!isMethod(context, 'POST')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  const body = await parseJsonBody(context.request);
  const template = requireNonEmpty(parseString(body.template), 'template');
  const patch =
    kind === 'soul'
      ? {
          soulTemplate: template,
        }
      : {
          toolsTemplate: template,
        };
  const updated = context.store.updateAgent(agentId, patch, context.session.username);
  sendJson(context.response, 200, {
    status: 'applied',
    kind,
    template,
    agent: updated,
  });
}

async function handleProviders(context: RequestContext): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (!isMethod(context, 'GET')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  const allKeys = context.store.listProviderKeys();
  const byProvider = groupedProviderKeys(allKeys);
  const usageByProvider = context.store.listUsageByProvider();
  const usageMap = new Map<string, { tokens: number; costUsd: number }>();
  for (const usage of usageByProvider) {
    usageMap.set(usage.provider, {
      tokens: usage.totalTokens,
      costUsd: usage.costUsd,
    });
  }

  const assignments = context.store.listAgentModelAssignments();
  const agentsByProviderModel = new Map<string, string[]>();
  for (const assignment of assignments) {
    const key = `${assignment.provider}/${assignment.model}`;
    const existing = agentsByProviderModel.get(key) ?? [];
    if (!existing.includes(assignment.agentId)) {
      existing.push(assignment.agentId);
    }
    agentsByProviderModel.set(key, existing);
  }

  const providers = Object.keys(SUPPORTED_MODELS).map((provider) => {
    const modelRows = SUPPORTED_MODELS[provider].map((model) => ({
      model,
      agents: agentsByProviderModel.get(`${provider}/${model}`) ?? [],
    }));
    const usage = usageMap.get(provider) ?? { tokens: 0, costUsd: 0 };

    return {
      provider,
      supported_models: modelRows,
      keys: byProvider[provider] ?? [],
      usage: {
        tokens: usage.tokens,
        cost_usd: usage.costUsd,
      },
      limits: {
        monthly_usd:
          provider === 'openai'
            ? parseEnvNumber(process.env.OCO_OPENAI_MONTHLY_LIMIT_USD, 0)
            : provider === 'anthropic'
              ? parseEnvNumber(process.env.OCO_ANTHROPIC_MONTHLY_LIMIT_USD, 0)
              : 0,
      },
    };
  });

  sendJson(context.response, 200, { providers });
}

async function handleProviderKeys(context: RequestContext, provider: string): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (!isMethod(context, 'POST')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  requireAdminRole(context.session.role);
  const body = await parseJsonBody(context.request);
  const masterKey = process.env.OCO_ADMIN_MASTER_KEY ?? '';
  const created = context.store.createProviderKey(
    provider,
    parseString(body.label),
    parseString(body.secret),
    context.session.username,
    masterKey,
  );
  sendJson(context.response, 201, created);
}

function handleDeleteProviderKey(
  context: RequestContext,
  provider: string,
  keyId: string,
): void {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (!isMethod(context, 'DELETE')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  requireAdminRole(context.session.role);
  context.store.deleteProviderKey(provider, keyId, context.session.username);
  sendNoContent(context.response);
}

function handleUsageProviders(context: RequestContext): void {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }

  if (!isMethod(context, 'GET')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  const rows = context.store.listUsageByProvider().map((item) => ({
    provider: item.provider,
    prompt_tokens: item.promptTokens,
    completion_tokens: item.completionTokens,
    total_tokens: item.totalTokens,
    cost_usd: item.costUsd,
  }));
  sendJson(context.response, 200, { providers: rows });
}

function handleUsageProviderModels(context: RequestContext, provider: string): void {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }
  if (!isMethod(context, 'GET')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  const rows = context.store.listUsageByProviderModels(provider).map((item) => ({
    provider: item.provider,
    model: item.model,
    prompt_tokens: item.promptTokens,
    completion_tokens: item.completionTokens,
    total_tokens: item.totalTokens,
    cost_usd: item.costUsd,
  }));

  sendJson(context.response, 200, { provider, models: rows });
}

function handleUsageAgent(context: RequestContext, agentId: string): void {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }
  if (!isMethod(context, 'GET')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }
  const rows = context.store.listUsageByAgent(agentId).map((item) => ({
    agent_id: item.agentId,
    provider: item.provider,
    model: item.model,
    prompt_tokens: item.promptTokens,
    completion_tokens: item.completionTokens,
    total_tokens: item.totalTokens,
    cost_usd: item.costUsd,
  }));

  sendJson(context.response, 200, {
    agent_id: agentId,
    usage: rows,
  });
}

async function handleUsageEvents(context: RequestContext): Promise<void> {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }
  requireWriteRole(context.session.role);
  if (!isMethod(context, 'POST')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  const body = await parseJsonBody(context.request);
  context.store.recordUsageEvent(
    {
      provider: parseString(body.provider),
      model: parseString(body.model),
      agentId: parseString(body.agent_id, parseString(body.agentId)),
      promptTokens: parseNumber(body.prompt_tokens, parseNumber(body.promptTokens, 0)),
      completionTokens: parseNumber(body.completion_tokens, parseNumber(body.completionTokens, 0)),
      totalTokens: parseNumber(body.total_tokens, parseNumber(body.totalTokens, 0)),
      costUsd: parseNumber(body.cost_usd, parseNumber(body.costUsd, 0)),
      occurredAt: parseString(body.occurred_at, parseString(body.occurredAt)),
    },
    context.session.username,
  );

  sendJson(context.response, 201, {
    status: 'recorded',
  });
}

function handleAuditEvents(context: RequestContext): void {
  if (!context.session) {
    throw new ValidationError('unauthorized');
  }
  if (!isMethod(context, 'GET')) {
    sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
    return;
  }

  const requestUrl = new URL(context.request.url ?? '/', 'http://localhost');
  const limitRaw = requestUrl.searchParams.get('limit');
  const limit = limitRaw ? Number(limitRaw) : 100;
  sendJson(context.response, 200, {
    events: context.store.listAuditEvents(limit),
  });
}

async function routeRequest(context: RequestContext): Promise<void> {
  if (context.pathname === '/') {
    context.response.statusCode = 302;
    context.response.setHeader('location', '/admin');
    context.response.end();
    return;
  }

  if (hasAdminAsset(context.pathname)) {
    const asset = getAdminAsset(context.pathname);
    context.response.statusCode = 200;
    context.response.setHeader('content-type', asset.contentType);
    context.response.end(asset.body);
    return;
  }

  if (context.pathname === '/healthz' || context.pathname === '/readyz') {
    sendJson(context.response, 200, { status: 'ok' });
    return;
  }

  if (context.pathname === '/api/v1/auth/login') {
    if (!isMethod(context, 'POST')) {
      sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
      return;
    }
    await handleLogin(context);
    return;
  }

  context.token = extractToken(context.request);
  context.session = context.auth.authenticate(context.token);

  if (context.pathname === '/api/v1/auth/me') {
    if (!isMethod(context, 'GET')) {
      sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
      return;
    }
    handleAuthMe(context);
    return;
  }

  if (context.pathname === '/api/v1/auth/logout') {
    if (!isMethod(context, 'POST')) {
      sendJson(context.response, 405, parseJsonError(405, 'method not allowed'));
      return;
    }
    handleLogout(context);
    return;
  }

  if (
    context.pathname === '/api/v1/onboarding/organization' ||
    context.pathname === '/api/v1/onboarding/organization/validate'
  ) {
    await handleOnboardingOrganization(context, 'preview');
    return;
  }

  if (context.pathname === '/api/v1/onboarding/organization/commit') {
    await handleOnboardingOrganization(context, 'commit');
    return;
  }

  if (context.pathname === '/api/v1/onboarding/agent' || context.pathname === '/api/v1/onboarding/agent/validate') {
    await handleOnboardingAgent(context, 'preview');
    return;
  }

  if (context.pathname === '/api/v1/onboarding/agent/commit') {
    await handleOnboardingAgent(context, 'commit');
    return;
  }

  if (context.pathname === '/api/v1/organizations') {
    await handleOrganizations(context);
    return;
  }

  let match = pathMatch(context.pathname, /^\/api\/v1\/organizations\/([^/]+)$/);
  if (match) {
    await handleOrganizationById(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/organizations\/([^/]+)\/overview$/);
  if (match) {
    handleOrganizationOverview(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/organizations\/([^/]+)\/settings$/);
  if (match) {
    await handleOrganizationSettings(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/organizations\/([^/]+)\/inventory\/import$/);
  if (match) {
    await handleOrganizationInventoryImport(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/organizations\/([^/]+)\/inventory\/export$/);
  if (match) {
    await handleOrganizationInventoryExport(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/organizations\/([^/]+)\/instances$/);
  if (match) {
    await handleOrganizationInstances(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/instances\/([^/]+)$/);
  if (match) {
    await handleInstanceById(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/instances\/([^/]+)\/runtime\/(render|deploy|restart)$/);
  if (match) {
    await handleInstanceRuntime(context, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/instances\/([^/]+)\/health$/);
  if (match) {
    handleInstanceHealth(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/instances\/([^/]+)\/agents$/);
  if (match) {
    await handleInstanceAgents(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/agents\/([^/]+)$/);
  if (match) {
    await handleAgentById(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/agents\/([^/]+)\/soul\/apply$/);
  if (match) {
    await handleAgentTemplateApply(context, decodeURIComponent(match[1]), 'soul');
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/agents\/([^/]+)\/tools\/apply$/);
  if (match) {
    await handleAgentTemplateApply(context, decodeURIComponent(match[1]), 'tools');
    return;
  }

  if (context.pathname === '/api/v1/settings/providers') {
    await handleProviders(context);
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/settings\/providers\/([^/]+)\/keys$/);
  if (match) {
    await handleProviderKeys(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/settings\/providers\/([^/]+)\/keys\/([^/]+)$/);
  if (match) {
    handleDeleteProviderKey(context, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    return;
  }

  if (context.pathname === '/api/v1/usage/providers') {
    handleUsageProviders(context);
    return;
  }

  if (context.pathname === '/api/v1/usage/events') {
    await handleUsageEvents(context);
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/usage\/providers\/([^/]+)\/models$/);
  if (match) {
    handleUsageProviderModels(context, decodeURIComponent(match[1]));
    return;
  }

  match = pathMatch(context.pathname, /^\/api\/v1\/usage\/agents\/([^/]+)$/);
  if (match) {
    handleUsageAgent(context, decodeURIComponent(match[1]));
    return;
  }

  if (context.pathname === '/api/v1/audit-events' || context.pathname === '/audit-events') {
    handleAuditEvents(context);
    return;
  }

  sendJson(context.response, 404, parseJsonError(404, `route not found: ${context.pathname}`));
}

export async function startAdminApiServer(
  options: StartAdminApiServerOptions = {},
): Promise<AdminApiServer> {
  const dbPath = options.dbPath?.trim() || DEFAULT_DB_PATH;
  const host = options.host?.trim() || DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  const port = Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : DEFAULT_PORT;

  const store = await AdminStore.open(dbPath);
  const auth = new AuthService();

  const server = createServer((request, response) => {
    const method = (request.method || 'GET').toUpperCase();
    const url = new URL(request.url || '/', `http://${host}`);
    const context: RequestContext = {
      request,
      response,
      pathname: url.pathname,
      method,
      store,
      auth,
    };

    void routeRequest(context).catch((error) => {
      const status = statusForError(error);
      sendJson(response, status, parseJsonError(status, error instanceof Error ? error.message : String(error)));
    });
  });

  const listen = async (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });

  const maxListenAttempts = port === 0 ? 8 : 1;
  for (let attempt = 0; attempt < maxListenAttempts; attempt += 1) {
    try {
      await listen();
      break;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      const isLastAttempt = attempt === maxListenAttempts - 1;
      if (errorCode !== 'EADDRINUSE' || isLastAttempt) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }

  const closePromise = new Promise<void>((resolve) => {
    server.once('close', () => {
      store.close();
      resolve();
    });
  });

  const address = server.address() as AddressInfo;

  return {
    host,
    port: address.port,
    dbPath,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    waitUntilClosed: () => closePromise,
  };
}
