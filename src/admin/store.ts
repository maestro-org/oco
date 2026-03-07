import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ValidationError } from '../errors';
import { ensureDir } from '../utils';
import { encryptSecret, secretLast4 } from './crypto';
import {
  AgentRecord,
  AuditEventRecord,
  InstanceRecord,
  OrganizationRecord,
  OrganizationSettingsRecord,
  ProviderKeyRecord,
  UsageAgentSummary,
  UsageEventInput,
  UsageProviderModelSummary,
  UsageProviderSummary,
} from './types';

type SqlValue = string | number | null;
type RowValue = string | number | null;

interface SqlExecResult {
  columns: string[];
  values: RowValue[][];
}

interface SqlDatabase {
  run(sql: string, params?: SqlValue[]): SqlDatabase;
  exec(sql: string, params?: SqlValue[]): SqlExecResult[];
  export(): Uint8Array;
}

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

interface OrganizationInput {
  id: string;
  orgId: string;
  orgSlug: string;
  displayName: string;
}

interface OrganizationPatch {
  orgId?: string;
  orgSlug?: string;
  displayName?: string;
}

interface InstanceInput {
  id: string;
  profile: string;
  enabled: boolean;
  gatewayPort: number;
  bind: string;
}

interface InstancePatch {
  profile?: string;
  enabled?: boolean;
  gatewayPort?: number;
  bind?: string;
}

interface AgentInput {
  id: string;
  role: string;
  model: string;
  integrations: string[];
  skills: string[];
  soulTemplate: string;
  toolsTemplate: string;
}

interface AgentPatch {
  role?: string;
  model?: string;
  integrations?: string[];
  skills?: string[];
  soulTemplate?: string;
  toolsTemplate?: string;
}

const initSqlJs = require('sql.js') as (config: {
  locateFile: (file: string) => string;
}) => Promise<SqlJsStatic>;

let sqlStaticPromise: Promise<SqlJsStatic> | undefined;

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlStaticPromise) {
    sqlStaticPromise = initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    });
  }
  return sqlStaticPromise;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: RowValue): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: RowValue): number {
  return typeof value === 'number' ? value : 0;
}

function parseArray(raw: string): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function parseObject(raw: string): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') {
      continue;
    }
    const item = raw.trim();
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    output.push(item);
  }
  return output;
}

function normalizeNonEmpty(value: string, label: string): string {
  const output = value.trim();
  if (!output) {
    throw new ValidationError(`${label} must be a non-empty string`);
  }
  return output;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AdminStore {
  readonly dbPath: string;
  private readonly db: SqlDatabase;

  private constructor(dbPath: string, db: SqlDatabase) {
    this.dbPath = dbPath;
    this.db = db;
  }

  static async open(dbPath: string): Promise<AdminStore> {
    const SQL = await loadSqlJs();
    const normalizedPath = dbPath.trim();
    if (!normalizedPath) {
      throw new ValidationError('db path must be non-empty');
    }

    const db = existsSync(normalizedPath)
      ? new SQL.Database(new Uint8Array(readFileSync(normalizedPath)))
      : new SQL.Database();

    const store = new AdminStore(normalizedPath, db);
    store.initializeSchema();
    store.persist();
    return store;
  }

  close(): void {
    this.persist();
  }

  private persist(): void {
    ensureDir(dirname(this.dbPath));
    const bytes = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(bytes));
  }

  private initializeSchema(): void {
    this.db.run('PRAGMA foreign_keys = ON');
    this.db.run(
      `CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        org_slug TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS organization_settings (
        organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
        settings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS instances (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL,
        profile TEXT NOT NULL,
        gateway_port INTEGER NOT NULL,
        bind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        model TEXT NOT NULL,
        integrations_json TEXT NOT NULL,
        skills_json TEXT NOT NULL,
        soul_template TEXT NOT NULL,
        tools_template TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS provider_api_keys (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        encrypted_secret TEXT NOT NULL,
        last4 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS model_usage_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    );
  }

  private query(sql: string, params: SqlValue[] = []): Array<Record<string, RowValue>> {
    const results = this.db.exec(sql, params);
    if (results.length === 0) {
      return [];
    }

    const first = results[0];
    return first.values.map((valueSet) => {
      const row: Record<string, RowValue> = {};
      for (let index = 0; index < first.columns.length; index += 1) {
        row[first.columns[index]] = valueSet[index] ?? null;
      }
      return row;
    });
  }

  private insertAudit(
    actor: string,
    action: string,
    resourceType: string,
    resourceId: string,
    payload: Record<string, unknown>,
  ): void {
    this.db.run(
      `INSERT INTO audit_events (id, actor, action, resource_type, resource_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), actor, action, resourceType, resourceId, JSON.stringify(payload), nowIso()],
    );
  }

  listOrganizations(): OrganizationRecord[] {
    const rows = this.query(
      `SELECT id, org_id, org_slug, display_name, created_at, updated_at
       FROM organizations ORDER BY id`,
    );
    return rows.map((row) => ({
      id: asString(row.id),
      orgId: asString(row.org_id),
      orgSlug: asString(row.org_slug),
      displayName: asString(row.display_name),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    }));
  }

  getOrganization(id: string): OrganizationRecord | undefined {
    const rows = this.query(
      `SELECT id, org_id, org_slug, display_name, created_at, updated_at
       FROM organizations WHERE id = ?`,
      [id],
    );
    if (rows.length === 0) {
      return undefined;
    }
    const row = rows[0];
    return {
      id: asString(row.id),
      orgId: asString(row.org_id),
      orgSlug: asString(row.org_slug),
      displayName: asString(row.display_name),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  createOrganization(input: OrganizationInput, actor: string): OrganizationRecord {
    const id = normalizeNonEmpty(input.id, 'id');
    const orgId = normalizeNonEmpty(input.orgId, 'orgId');
    const orgSlug = normalizeNonEmpty(input.orgSlug, 'orgSlug');
    const displayName = normalizeNonEmpty(input.displayName, 'displayName');
    const createdAt = nowIso();

    try {
      this.db.run(
        `INSERT INTO organizations (id, org_id, org_slug, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, orgId, orgSlug, displayName, createdAt, createdAt],
      );
      this.db.run(
        `INSERT INTO organization_settings (organization_id, settings_json, updated_at)
         VALUES (?, ?, ?)`,
        [id, JSON.stringify({}), createdAt],
      );
    } catch (error) {
      throw new ValidationError(`failed to create organization: ${errorMessage(error)}`);
    }

    this.insertAudit(actor, 'organization.create', 'organization', id, {
      orgId,
      orgSlug,
      displayName,
    });
    this.persist();

    const created = this.getOrganization(id);
    if (!created) {
      throw new ValidationError(`failed to load created organization: ${id}`);
    }
    return created;
  }

  updateOrganization(id: string, patch: OrganizationPatch, actor: string): OrganizationRecord {
    const existing = this.getOrganization(id);
    if (!existing) {
      throw new ValidationError(`organization not found: ${id}`);
    }

    const orgId = patch.orgId !== undefined ? normalizeNonEmpty(patch.orgId, 'orgId') : existing.orgId;
    const orgSlug =
      patch.orgSlug !== undefined ? normalizeNonEmpty(patch.orgSlug, 'orgSlug') : existing.orgSlug;
    const displayName =
      patch.displayName !== undefined
        ? normalizeNonEmpty(patch.displayName, 'displayName')
        : existing.displayName;
    const updatedAt = nowIso();

    try {
      this.db.run(
        `UPDATE organizations
         SET org_id = ?, org_slug = ?, display_name = ?, updated_at = ?
         WHERE id = ?`,
        [orgId, orgSlug, displayName, updatedAt, id],
      );
    } catch (error) {
      throw new ValidationError(`failed to update organization: ${errorMessage(error)}`);
    }

    this.insertAudit(actor, 'organization.update', 'organization', id, {
      orgId,
      orgSlug,
      displayName,
    });
    this.persist();

    const updated = this.getOrganization(id);
    if (!updated) {
      throw new ValidationError(`failed to load updated organization: ${id}`);
    }
    return updated;
  }

  getOrganizationSettings(organizationId: string): OrganizationSettingsRecord {
    const org = this.getOrganization(organizationId);
    if (!org) {
      throw new ValidationError(`organization not found: ${organizationId}`);
    }

    const rows = this.query(
      `SELECT settings_json, updated_at
       FROM organization_settings
       WHERE organization_id = ?`,
      [organizationId],
    );

    if (rows.length === 0) {
      return {
        organizationId,
        settings: {},
        updatedAt: org.updatedAt,
      };
    }

    const row = rows[0];
    return {
      organizationId,
      settings: parseObject(asString(row.settings_json)),
      updatedAt: asString(row.updated_at),
    };
  }

  updateOrganizationSettings(
    organizationId: string,
    patch: Record<string, unknown>,
    actor: string,
  ): OrganizationSettingsRecord {
    const existing = this.getOrganizationSettings(organizationId);
    const merged = { ...existing.settings, ...patch };
    const updatedAt = nowIso();

    this.db.run(
      `INSERT INTO organization_settings (organization_id, settings_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(organization_id)
       DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
      [organizationId, JSON.stringify(merged), updatedAt],
    );

    this.insertAudit(actor, 'organization.settings.update', 'organization', organizationId, {
      patch,
    });
    this.persist();

    return {
      organizationId,
      settings: merged,
      updatedAt,
    };
  }

  listInstances(organizationId: string): InstanceRecord[] {
    const rows = this.query(
      `SELECT id, organization_id, enabled, profile, gateway_port, bind, created_at, updated_at
       FROM instances WHERE organization_id = ? ORDER BY id`,
      [organizationId],
    );

    return rows.map((row) => ({
      id: asString(row.id),
      organizationId: asString(row.organization_id),
      enabled: asNumber(row.enabled) === 1,
      profile: asString(row.profile),
      gatewayPort: asNumber(row.gateway_port),
      bind: asString(row.bind),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    }));
  }

  getInstance(id: string): InstanceRecord | undefined {
    const rows = this.query(
      `SELECT id, organization_id, enabled, profile, gateway_port, bind, created_at, updated_at
       FROM instances WHERE id = ?`,
      [id],
    );
    if (rows.length === 0) {
      return undefined;
    }
    const row = rows[0];
    return {
      id: asString(row.id),
      organizationId: asString(row.organization_id),
      enabled: asNumber(row.enabled) === 1,
      profile: asString(row.profile),
      gatewayPort: asNumber(row.gateway_port),
      bind: asString(row.bind),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  createInstance(organizationId: string, input: InstanceInput, actor: string): InstanceRecord {
    if (!this.getOrganization(organizationId)) {
      throw new ValidationError(`organization not found: ${organizationId}`);
    }

    const id = normalizeNonEmpty(input.id, 'id');
    const profile = normalizeNonEmpty(input.profile, 'profile');
    const bind = normalizeNonEmpty(input.bind, 'bind');
    const gatewayPort = input.gatewayPort;
    if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) {
      throw new ValidationError('gateway_port must be a valid port integer');
    }

    const createdAt = nowIso();
    try {
      this.db.run(
        `INSERT INTO instances
         (id, organization_id, enabled, profile, gateway_port, bind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, organizationId, input.enabled ? 1 : 0, profile, gatewayPort, bind, createdAt, createdAt],
      );
    } catch (error) {
      throw new ValidationError(`failed to create instance: ${errorMessage(error)}`);
    }

    this.insertAudit(actor, 'instance.create', 'instance', id, {
      organizationId,
      profile,
      enabled: input.enabled,
      gatewayPort,
      bind,
    });
    this.persist();

    const created = this.getInstance(id);
    if (!created) {
      throw new ValidationError(`failed to load created instance: ${id}`);
    }
    return created;
  }

  updateInstance(id: string, patch: InstancePatch, actor: string): InstanceRecord {
    const existing = this.getInstance(id);
    if (!existing) {
      throw new ValidationError(`instance not found: ${id}`);
    }

    const profile =
      patch.profile !== undefined ? normalizeNonEmpty(patch.profile, 'profile') : existing.profile;
    const bind = patch.bind !== undefined ? normalizeNonEmpty(patch.bind, 'bind') : existing.bind;
    const enabled = patch.enabled !== undefined ? patch.enabled : existing.enabled;
    const gatewayPort = patch.gatewayPort !== undefined ? patch.gatewayPort : existing.gatewayPort;
    if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) {
      throw new ValidationError('gateway_port must be a valid port integer');
    }

    try {
      this.db.run(
        `UPDATE instances
         SET enabled = ?, profile = ?, gateway_port = ?, bind = ?, updated_at = ?
         WHERE id = ?`,
        [enabled ? 1 : 0, profile, gatewayPort, bind, nowIso(), id],
      );
    } catch (error) {
      throw new ValidationError(`failed to update instance: ${errorMessage(error)}`);
    }

    this.insertAudit(actor, 'instance.update', 'instance', id, {
      enabled,
      profile,
      gatewayPort,
      bind,
    });
    this.persist();

    const updated = this.getInstance(id);
    if (!updated) {
      throw new ValidationError(`failed to load updated instance: ${id}`);
    }
    return updated;
  }

  deleteInstance(id: string, actor: string): void {
    const existing = this.getInstance(id);
    if (!existing) {
      throw new ValidationError(`instance not found: ${id}`);
    }

    this.db.run('DELETE FROM instances WHERE id = ?', [id]);
    this.insertAudit(actor, 'instance.delete', 'instance', id, { id });
    this.persist();
  }

  listAgents(instanceId: string): AgentRecord[] {
    const rows = this.query(
      `SELECT id, instance_id, role, model, integrations_json, skills_json, soul_template, tools_template, created_at, updated_at
       FROM agents WHERE instance_id = ? ORDER BY id`,
      [instanceId],
    );

    return rows.map((row) => ({
      id: asString(row.id),
      instanceId: asString(row.instance_id),
      role: asString(row.role),
      model: asString(row.model),
      integrations: parseArray(asString(row.integrations_json)),
      skills: parseArray(asString(row.skills_json)),
      soulTemplate: asString(row.soul_template),
      toolsTemplate: asString(row.tools_template),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    }));
  }

  listAllAgents(): AgentRecord[] {
    const rows = this.query(
      `SELECT id, instance_id, role, model, integrations_json, skills_json, soul_template, tools_template, created_at, updated_at
       FROM agents ORDER BY id`,
    );

    return rows.map((row) => ({
      id: asString(row.id),
      instanceId: asString(row.instance_id),
      role: asString(row.role),
      model: asString(row.model),
      integrations: parseArray(asString(row.integrations_json)),
      skills: parseArray(asString(row.skills_json)),
      soulTemplate: asString(row.soul_template),
      toolsTemplate: asString(row.tools_template),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    }));
  }

  listOrganizationAgents(organizationId: string): AgentRecord[] {
    const rows = this.query(
      `SELECT a.id, a.instance_id, a.role, a.model, a.integrations_json, a.skills_json, a.soul_template, a.tools_template, a.created_at, a.updated_at
       FROM agents a
       JOIN instances i ON i.id = a.instance_id
       WHERE i.organization_id = ?
       ORDER BY a.id`,
      [organizationId],
    );

    return rows.map((row) => ({
      id: asString(row.id),
      instanceId: asString(row.instance_id),
      role: asString(row.role),
      model: asString(row.model),
      integrations: parseArray(asString(row.integrations_json)),
      skills: parseArray(asString(row.skills_json)),
      soulTemplate: asString(row.soul_template),
      toolsTemplate: asString(row.tools_template),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    }));
  }

  getAgent(id: string): AgentRecord | undefined {
    const rows = this.query(
      `SELECT id, instance_id, role, model, integrations_json, skills_json, soul_template, tools_template, created_at, updated_at
       FROM agents WHERE id = ?`,
      [id],
    );
    if (rows.length === 0) {
      return undefined;
    }
    const row = rows[0];
    return {
      id: asString(row.id),
      instanceId: asString(row.instance_id),
      role: asString(row.role),
      model: asString(row.model),
      integrations: parseArray(asString(row.integrations_json)),
      skills: parseArray(asString(row.skills_json)),
      soulTemplate: asString(row.soul_template),
      toolsTemplate: asString(row.tools_template),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  createAgent(instanceId: string, input: AgentInput, actor: string): AgentRecord {
    if (!this.getInstance(instanceId)) {
      throw new ValidationError(`instance not found: ${instanceId}`);
    }

    const id = normalizeNonEmpty(input.id, 'id');
    const role = normalizeNonEmpty(input.role, 'role');
    const model = input.model.trim();
    const soulTemplate = input.soulTemplate.trim();
    const toolsTemplate = input.toolsTemplate.trim();
    const integrations = normalizeStringArray(input.integrations);
    const skills = normalizeStringArray(input.skills);
    const createdAt = nowIso();

    try {
      this.db.run(
        `INSERT INTO agents
         (id, instance_id, role, model, integrations_json, skills_json, soul_template, tools_template, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          instanceId,
          role,
          model,
          JSON.stringify(integrations),
          JSON.stringify(skills),
          soulTemplate,
          toolsTemplate,
          createdAt,
          createdAt,
        ],
      );
    } catch (error) {
      throw new ValidationError(`failed to create agent: ${errorMessage(error)}`);
    }

    this.insertAudit(actor, 'agent.create', 'agent', id, {
      instanceId,
      role,
      model,
      integrations,
      skills,
      soulTemplate,
      toolsTemplate,
    });
    this.persist();

    const created = this.getAgent(id);
    if (!created) {
      throw new ValidationError(`failed to load created agent: ${id}`);
    }
    return created;
  }

  updateAgent(id: string, patch: AgentPatch, actor: string): AgentRecord {
    const existing = this.getAgent(id);
    if (!existing) {
      throw new ValidationError(`agent not found: ${id}`);
    }

    const role = patch.role !== undefined ? normalizeNonEmpty(patch.role, 'role') : existing.role;
    const model = patch.model !== undefined ? patch.model.trim() : existing.model;
    const soulTemplate =
      patch.soulTemplate !== undefined ? patch.soulTemplate.trim() : existing.soulTemplate;
    const toolsTemplate =
      patch.toolsTemplate !== undefined ? patch.toolsTemplate.trim() : existing.toolsTemplate;
    const integrations =
      patch.integrations !== undefined ? normalizeStringArray(patch.integrations) : existing.integrations;
    const skills = patch.skills !== undefined ? normalizeStringArray(patch.skills) : existing.skills;

    try {
      this.db.run(
        `UPDATE agents
         SET role = ?, model = ?, integrations_json = ?, skills_json = ?, soul_template = ?, tools_template = ?, updated_at = ?
         WHERE id = ?`,
        [
          role,
          model,
          JSON.stringify(integrations),
          JSON.stringify(skills),
          soulTemplate,
          toolsTemplate,
          nowIso(),
          id,
        ],
      );
    } catch (error) {
      throw new ValidationError(`failed to update agent: ${errorMessage(error)}`);
    }

    this.insertAudit(actor, 'agent.update', 'agent', id, {
      role,
      model,
      integrations,
      skills,
      soulTemplate,
      toolsTemplate,
    });
    this.persist();

    const updated = this.getAgent(id);
    if (!updated) {
      throw new ValidationError(`failed to load updated agent: ${id}`);
    }
    return updated;
  }

  deleteAgent(id: string, actor: string): void {
    const existing = this.getAgent(id);
    if (!existing) {
      throw new ValidationError(`agent not found: ${id}`);
    }
    this.db.run('DELETE FROM agents WHERE id = ?', [id]);
    this.insertAudit(actor, 'agent.delete', 'agent', id, { id });
    this.persist();
  }

  recordUsageEvent(input: UsageEventInput, actor?: string): void {
    const provider = normalizeNonEmpty(input.provider, 'provider');
    const model = normalizeNonEmpty(input.model, 'model');
    const agentId = normalizeNonEmpty(input.agentId, 'agentId');
    if (!this.getAgent(agentId)) {
      throw new ValidationError(`agent not found: ${agentId}`);
    }
    const promptTokens =
      Number.isInteger(input.promptTokens) && input.promptTokens >= 0 ? input.promptTokens : 0;
    const completionTokens =
      Number.isInteger(input.completionTokens) && input.completionTokens >= 0
        ? input.completionTokens
        : 0;
    const totalTokens =
      Number.isInteger(input.totalTokens) && input.totalTokens >= 0
        ? input.totalTokens
        : promptTokens + completionTokens;
    const costUsd = Number.isFinite(input.costUsd) && input.costUsd >= 0 ? input.costUsd : 0;
    const occurredAt =
      typeof input.occurredAt === 'string' && input.occurredAt.trim() ? input.occurredAt : nowIso();

    this.db.run(
      `INSERT INTO model_usage_events
       (id, provider, model, agent_id, prompt_tokens, completion_tokens, total_tokens, cost_usd, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        provider,
        model,
        agentId,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd,
        occurredAt,
        nowIso(),
      ],
    );

    if (actor) {
      this.insertAudit(actor, 'usage.event.create', 'usage_event', agentId, {
        provider,
        model,
        totalTokens,
        costUsd,
      });
    }
    this.persist();
  }

  listUsageByProvider(): UsageProviderSummary[] {
    const rows = this.query(
      `SELECT provider,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM model_usage_events
       GROUP BY provider
       ORDER BY provider`,
    );

    return rows.map((row) => ({
      provider: asString(row.provider),
      promptTokens: asNumber(row.prompt_tokens),
      completionTokens: asNumber(row.completion_tokens),
      totalTokens: asNumber(row.total_tokens),
      costUsd: asNumber(row.cost_usd),
    }));
  }

  listUsageByProviderModels(provider: string): UsageProviderModelSummary[] {
    const normalizedProvider = normalizeNonEmpty(provider, 'provider');
    const rows = this.query(
      `SELECT provider, model,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM model_usage_events
       WHERE provider = ?
       GROUP BY provider, model
       ORDER BY model`,
      [normalizedProvider],
    );

    return rows.map((row) => ({
      provider: asString(row.provider),
      model: asString(row.model),
      promptTokens: asNumber(row.prompt_tokens),
      completionTokens: asNumber(row.completion_tokens),
      totalTokens: asNumber(row.total_tokens),
      costUsd: asNumber(row.cost_usd),
    }));
  }

  listUsageByAgent(agentId: string): UsageAgentSummary[] {
    const normalizedAgentId = normalizeNonEmpty(agentId, 'agentId');
    const rows = this.query(
      `SELECT agent_id, provider, model,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM model_usage_events
       WHERE agent_id = ?
       GROUP BY agent_id, provider, model
       ORDER BY provider, model`,
      [normalizedAgentId],
    );

    return rows.map((row) => ({
      agentId: asString(row.agent_id),
      provider: asString(row.provider),
      model: asString(row.model),
      promptTokens: asNumber(row.prompt_tokens),
      completionTokens: asNumber(row.completion_tokens),
      totalTokens: asNumber(row.total_tokens),
      costUsd: asNumber(row.cost_usd),
    }));
  }

  listAgentModelAssignments(): Array<{ provider: string; model: string; agentId: string }> {
    const agents = this.listAllAgents();
    const output: Array<{ provider: string; model: string; agentId: string }> = [];
    for (const agent of agents) {
      const rawModel = agent.model.trim();
      if (!rawModel || !rawModel.includes('/')) {
        continue;
      }
      const [provider, model] = rawModel.split('/', 2);
      if (!provider || !model) {
        continue;
      }
      output.push({
        provider,
        model,
        agentId: agent.id,
      });
    }
    return output;
  }

  createProviderKey(
    provider: string,
    label: string,
    secret: string,
    actor: string,
    masterKey: string,
  ): ProviderKeyRecord {
    const normalizedProvider = normalizeNonEmpty(provider, 'provider');
    const normalizedLabel = normalizeNonEmpty(label, 'label');
    const normalizedSecret = normalizeNonEmpty(secret, 'secret');
    const id = randomUUID();
    const createdAt = nowIso();
    const encryptedSecret = encryptSecret(normalizedSecret, masterKey);
    const last4 = secretLast4(normalizedSecret);

    try {
      this.db.run(
        `INSERT INTO provider_api_keys
         (id, provider, label, encrypted_secret, last4, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, normalizedProvider, normalizedLabel, encryptedSecret, last4, createdAt, createdAt],
      );
    } catch (error) {
      throw new ValidationError(`failed to create provider key: ${errorMessage(error)}`);
    }

    this.insertAudit(actor, 'provider_key.create', 'provider_key', id, {
      provider: normalizedProvider,
      label: normalizedLabel,
      last4,
    });
    this.persist();

    return {
      id,
      provider: normalizedProvider,
      label: normalizedLabel,
      last4,
      createdAt,
      updatedAt: createdAt,
    };
  }

  listProviderKeys(provider?: string): ProviderKeyRecord[] {
    const rows =
      provider && provider.trim()
        ? this.query(
            `SELECT id, provider, label, last4, created_at, updated_at
             FROM provider_api_keys WHERE provider = ? ORDER BY created_at DESC`,
            [provider.trim()],
          )
        : this.query(
            `SELECT id, provider, label, last4, created_at, updated_at
             FROM provider_api_keys ORDER BY created_at DESC`,
          );

    return rows.map((row) => ({
      id: asString(row.id),
      provider: asString(row.provider),
      label: asString(row.label),
      last4: asString(row.last4),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    }));
  }

  deleteProviderKey(provider: string, keyId: string, actor: string): void {
    const normalizedProvider = normalizeNonEmpty(provider, 'provider');
    const normalizedKeyId = normalizeNonEmpty(keyId, 'keyId');
    const rows = this.query(
      'SELECT id FROM provider_api_keys WHERE provider = ? AND id = ?',
      [normalizedProvider, normalizedKeyId],
    );
    if (rows.length === 0) {
      throw new ValidationError(`provider key not found: ${normalizedProvider}/${normalizedKeyId}`);
    }

    this.db.run('DELETE FROM provider_api_keys WHERE provider = ? AND id = ?', [
      normalizedProvider,
      normalizedKeyId,
    ]);
    this.insertAudit(actor, 'provider_key.delete', 'provider_key', normalizedKeyId, {
      provider: normalizedProvider,
      keyId: normalizedKeyId,
    });
    this.persist();
  }

  listAuditEvents(limit = 100): AuditEventRecord[] {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 100;
    const rows = this.query(
      `SELECT id, actor, action, resource_type, resource_id, payload_json, created_at
       FROM audit_events ORDER BY created_at DESC LIMIT ?`,
      [normalizedLimit],
    );

    return rows.map((row) => {
      let payload: Record<string, unknown> = {};
      const payloadRaw = asString(row.payload_json);
      try {
        const parsed = JSON.parse(payloadRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        payload = {};
      }

      return {
        id: asString(row.id),
        actor: asString(row.actor),
        action: asString(row.action),
        resourceType: asString(row.resource_type),
        resourceId: asString(row.resource_id),
        payload,
        createdAt: asString(row.created_at),
      };
    });
  }
}
