export type AdminRole = 'admin' | 'operator' | 'viewer';

export interface AuthSession {
  token: string;
  username: string;
  role: AdminRole;
  createdAt: string;
}

export interface OrganizationRecord {
  id: string;
  orgId: string;
  orgSlug: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstanceRecord {
  id: string;
  organizationId: string;
  enabled: boolean;
  profile: string;
  gatewayPort: number;
  bind: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRecord {
  id: string;
  instanceId: string;
  role: string;
  model: string;
  integrations: string[];
  skills: string[];
  soulTemplate: string;
  toolsTemplate: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderKeyRecord {
  id: string;
  provider: string;
  label: string;
  last4: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationSettingsRecord {
  organizationId: string;
  settings: Record<string, unknown>;
  updatedAt: string;
}

export interface UsageEventInput {
  provider: string;
  model: string;
  agentId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  occurredAt?: string;
}

export interface UsageProviderSummary {
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface UsageProviderModelSummary {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface UsageAgentSummary {
  agentId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface AuditEventRecord {
  id: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
