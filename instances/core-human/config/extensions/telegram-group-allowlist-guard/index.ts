import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";

type GuardPluginConfig = {
  enabledAccounts?: string[];
  maxSenderAgeMs?: number;
};

type LastInboundSender = {
  accountId: string;
  toTarget: string;
  senderId?: string;
  timestampMs: number;
  isGroup: boolean;
};

type ParsedTelegramTarget = {
  kind: "group" | "direct" | "unknown";
  id: string;
};

type ParsedTelegramSession = {
  kind: "group" | "direct" | "unknown";
  accountId?: string;
  toTarget?: string;
};

const DEFAULT_MAX_SENDER_AGE_MS = 5 * 60 * 1000;
const lastInboundByConversation = new Map<string, LastInboundSender>();

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
  const telegramIndex = tokens.indexOf("telegram");
  if (telegramIndex < 0) {
    return { kind: "unknown" };
  }

  const suffix = tokens.slice(telegramIndex + 1);
  if (suffix.length >= 2 && (suffix[0] === "group" || suffix[0] === "direct")) {
    return {
      kind: suffix[0],
      toTarget: `telegram:${suffix[1]}`,
    };
  }

  if (suffix.length >= 3 && (suffix[1] === "group" || suffix[1] === "direct")) {
    return {
      kind: suffix[1],
      accountId: suffix[0],
      toTarget: `telegram:${suffix[2]}`,
    };
  }

  return { kind: "unknown" };
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

    cleanupExpiredContext(maxSenderAgeMs);
    lastInboundByConversation.set(makeConversationKey(accountId, toTarget), {
      accountId: accountId.trim().toLowerCase(),
      toTarget,
      senderId,
      timestampMs: Date.now(),
      isGroup,
    });
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
