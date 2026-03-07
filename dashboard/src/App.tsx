import { FormEvent, useEffect, useState } from 'react';

type PageId =
  | 'onboarding-org'
  | 'onboarding-agent'
  | 'overview'
  | 'agents'
  | 'settings'
  | 'providers'
  | 'audit';

type OutputId = 'login' | 'org' | 'agent' | 'overview' | 'agents' | 'settings' | 'providers' | 'audit';

interface MenuItem {
  id: PageId;
  label: string;
  title: string;
}

interface AuthUser {
  username: string;
  role: string;
}

interface OrganizationOption {
  id: string;
  displayName: string;
}

const TOKEN_STORAGE_KEY = 'oco_admin_token';

const MENU_ITEMS: MenuItem[] = [
  { id: 'onboarding-org', label: 'Onboarding Org', title: 'Organization Onboarding' },
  { id: 'onboarding-agent', label: 'Onboarding Agent', title: 'Agent Onboarding' },
  { id: 'overview', label: 'Overview', title: 'Organization Overview' },
  { id: 'agents', label: 'Agent Details', title: 'Agent Details' },
  { id: 'settings', label: 'Settings', title: 'Settings' },
  { id: 'providers', label: 'Model Providers', title: 'Provider Monitoring' },
  { id: 'audit', label: 'Audit', title: 'Audit Events' },
];

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

function formatOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function apiRequest<T>(path: string, token: string | undefined, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? undefined);
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  const raw = await response.text();
  let payload: unknown = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }

  if (!response.ok) {
    const payloadRecord = asRecord(payload);
    const payloadError = asRecord(payloadRecord.error);
    const message = asString(payloadError.message) || `request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

function isPageVisible(currentPage: PageId, pageId: PageId): string {
  return currentPage === pageId ? 'page' : 'page hidden';
}

export default function App(): JSX.Element {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [page, setPage] = useState<PageId>('onboarding-org');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [overviewOrg, setOverviewOrg] = useState('');
  const [settingsOrg, setSettingsOrg] = useState('');

  const [outputs, setOutputs] = useState<Record<OutputId, string>>({
    login: '',
    org: '',
    agent: '',
    overview: '',
    agents: '',
    settings: '',
    providers: '',
    audit: '',
  });

  const [loginForm, setLoginForm] = useState({
    username: 'admin',
    password: 'admin',
  });

  const [organizationForm, setOrganizationForm] = useState({
    id: 'maestro',
    org_id: 'maestro',
    org_slug: 'maestro',
    display_name: 'Maestro',
    instance_id: 'core-human',
    profile: 'human',
    gateway_port: '19789',
    bind: '127.0.0.1',
  });

  const [agentOnboardingForm, setAgentOnboardingForm] = useState({
    instance_id: 'core-human',
    agent_id: 'owner',
    role: 'human',
    model: 'openai/gpt-5.1',
    integrations: 'telegram',
    skills: 'github',
    soul_template: 'operations',
    tools_template: 'operations',
  });

  const [agentsInstanceId, setAgentsInstanceId] = useState('core-human');
  const [agentDetailId, setAgentDetailId] = useState('');
  const [agentEditForm, setAgentEditForm] = useState({
    role: '',
    model: '',
    integrations: '',
    skills: '',
    soul_template: '',
    tools_template: '',
  });

  const [settingsJson, setSettingsJson] = useState('{}');
  const [settingsImportPath, setSettingsImportPath] = useState('inventory/instances.local.yaml');

  const [providerKeyForm, setProviderKeyForm] = useState({
    provider: 'openai',
    label: 'primary',
    secret: '',
  });

  const [usageEventForm, setUsageEventForm] = useState({
    provider: 'openai',
    model: 'gpt-5.1',
    agent_id: 'owner',
    prompt_tokens: '1000',
    completion_tokens: '500',
    total_tokens: '1500',
    cost_usd: '0.12',
  });

  function setPanelOutput(panel: OutputId, value: unknown): void {
    setOutputs((current) => ({
      ...current,
      [panel]: formatOutput(value),
    }));
  }

  function clearSession(): void {
    setToken('');
    setUser(null);
    setOrganizations([]);
    setOverviewOrg('');
    setSettingsOrg('');
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    return apiRequest<T>(
      path,
      token || undefined,
      body === undefined
        ? { method }
        : {
            method,
            body: JSON.stringify(body),
          },
    );
  }

  async function refreshAuth(activeToken: string): Promise<void> {
    const payload = await apiRequest<Record<string, unknown>>('/api/v1/auth/me', activeToken, { method: 'GET' });
    const userRecord = asRecord(payload.user);
    setUser({
      username: asString(userRecord.username),
      role: asString(userRecord.role),
    });
  }

  async function refreshOrganizations(activeToken: string): Promise<void> {
    const payload = await apiRequest<Record<string, unknown>>('/api/v1/organizations', activeToken, {
      method: 'GET',
    });

    const rawOrganizations = Array.isArray(payload.organizations) ? payload.organizations : [];
    const normalized = rawOrganizations
      .map((value) => {
        const org = asRecord(value);
        const id = asString(org.id);
        const displayName = asString(org.displayName, asString(org.display_name, id));
        return {
          id,
          displayName,
        };
      })
      .filter((org) => org.id.length > 0);

    setOrganizations(normalized);
    setOverviewOrg((current) => {
      if (current && normalized.some((org) => org.id === current)) {
        return current;
      }
      return normalized[0]?.id || '';
    });
    setSettingsOrg((current) => {
      if (current && normalized.some((org) => org.id === current)) {
        return current;
      }
      return normalized[0]?.id || '';
    });
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    let canceled = false;

    const boot = async (): Promise<void> => {
      try {
        await refreshAuth(token);
        await refreshOrganizations(token);
      } catch (error) {
        if (canceled) {
          return;
        }
        clearSession();
        setPanelOutput('login', errorMessage(error));
      }
    };

    void boot();

    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      const payload = await apiRequest<Record<string, unknown>>('/api/v1/auth/login', undefined, {
        method: 'POST',
        body: JSON.stringify(loginForm),
      });
      const nextToken = asString(payload.token);
      if (!nextToken) {
        throw new Error('login succeeded but token was missing');
      }

      localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
      setToken(nextToken);
      setPanelOutput('login', { status: 'authenticated' });
    } catch (error) {
      setPanelOutput('login', errorMessage(error));
    }
  }

  async function handleLogout(): Promise<void> {
    try {
      if (token) {
        await request('/api/v1/auth/logout', 'POST');
      }
    } catch {
      // ignore logout errors and clear local session anyway
    } finally {
      clearSession();
    }
  }

  async function runOrganizationOnboarding(mode: 'validate' | 'commit'): Promise<void> {
    try {
      const route =
        mode === 'commit'
          ? '/api/v1/onboarding/organization/commit'
          : '/api/v1/onboarding/organization/validate';
      const payload = {
        organization: {
          id: organizationForm.id,
          org_id: organizationForm.org_id,
          org_slug: organizationForm.org_slug,
          display_name: organizationForm.display_name,
        },
        initial_instance: {
          id: organizationForm.instance_id,
          profile: organizationForm.profile,
          enabled: true,
          host: {
            gateway_port: toNumber(organizationForm.gateway_port),
            bind: organizationForm.bind,
          },
        },
      };
      const data = await request<Record<string, unknown>>(route, 'POST', payload);
      setPanelOutput('org', data);
      await refreshOrganizations(token);
    } catch (error) {
      setPanelOutput('org', errorMessage(error));
    }
  }

  async function runAgentOnboarding(mode: 'validate' | 'commit'): Promise<void> {
    try {
      const route = mode === 'commit' ? '/api/v1/onboarding/agent/commit' : '/api/v1/onboarding/agent/validate';
      const payload = {
        instance_id: agentOnboardingForm.instance_id,
        agent: {
          id: agentOnboardingForm.agent_id,
          role: agentOnboardingForm.role,
          model: agentOnboardingForm.model,
          integrations: parseCsv(agentOnboardingForm.integrations),
          skills: parseCsv(agentOnboardingForm.skills),
          soul_template: agentOnboardingForm.soul_template,
          tools_template: agentOnboardingForm.tools_template,
        },
      };
      const data = await request<Record<string, unknown>>(route, 'POST', payload);
      setPanelOutput('agent', data);
    } catch (error) {
      setPanelOutput('agent', errorMessage(error));
    }
  }

  async function loadOverview(): Promise<void> {
    if (!overviewOrg) {
      setPanelOutput('overview', 'Select an organization first.');
      return;
    }
    try {
      const data = await request<Record<string, unknown>>(
        `/api/v1/organizations/${encodeURIComponent(overviewOrg)}/overview`,
      );
      setPanelOutput('overview', data);
    } catch (error) {
      setPanelOutput('overview', errorMessage(error));
    }
  }

  async function loadAgents(): Promise<void> {
    if (!agentsInstanceId.trim()) {
      setPanelOutput('agents', 'Instance ID is required.');
      return;
    }
    try {
      const data = await request<Record<string, unknown>>(
        `/api/v1/instances/${encodeURIComponent(agentsInstanceId.trim())}/agents`,
      );
      setPanelOutput('agents', data);
    } catch (error) {
      setPanelOutput('agents', errorMessage(error));
    }
  }

  async function loadAgentDetail(): Promise<void> {
    if (!agentDetailId.trim()) {
      setPanelOutput('agents', 'Agent ID is required.');
      return;
    }

    try {
      const data = await request<Record<string, unknown>>(`/api/v1/agents/${encodeURIComponent(agentDetailId.trim())}`);
      setAgentEditForm({
        role: asString(data.role),
        model: asString(data.model),
        integrations: asStringArray(data.integrations).join(','),
        skills: asStringArray(data.skills).join(','),
        soul_template: asString(data.soul_template, asString(data.soulTemplate)),
        tools_template: asString(data.tools_template, asString(data.toolsTemplate)),
      });
      setPanelOutput('agents', data);
    } catch (error) {
      setPanelOutput('agents', errorMessage(error));
    }
  }

  async function updateAgent(): Promise<void> {
    if (!agentDetailId.trim()) {
      setPanelOutput('agents', 'Agent ID is required.');
      return;
    }

    try {
      const payload = {
        role: agentEditForm.role,
        model: agentEditForm.model,
        integrations: parseCsv(agentEditForm.integrations),
        skills: parseCsv(agentEditForm.skills),
        soul_template: agentEditForm.soul_template,
        tools_template: agentEditForm.tools_template,
      };
      const data = await request<Record<string, unknown>>(
        `/api/v1/agents/${encodeURIComponent(agentDetailId.trim())}`,
        'PATCH',
        payload,
      );
      setPanelOutput('agents', data);
    } catch (error) {
      setPanelOutput('agents', errorMessage(error));
    }
  }

  async function loadSettings(): Promise<void> {
    if (!settingsOrg) {
      setPanelOutput('settings', 'Select an organization first.');
      return;
    }

    try {
      const data = await request<Record<string, unknown>>(
        `/api/v1/organizations/${encodeURIComponent(settingsOrg)}/settings`,
      );
      setSettingsJson(JSON.stringify(data.settings ?? {}, null, 2));
      setPanelOutput('settings', data);
    } catch (error) {
      setPanelOutput('settings', errorMessage(error));
    }
  }

  async function saveSettings(): Promise<void> {
    if (!settingsOrg) {
      setPanelOutput('settings', 'Select an organization first.');
      return;
    }

    try {
      const patch = JSON.parse(settingsJson) as Record<string, unknown>;
      const data = await request<Record<string, unknown>>(
        `/api/v1/organizations/${encodeURIComponent(settingsOrg)}/settings`,
        'PATCH',
        patch,
      );
      setPanelOutput('settings', data);
    } catch (error) {
      setPanelOutput('settings', errorMessage(error));
    }
  }

  async function importInventory(dryRun: boolean): Promise<void> {
    if (!settingsOrg) {
      setPanelOutput('settings', 'Select an organization first.');
      return;
    }

    try {
      const data = await request<Record<string, unknown>>(
        `/api/v1/organizations/${encodeURIComponent(settingsOrg)}/inventory/import`,
        'POST',
        {
          inventory_path: settingsImportPath,
          dry_run: dryRun,
        },
      );
      setPanelOutput('settings', data);
      await refreshOrganizations(token);
    } catch (error) {
      setPanelOutput('settings', errorMessage(error));
    }
  }

  async function exportInventory(): Promise<void> {
    if (!settingsOrg) {
      setPanelOutput('settings', 'Select an organization first.');
      return;
    }

    try {
      const data = await request<Record<string, unknown>>(
        `/api/v1/organizations/${encodeURIComponent(settingsOrg)}/inventory/export`,
        'POST',
        {},
      );
      setPanelOutput('settings', data);
    } catch (error) {
      setPanelOutput('settings', errorMessage(error));
    }
  }

  async function loadProviders(): Promise<void> {
    try {
      const [providerSettings, providerUsage] = await Promise.all([
        request<Record<string, unknown>>('/api/v1/settings/providers'),
        request<Record<string, unknown>>('/api/v1/usage/providers'),
      ]);
      setPanelOutput('providers', {
        provider_settings: providerSettings,
        provider_usage: providerUsage,
      });
    } catch (error) {
      setPanelOutput('providers', errorMessage(error));
    }
  }

  async function saveProviderKey(): Promise<void> {
    try {
      const data = await request<Record<string, unknown>>(
        `/api/v1/settings/providers/${encodeURIComponent(providerKeyForm.provider)}/keys`,
        'POST',
        {
          label: providerKeyForm.label,
          secret: providerKeyForm.secret,
        },
      );
      setProviderKeyForm((current) => ({
        ...current,
        secret: '',
      }));
      setPanelOutput('providers', data);
      await loadProviders();
    } catch (error) {
      setPanelOutput('providers', errorMessage(error));
    }
  }

  async function saveUsageEvent(): Promise<void> {
    try {
      const data = await request<Record<string, unknown>>('/api/v1/usage/events', 'POST', {
        provider: usageEventForm.provider,
        model: usageEventForm.model,
        agent_id: usageEventForm.agent_id,
        prompt_tokens: toNumber(usageEventForm.prompt_tokens),
        completion_tokens: toNumber(usageEventForm.completion_tokens),
        total_tokens: toNumber(usageEventForm.total_tokens),
        cost_usd: toNumber(usageEventForm.cost_usd),
      });
      setPanelOutput('providers', data);
      await loadProviders();
    } catch (error) {
      setPanelOutput('providers', errorMessage(error));
    }
  }

  async function loadAudit(): Promise<void> {
    try {
      const data = await request<Record<string, unknown>>('/api/v1/audit-events?limit=200');
      setPanelOutput('audit', data);
    } catch (error) {
      setPanelOutput('audit', errorMessage(error));
    }
  }

  const pageTitle = MENU_ITEMS.find((item) => item.id === page)?.title || 'OCO Admin Dashboard';
  const isAuthenticated = Boolean(token && user);
  const currentUser = user ?? { username: '', role: '' };

  if (!isAuthenticated) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <h1>OCO Admin</h1>
          <p className="muted">Sign in to manage organizations, inventories, and agents.</p>
          <form onSubmit={(event) => void handleLogin(event)}>
            <label>
              Username
              <input
                value={loginForm.username}
                onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                autoComplete="current-password"
                required
              />
            </label>
            <button type="submit">Sign In</button>
          </form>
          <pre className="output">{outputs.login}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-head">
          <div>
            <div className="brand">OCO</div>
            {!sidebarCollapsed ? <div className="subtitle">Admin Dashboard</div> : null}
          </div>
          <button type="button" className="ghost" onClick={() => setSidebarCollapsed((current) => !current)}>
            {sidebarCollapsed ? '>' : '<'}
          </button>
        </div>

        <nav className="menu">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === page ? 'active' : ''}
              onClick={() => setPage(item.id)}
            >
              {sidebarCollapsed ? item.label.slice(0, 2) : item.label}
            </button>
          ))}
        </nav>

        <button type="button" className="danger" onClick={() => void handleLogout()}>
          Sign Out
        </button>
      </aside>

      <main className="content">
        <header className="topbar">
          <h2>{pageTitle}</h2>
          <span className="pill">
            {currentUser.username} ({currentUser.role})
          </span>
        </header>

        <section className={isPageVisible(page, 'onboarding-org')}>
          <h3>Organization Onboarding</h3>
          <form className="grid" onSubmit={(event) => event.preventDefault()}>
            <label>
              Organization ID
              <input
                value={organizationForm.id}
                onChange={(event) => setOrganizationForm((current) => ({ ...current, id: event.target.value }))}
              />
            </label>
            <label>
              Org ID
              <input
                value={organizationForm.org_id}
                onChange={(event) => setOrganizationForm((current) => ({ ...current, org_id: event.target.value }))}
              />
            </label>
            <label>
              Org Slug
              <input
                value={organizationForm.org_slug}
                onChange={(event) =>
                  setOrganizationForm((current) => ({
                    ...current,
                    org_slug: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Display Name
              <input
                value={organizationForm.display_name}
                onChange={(event) =>
                  setOrganizationForm((current) => ({
                    ...current,
                    display_name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Initial Instance ID
              <input
                value={organizationForm.instance_id}
                onChange={(event) =>
                  setOrganizationForm((current) => ({
                    ...current,
                    instance_id: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Profile
              <input
                value={organizationForm.profile}
                onChange={(event) =>
                  setOrganizationForm((current) => ({
                    ...current,
                    profile: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Gateway Port
              <input
                type="number"
                value={organizationForm.gateway_port}
                onChange={(event) =>
                  setOrganizationForm((current) => ({
                    ...current,
                    gateway_port: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Bind
              <input
                value={organizationForm.bind}
                onChange={(event) =>
                  setOrganizationForm((current) => ({
                    ...current,
                    bind: event.target.value,
                  }))
                }
              />
            </label>
            <div className="actions">
              <button type="button" onClick={() => void runOrganizationOnboarding('validate')}>
                Validate
              </button>
              <button type="button" onClick={() => void runOrganizationOnboarding('commit')}>
                Commit
              </button>
            </div>
          </form>
          <pre className="output">{outputs.org}</pre>
        </section>

        <section className={isPageVisible(page, 'onboarding-agent')}>
          <h3>Agent Onboarding</h3>
          <form className="grid" onSubmit={(event) => event.preventDefault()}>
            <label>
              Instance ID
              <input
                value={agentOnboardingForm.instance_id}
                onChange={(event) =>
                  setAgentOnboardingForm((current) => ({
                    ...current,
                    instance_id: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Agent ID
              <input
                value={agentOnboardingForm.agent_id}
                onChange={(event) =>
                  setAgentOnboardingForm((current) => ({
                    ...current,
                    agent_id: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Role
              <input
                value={agentOnboardingForm.role}
                onChange={(event) => setAgentOnboardingForm((current) => ({ ...current, role: event.target.value }))}
              />
            </label>
            <label>
              Model
              <input
                value={agentOnboardingForm.model}
                onChange={(event) => setAgentOnboardingForm((current) => ({ ...current, model: event.target.value }))}
              />
            </label>
            <label>
              Integrations (comma)
              <input
                value={agentOnboardingForm.integrations}
                onChange={(event) =>
                  setAgentOnboardingForm((current) => ({
                    ...current,
                    integrations: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Skills (comma)
              <input
                value={agentOnboardingForm.skills}
                onChange={(event) => setAgentOnboardingForm((current) => ({ ...current, skills: event.target.value }))}
              />
            </label>
            <label>
              Soul Template
              <input
                value={agentOnboardingForm.soul_template}
                onChange={(event) =>
                  setAgentOnboardingForm((current) => ({
                    ...current,
                    soul_template: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Tools Template
              <input
                value={agentOnboardingForm.tools_template}
                onChange={(event) =>
                  setAgentOnboardingForm((current) => ({
                    ...current,
                    tools_template: event.target.value,
                  }))
                }
              />
            </label>
            <div className="actions">
              <button type="button" onClick={() => void runAgentOnboarding('validate')}>
                Validate
              </button>
              <button type="button" onClick={() => void runAgentOnboarding('commit')}>
                Commit
              </button>
            </div>
          </form>
          <pre className="output">{outputs.agent}</pre>
        </section>

        <section className={isPageVisible(page, 'overview')}>
          <h3>Organization Overview</h3>
          <div className="inline">
            <label>
              Organization
              <select value={overviewOrg} onChange={(event) => setOverviewOrg(event.target.value)}>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.id} - {organization.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => void loadOverview()}>
              Refresh
            </button>
          </div>
          <pre className="output">{outputs.overview}</pre>
        </section>

        <section className={isPageVisible(page, 'agents')}>
          <h3>Agent Details</h3>
          <div className="inline">
            <label>
              Instance ID
              <input value={agentsInstanceId} onChange={(event) => setAgentsInstanceId(event.target.value)} />
            </label>
            <button type="button" onClick={() => void loadAgents()}>
              Load Agents
            </button>
          </div>

          <div className="inline">
            <label>
              Agent ID
              <input value={agentDetailId} onChange={(event) => setAgentDetailId(event.target.value)} />
            </label>
            <button type="button" onClick={() => void loadAgentDetail()}>
              Load Agent
            </button>
          </div>

          <form className="grid" onSubmit={(event) => event.preventDefault()}>
            <label>
              Role
              <input
                value={agentEditForm.role}
                onChange={(event) => setAgentEditForm((current) => ({ ...current, role: event.target.value }))}
              />
            </label>
            <label>
              Model
              <input
                value={agentEditForm.model}
                onChange={(event) => setAgentEditForm((current) => ({ ...current, model: event.target.value }))}
              />
            </label>
            <label>
              Integrations (comma)
              <input
                value={agentEditForm.integrations}
                onChange={(event) =>
                  setAgentEditForm((current) => ({
                    ...current,
                    integrations: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Skills (comma)
              <input
                value={agentEditForm.skills}
                onChange={(event) => setAgentEditForm((current) => ({ ...current, skills: event.target.value }))}
              />
            </label>
            <label>
              Soul Template
              <input
                value={agentEditForm.soul_template}
                onChange={(event) =>
                  setAgentEditForm((current) => ({
                    ...current,
                    soul_template: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Tools Template
              <input
                value={agentEditForm.tools_template}
                onChange={(event) =>
                  setAgentEditForm((current) => ({
                    ...current,
                    tools_template: event.target.value,
                  }))
                }
              />
            </label>
            <div className="actions">
              <button type="button" onClick={() => void updateAgent()}>
                Update Agent
              </button>
            </div>
          </form>
          <pre className="output">{outputs.agents}</pre>
        </section>

        <section className={isPageVisible(page, 'settings')}>
          <h3>Global Settings</h3>
          <div className="inline">
            <label>
              Organization
              <select value={settingsOrg} onChange={(event) => setSettingsOrg(event.target.value)}>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.id} - {organization.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => void loadSettings()}>
              Load
            </button>
            <button type="button" className="ghost" onClick={() => void refreshOrganizations(token)}>
              Refresh Orgs
            </button>
          </div>

          <label>
            Settings JSON
            <textarea rows={12} value={settingsJson} onChange={(event) => setSettingsJson(event.target.value)} />
          </label>
          <div className="actions">
            <button type="button" onClick={() => void saveSettings()}>
              Save
            </button>
          </div>

          <h4>Inventory Migration</h4>
          <div className="inline">
            <label>
              Inventory Path
              <input value={settingsImportPath} onChange={(event) => setSettingsImportPath(event.target.value)} />
            </label>
            <button type="button" onClick={() => void importInventory(true)}>
              Import Validate
            </button>
            <button type="button" onClick={() => void importInventory(false)}>
              Import Commit
            </button>
            <button type="button" onClick={() => void exportInventory()}>
              Export
            </button>
          </div>
          <pre className="output">{outputs.settings}</pre>
        </section>

        <section className={isPageVisible(page, 'providers')}>
          <h3>Model Provider Monitoring</h3>
          <div className="inline">
            <button type="button" onClick={() => void loadProviders()}>
              Refresh Providers
            </button>
          </div>
          <pre className="output">{outputs.providers}</pre>

          <h4>Add Provider Key</h4>
          <form className="grid" onSubmit={(event) => event.preventDefault()}>
            <label>
              Provider
              <select
                value={providerKeyForm.provider}
                onChange={(event) => setProviderKeyForm((current) => ({ ...current, provider: event.target.value }))}
              >
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
              </select>
            </label>
            <label>
              Label
              <input
                value={providerKeyForm.label}
                onChange={(event) => setProviderKeyForm((current) => ({ ...current, label: event.target.value }))}
              />
            </label>
            <label>
              Secret
              <input
                type="password"
                value={providerKeyForm.secret}
                onChange={(event) => setProviderKeyForm((current) => ({ ...current, secret: event.target.value }))}
              />
            </label>
            <div className="actions">
              <button type="button" onClick={() => void saveProviderKey()}>
                Save Key
              </button>
            </div>
          </form>

          <h4>Usage Event</h4>
          <form className="grid" onSubmit={(event) => event.preventDefault()}>
            <label>
              Provider
              <select
                value={usageEventForm.provider}
                onChange={(event) => setUsageEventForm((current) => ({ ...current, provider: event.target.value }))}
              >
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
              </select>
            </label>
            <label>
              Model
              <input
                value={usageEventForm.model}
                onChange={(event) => setUsageEventForm((current) => ({ ...current, model: event.target.value }))}
              />
            </label>
            <label>
              Agent ID
              <input
                value={usageEventForm.agent_id}
                onChange={(event) => setUsageEventForm((current) => ({ ...current, agent_id: event.target.value }))}
              />
            </label>
            <label>
              Prompt Tokens
              <input
                type="number"
                value={usageEventForm.prompt_tokens}
                onChange={(event) =>
                  setUsageEventForm((current) => ({
                    ...current,
                    prompt_tokens: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Completion Tokens
              <input
                type="number"
                value={usageEventForm.completion_tokens}
                onChange={(event) =>
                  setUsageEventForm((current) => ({
                    ...current,
                    completion_tokens: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Total Tokens
              <input
                type="number"
                value={usageEventForm.total_tokens}
                onChange={(event) =>
                  setUsageEventForm((current) => ({
                    ...current,
                    total_tokens: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Cost USD
              <input
                type="number"
                step="0.0001"
                value={usageEventForm.cost_usd}
                onChange={(event) => setUsageEventForm((current) => ({ ...current, cost_usd: event.target.value }))}
              />
            </label>
            <div className="actions">
              <button type="button" onClick={() => void saveUsageEvent()}>
                Record Usage
              </button>
            </div>
          </form>
        </section>

        <section className={isPageVisible(page, 'audit')}>
          <h3>Audit Events</h3>
          <div className="inline">
            <button type="button" onClick={() => void loadAudit()}>
              Refresh
            </button>
          </div>
          <pre className="output">{outputs.audit}</pre>
        </section>
      </main>
    </div>
  );
}
