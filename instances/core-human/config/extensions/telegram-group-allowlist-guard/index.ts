import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type GuardPluginConfig = {
  enabledAccounts?: string[];
  maxSenderAgeMs?: number;
  awarenessSenderAgeMs?: number;
  awarenessMaxGroups?: number;
  stateAgentsDir?: string;
};

type LastInboundSender = {
  accountId: string;
  toTarget: string;
  senderId?: string;
  timestampMs: number;
  isGroup: boolean;
};

type GroupAwareness = {
  accountId: string;
  groupId: string;
  conversationTarget: string;
  timestampMs: number;
  senderId?: string;
  conversationLabel?: string;
  groupSubject?: string;
  lastMessagePreview?: string;
};

type SessionIndexedGroup = {
  groupId: string;
  conversationLabel?: string;
};

type ParsedTelegramTarget = {
  kind: "group" | "direct" | "unknown";
  id: string;
};

type ParsedTelegramSession = {
  kind: "group" | "direct" | "unknown";
  agentId?: string;
  accountId?: string;
  toTarget?: string;
};

const DEFAULT_MAX_SENDER_AGE_MS = 5 * 60 * 1000;
const DEFAULT_AWARENESS_SENDER_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AWARENESS_MAX_GROUPS = 8;
const DEFAULT_STATE_AGENTS_DIR = "/var/lib/openclaw/state/agents";
const lastInboundByConversation = new Map<string, LastInboundSender>();
const groupAwarenessByConversation = new Map<string, GroupAwareness>();

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  return value as Record<string, unknown>;
}

function collectTextParts(value: unknown, out: string[], depth = 0): void {
  if (depth > 4 || value == null) {
    return;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      out.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTextParts(entry, out, depth + 1);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  const textCandidates = ["text", "content", "body", "caption", "message"];
  for (const key of textCandidates) {
    if (!(key in record)) {
      continue;
    }
    collectTextParts(record[key], out, depth + 1);
  }
}

function extractTextPayload(content: unknown): string | undefined {
  const direct = asNonEmptyString(content);
  if (direct) {
    return direct;
  }

  const parts: string[] = [];
  collectTextParts(content, parts);
  if (parts.length === 0) {
    return;
  }

  return parts.join("\n");
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  const raw = asNonEmptyString(value);
  if (!raw) {
    return;
  }
  if (raw.startsWith("telegram:group:")) {
    return raw.slice("telegram:group:".length);
  }
  if (raw.startsWith("telegram:")) {
    return raw.slice("telegram:".length);
  }
  if (raw.startsWith("group:")) {
    return raw.slice("group:".length);
  }
  return raw;
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeId(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function parseTelegramTarget(rawTarget: string): ParsedTelegramTarget {
  const target = rawTarget.trim().toLowerCase();
  if (!target.startsWith("telegram:")) {
    return {
      kind: "unknown",
      id: target,
    };
  }

  const suffix = target.slice("telegram:".length);
  if (suffix.startsWith("group:")) {
    return {
      kind: "group",
      id: suffix.slice("group:".length),
    };
  }

  if (/^-?\d+$/.test(suffix)) {
    return {
      kind: suffix.startsWith("-") ? "group" : "direct",
      id: suffix,
    };
  }

  return {
    kind: "unknown",
    id: suffix,
  };
}

function canonicalConversationTarget(rawTarget: string): string {
  const parsed = parseTelegramTarget(rawTarget);
  if (parsed.kind === "group" || parsed.kind === "direct") {
    return `telegram:${parsed.id}`;
  }
  return rawTarget.trim().toLowerCase();
}

function parseTelegramSessionKey(sessionKey: string): ParsedTelegramSession {
  const tokens = sessionKey.trim().toLowerCase().split(":");
  const agentId = tokens.length >= 2 && tokens[0] === "agent" ? tokens[1] : undefined;
  const telegramIndex = tokens.indexOf("telegram");
  if (telegramIndex < 0) {
    return { kind: "unknown", agentId };
  }

  const suffix = tokens.slice(telegramIndex + 1);
  if (suffix.length >= 2 && (suffix[0] === "group" || suffix[0] === "direct")) {
    return {
      kind: suffix[0],
      toTarget: `telegram:${suffix[1]}`,
      agentId,
    };
  }

  if (suffix.length >= 3 && (suffix[1] === "group" || suffix[1] === "direct")) {
    return {
      kind: suffix[1],
      agentId,
      accountId: suffix[0],
      toTarget: `telegram:${suffix[2]}`,
    };
  }

  return { kind: "unknown", agentId };
}

function extractSenderId(metadata: Record<string, unknown> | undefined, from?: string): string | undefined {
  const fromMetadata = normalizeId(metadata?.senderId);
  if (fromMetadata) {
    return fromMetadata;
  }

  const rawFrom = asNonEmptyString(from);
  if (!rawFrom) {
    return;
  }
  const parsedFrom = parseTelegramTarget(rawFrom);
  if (parsedFrom.kind !== "direct") {
    return;
  }
  return normalizeId(parsedFrom.id);
}

function makeConversationKey(accountId: string, toTarget: string): string {
  return `${accountId.trim().toLowerCase()}::${toTarget.trim().toLowerCase()}`;
}

function findLatestInboundForTarget(
  toTarget: string,
  maxAgeMs: number,
  accountId?: string,
): LastInboundSender | undefined {
  const normalizedTarget = toTarget.trim().toLowerCase();
  const now = Date.now();

  if (accountId) {
    const exact = lastInboundByConversation.get(makeConversationKey(accountId, normalizedTarget));
    if (exact && now - exact.timestampMs <= maxAgeMs) {
      return exact;
    }
  }

  const suffix = `::${normalizedTarget}`;
  let latest: LastInboundSender | undefined;
  for (const [key, value] of lastInboundByConversation.entries()) {
    if (accountId && !key.startsWith(`${accountId.trim().toLowerCase()}::`)) {
      continue;
    }
    if (!key.endsWith(suffix)) {
      continue;
    }
    if (now - value.timestampMs > maxAgeMs) {
      continue;
    }
    if (!latest || value.timestampMs > latest.timestampMs) {
      latest = value;
    }
  }
  return latest;
}

function isReasoningOnlyMessage(raw: string): boolean {
  const text = raw.trim();
  if (!text) {
    return false;
  }
  if (/^reasoning:\s*/i.test(text)) {
    return true;
  }
  return false;
}

function hasThinkArtifacts(raw: string): boolean {
  return (
    /<think>[\s\S]*?<\/think>/i.test(raw) ||
    /<thinking(?:\s+[^>]*)?>[\s\S]*?<\/thinking>/i.test(raw) ||
    /<antthinking(?:\s+[^>]*)?>[\s\S]*?<\/antthinking>/i.test(raw)
  );
}

function stripReasoningArtifacts(raw: string): string {
  let output = raw;
  output = output.replace(/<think>[\s\S]*?<\/think>/gi, "");
  output = output.replace(/<thinking(?:\s+[^>]*)?>[\s\S]*?<\/thinking>/gi, "");
  output = output.replace(/<antthinking(?:\s+[^>]*)?>[\s\S]*?<\/antthinking>/gi, "");
  return output.trim();
}

function cleanupExpiredContext(maxAgeMs: number): void {
  const now = Date.now();
  for (const [key, value] of lastInboundByConversation.entries()) {
    if (now - value.timestampMs > maxAgeMs) {
      lastInboundByConversation.delete(key);
    }
  }
}

function cleanupExpiredGroupAwareness(maxAgeMs: number): void {
  const now = Date.now();
  for (const [key, value] of groupAwarenessByConversation.entries()) {
    if (now - value.timestampMs > maxAgeMs) {
      groupAwarenessByConversation.delete(key);
    }
  }
}

function regexJsonStringValue(content: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`, "i").exec(content);
  return asNonEmptyString(match?.[1]);
}

function extractGroupConversationLabel(
  metadata: Record<string, unknown> | undefined,
  content: unknown,
): string | undefined {
  const fromMetadata =
    asNonEmptyString(metadata?.conversationLabel) ?? asNonEmptyString(metadata?.conversation_label);
  if (fromMetadata) {
    return fromMetadata;
  }
  const rawContent = extractTextPayload(content);
  if (!rawContent) {
    return;
  }
  return regexJsonStringValue(rawContent, "conversation_label");
}

function extractGroupSubject(
  metadata: Record<string, unknown> | undefined,
  content: unknown,
): string | undefined {
  const fromMetadata =
    asNonEmptyString(metadata?.groupSubject) ?? asNonEmptyString(metadata?.group_subject);
  if (fromMetadata) {
    return fromMetadata;
  }
  const rawContent = extractTextPayload(content);
  if (!rawContent) {
    return;
  }
  return regexJsonStringValue(rawContent, "group_subject");
}

function extractGroupMessagePreview(content: unknown): string | undefined {
  const rawContent = extractTextPayload(content);
  if (!rawContent) {
    return;
  }

  let cleaned = rawContent;
  cleaned = cleaned.replace(/```[\s\S]*?```/g, " ");
  cleaned = cleaned.replace(/Conversation info \(untrusted metadata\):/gi, " ");
  cleaned = cleaned.replace(/Sender \(untrusted metadata\):/gi, " ");
  cleaned = cleaned.replace(/Replied message \(untrusted, for context\):/gi, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return;
  }
  if (cleaned.length <= 200) {
    return cleaned;
  }
  return `${cleaned.slice(0, 197)}...`;
}

function resolveSessionIndexPath(stateAgentsDir: string, agentId: string): string {
  return join(stateAgentsDir, agentId, "sessions", "sessions.json");
}

function readIndexedTelegramGroups(
  stateAgentsDir: string,
  agentId: string | undefined,
  accountId: string,
): SessionIndexedGroup[] {
  const effectiveAgentId = asNonEmptyString(agentId) ?? accountId;
  if (!effectiveAgentId) {
    return [];
  }

  try {
    const raw = readFileSync(resolveSessionIndexPath(stateAgentsDir, effectiveAgentId), "utf8");
    const parsed = JSON.parse(raw);
    const sessions = asRecord(parsed);
    if (!sessions) {
      return [];
    }

    const groups = new Map<string, SessionIndexedGroup>();
    for (const [sessionKey, value] of Object.entries(sessions)) {
      const parsedKey = parseTelegramSessionKey(sessionKey);
      if (parsedKey.kind !== "group") {
        continue;
      }
      if (parsedKey.accountId && parsedKey.accountId !== accountId) {
        continue;
      }
      if (!parsedKey.toTarget) {
        continue;
      }

      const parsedTarget = parseTelegramTarget(parsedKey.toTarget);
      if (parsedTarget.kind !== "group") {
        continue;
      }

      const sessionRecord = asRecord(value);
      const origin = asRecord(sessionRecord?.origin);
      const conversationLabel = asNonEmptyString(origin?.label);
      groups.set(parsedTarget.id, {
        groupId: parsedTarget.id,
        conversationLabel,
      });
    }

    return [...groups.values()];
  } catch {
    return [];
  }
}

function buildTelegramAwarenessContext(
  config: OpenClawConfig,
  accountId: string,
  agentId: string | undefined,
  awarenessSenderAgeMs: number,
  awarenessMaxGroups: number,
  stateAgentsDir: string,
): string | undefined {
  cleanupExpiredGroupAwareness(awarenessSenderAgeMs);

  const byGroupId = new Map<string, GroupAwareness>();
  for (const awareness of groupAwarenessByConversation.values()) {
    if (awareness.accountId !== accountId) {
      continue;
    }
    const prev = byGroupId.get(awareness.groupId);
    if (!prev || awareness.timestampMs > prev.timestampMs) {
      byGroupId.set(awareness.groupId, awareness);
    }
  }

  for (const indexed of readIndexedTelegramGroups(stateAgentsDir, agentId, accountId)) {
    if (byGroupId.has(indexed.groupId)) {
      continue;
    }
    byGroupId.set(indexed.groupId, {
      accountId,
      groupId: indexed.groupId,
      conversationTarget: `telegram:${indexed.groupId}`,
      timestampMs: 0,
      conversationLabel: indexed.conversationLabel,
    });
  }

  const groups = [...byGroupId.values()]
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, awarenessMaxGroups);

  const lines = [
    "Telegram policy context (plugin-enforced):",
    "- Group messages from non-allowlist users are visible, but replies and tool calls from those triggers are blocked.",
    "- Group messages from allowlisted users may receive replies even without mentions.",
    "- Known group snippets below come from live inbound updates and are more reliable than sessions_list for legacy group keys.",
  ];

  if (groups.length === 0) {
    lines.push("- Known groups for this account: none yet.");
  } else {
    lines.push("- Known groups for this account:");
    for (const group of groups) {
      const allowlist = resolveTelegramAllowlist(config, accountId, group.groupId);
      const senderStatus =
        group.senderId && allowlist.has(group.senderId)
          ? `, latest sender ${group.senderId} allowlisted`
          : group.senderId
            ? `, latest sender ${group.senderId} NOT allowlisted`
            : "";
      const seenStatus =
        group.timestampMs > 0 ? `, last seen ${new Date(group.timestampMs).toISOString()}` : "";
      const label = group.groupSubject ?? group.conversationLabel ?? `id:${group.groupId}`;
      lines.push(`  - ${label} (id:${group.groupId}${seenStatus}${senderStatus})`);
      if (group.lastMessagePreview) {
        lines.push(`    latest observed text: "${group.lastMessagePreview}"`);
      }
    }
  }

  lines.push(
    "- In DMs asking about group activity, never claim zero visibility if the relevant group is listed above.",
  );
  lines.push(
    "- If a group includes 'latest observed text', treat it as the freshest available snippet and answer from it directly without calling sessions_list first.",
  );
  return lines.join("\n");
}

function getGroupConfig(
  groups: Record<string, unknown> | undefined,
  groupId: string,
): Record<string, unknown> | undefined {
  if (!groups) {
    return;
  }
  const candidates = [groupId, `group:${groupId}`, `telegram:${groupId}`, `telegram:group:${groupId}`, "*"];
  for (const key of candidates) {
    const cfg = asRecord(groups[key]);
    if (cfg) {
      return cfg;
    }
  }
}

function resolveTelegramAllowlist(
  config: OpenClawConfig,
  accountId: string,
  groupId: string,
): Set<string> {
  const telegram = asRecord(config.channels?.telegram);
  const accounts = asRecord(telegram?.accounts);
  const accountCfg = asRecord(accounts?.[accountId]);
  const globalGroupCfg = getGroupConfig(asRecord(telegram?.groups), groupId);
  const accountGroupCfg = getGroupConfig(asRecord(accountCfg?.groups), groupId);

  const allowlist = new Set<string>();
  for (const id of [
    ...normalizeIdList(telegram?.allowFrom),
    ...normalizeIdList(telegram?.groupAllowFrom),
    ...normalizeIdList(accountCfg?.allowFrom),
    ...normalizeIdList(accountCfg?.groupAllowFrom),
    ...normalizeIdList(globalGroupCfg?.allowFrom),
    ...normalizeIdList(accountGroupCfg?.allowFrom),
  ]) {
    allowlist.add(id);
  }

  return allowlist;
}

function isAccountEnabled(accountId: string, enabledAccounts: Set<string>): boolean {
  if (enabledAccounts.size === 0) {
    return true;
  }
  return enabledAccounts.has(accountId.trim().toLowerCase());
}

function resolveDefaultEnabledAccount(enabledAccounts: Set<string>): string | undefined {
  if (enabledAccounts.size !== 1) {
    return;
  }
  return enabledAccounts.values().next().value as string;
}

export default function register(api: OpenClawPluginApi): void {
  const pluginConfig = (api.pluginConfig ?? {}) as GuardPluginConfig;
  const enabledAccounts = new Set(
    asStringList(pluginConfig.enabledAccounts).map((entry) => entry.toLowerCase()),
  );
  const maxSenderAgeMs =
    typeof pluginConfig.maxSenderAgeMs === "number" && pluginConfig.maxSenderAgeMs > 0
      ? pluginConfig.maxSenderAgeMs
      : DEFAULT_MAX_SENDER_AGE_MS;
  const awarenessSenderAgeMs =
    typeof pluginConfig.awarenessSenderAgeMs === "number" && pluginConfig.awarenessSenderAgeMs > 0
      ? pluginConfig.awarenessSenderAgeMs
      : DEFAULT_AWARENESS_SENDER_AGE_MS;
  const awarenessMaxGroups =
    typeof pluginConfig.awarenessMaxGroups === "number" && pluginConfig.awarenessMaxGroups > 0
      ? Math.floor(pluginConfig.awarenessMaxGroups)
      : DEFAULT_AWARENESS_MAX_GROUPS;
  const stateAgentsDir =
    asNonEmptyString(pluginConfig.stateAgentsDir) ?? DEFAULT_STATE_AGENTS_DIR;

  api.on("message_received", (event, ctx) => {
    if (ctx.channelId !== "telegram") {
      return;
    }
    const accountId = asNonEmptyString(ctx.accountId);
    if (!accountId || !isAccountEnabled(accountId, enabledAccounts)) {
      return;
    }

    const metadata = asRecord(event.metadata);
    const toTargetRaw = asNonEmptyString(metadata?.to) ?? asNonEmptyString(ctx.conversationId);
    if (!toTargetRaw) {
      return;
    }
    const toTarget = canonicalConversationTarget(toTargetRaw);

    const parsedTo = parseTelegramTarget(toTargetRaw);
    const parsedFrom = parseTelegramTarget(event.from ?? "");
    const isGroup = parsedTo.kind === "group" || parsedFrom.kind === "group";
    const senderId = extractSenderId(metadata, event.from);
    const groupId = parsedTo.kind === "group" ? parsedTo.id : parsedFrom.kind === "group" ? parsedFrom.id : undefined;

    cleanupExpiredContext(maxSenderAgeMs);
    lastInboundByConversation.set(makeConversationKey(accountId, toTarget), {
      accountId: accountId.trim().toLowerCase(),
      toTarget,
      senderId,
      timestampMs: Date.now(),
      isGroup,
    });

    if (!isGroup || !groupId) {
      return;
    }

    cleanupExpiredGroupAwareness(awarenessSenderAgeMs);
    groupAwarenessByConversation.set(makeConversationKey(accountId, toTarget), {
      accountId: accountId.trim().toLowerCase(),
      groupId,
      conversationTarget: toTarget,
      timestampMs: Date.now(),
      senderId,
      conversationLabel: extractGroupConversationLabel(metadata, event.content),
      groupSubject: extractGroupSubject(metadata, event.content),
      lastMessagePreview: extractGroupMessagePreview(event.content),
    });
  });

  api.on("before_prompt_build", (_event, ctx) => {
    const sessionKey = asNonEmptyString(ctx.sessionKey);
    if (!sessionKey) {
      return;
    }

    const parsedSession = parseTelegramSessionKey(sessionKey);
    if (parsedSession.kind !== "direct") {
      return;
    }

    const accountId = parsedSession.accountId ?? resolveDefaultEnabledAccount(enabledAccounts);
    if (!accountId || !isAccountEnabled(accountId, enabledAccounts)) {
      return;
    }

    const awarenessContext = buildTelegramAwarenessContext(
      api.config,
      accountId,
      parsedSession.agentId,
      awarenessSenderAgeMs,
      awarenessMaxGroups,
      stateAgentsDir,
    );
    if (!awarenessContext) {
      return;
    }
    return {
      prependContext: awarenessContext,
    };
  });

  api.on("before_tool_call", (_event, ctx) => {
    const sessionKey = asNonEmptyString(ctx.sessionKey);
    if (!sessionKey) {
      return;
    }

    const parsedSession = parseTelegramSessionKey(sessionKey);
    if (!parsedSession.toTarget || parsedSession.kind === "unknown") {
      return;
    }

    const parsedTarget = parseTelegramTarget(parsedSession.toTarget);
    if (parsedTarget.kind === "unknown") {
      return;
    }
    // This guard is only intended to constrain group-sourced runs.
    if (parsedTarget.kind !== "group") {
      return;
    }

    cleanupExpiredContext(maxSenderAgeMs);
    const cached = findLatestInboundForTarget(parsedSession.toTarget, maxSenderAgeMs, parsedSession.accountId);
    const accountId =
      parsedSession.accountId ?? cached?.accountId ?? resolveDefaultEnabledAccount(enabledAccounts);
    if (!accountId || !isAccountEnabled(accountId, enabledAccounts)) {
      return;
    }

    if (!cached || !cached.senderId) {
      api.logger.info?.(
        `telegram-group-allowlist-guard: blocked tool call in ${sessionKey} (missing sender context)`,
      );
      return {
        block: true,
        blockReason: "tool execution blocked: missing recent sender context",
      };
    }

    const allowlist = resolveTelegramAllowlist(api.config, accountId, parsedTarget.id);
    if (!allowlist.has(cached.senderId)) {
      api.logger.info?.(
        `telegram-group-allowlist-guard: blocked tool call in ${sessionKey} (sender ${cached.senderId} not allowlisted)`,
      );
      return {
        block: true,
        blockReason: "tool execution blocked: triggering sender is not allowlisted",
      };
    }
  });

  api.on("message_sending", (event, ctx) => {
    if (ctx.channelId !== "telegram") {
      return;
    }
    const accountId = asNonEmptyString(ctx.accountId);
    if (!accountId || !isAccountEnabled(accountId, enabledAccounts)) {
      return;
    }

    const rawContent = asNonEmptyString(event.content) ?? "";
    if (isReasoningOnlyMessage(rawContent)) {
      api.logger.info?.(
        `telegram-group-allowlist-guard: cancelled reasoning-only message for ${accountId}`,
      );
      return { cancel: true };
    }

    const sanitizedContent = stripReasoningArtifacts(rawContent);
    if (hasThinkArtifacts(rawContent) && sanitizedContent.length === 0) {
      api.logger.info?.(
        `telegram-group-allowlist-guard: cancelled think-artifact-only message for ${accountId}`,
      );
      return { cancel: true };
    }
    const hasSanitizedContentOverride = sanitizedContent.length > 0 && sanitizedContent !== rawContent.trim();

    const toTargetRaw = asNonEmptyString(event.to);
    if (!toTargetRaw) {
      if (hasSanitizedContentOverride) {
        return { content: sanitizedContent };
      }
      return;
    }
    const toTarget = canonicalConversationTarget(toTargetRaw);

    const parsedTo = parseTelegramTarget(toTargetRaw);
    if (parsedTo.kind !== "group") {
      if (hasSanitizedContentOverride) {
        return { content: sanitizedContent };
      }
      return;
    }

    cleanupExpiredContext(maxSenderAgeMs);
    const cached = lastInboundByConversation.get(makeConversationKey(accountId, toTarget));
    if (!cached || !cached.isGroup || Date.now() - cached.timestampMs > maxSenderAgeMs) {
      api.logger.info?.(
        `telegram-group-allowlist-guard: cancelled group send for ${accountId} -> ${toTarget} (no recent sender context)`,
      );
      return { cancel: true };
    }

    if (!cached.senderId) {
      api.logger.info?.(
        `telegram-group-allowlist-guard: cancelled group send for ${accountId} -> ${toTarget} (missing sender id)`,
      );
      return { cancel: true };
    }

    const allowlist = resolveTelegramAllowlist(api.config, accountId, parsedTo.id);
    if (!allowlist.has(cached.senderId)) {
      api.logger.info?.(
        `telegram-group-allowlist-guard: cancelled group send for ${accountId} -> ${toTarget} (sender ${cached.senderId} not allowlisted)`,
      );
      return { cancel: true };
    }

    if (hasSanitizedContentOverride) {
      return { content: sanitizedContent };
    }
  });
}
