import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const PATCH_MARKER = "/* oco protected telegram group reply suppression */";

function replaceOnce(source, searchValue, replacement) {
  if (!source.includes(searchValue)) {
    throw new Error(`patch anchor not found: ${searchValue.slice(0, 80)}`);
  }
  return source.replace(searchValue, replacement);
}

export function applyProtectedGroupReplySuppression(source) {
  if (source.includes(PATCH_MARKER)) {
    return source;
  }

  let patched = source;

  patched = replaceOnce(
    patched,
    `const resolveSessionTtsAuto = (
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
): string | undefined => {`,
    `${PATCH_MARKER}
const TELEGRAM_GROUP_ALLOWLIST_GUARD_PLUGIN_ID = "telegram-group-allowlist-guard";

type ParsedTelegramSession = {
  kind: "group" | "direct" | "unknown";
  accountId?: string;
  agentId?: string;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const asLowerStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry) => Boolean(entry));
};

const parseTelegramSessionKey = (sessionKey: string): ParsedTelegramSession => {
  const tokens = sessionKey.trim().toLowerCase().split(":");
  const agentId = tokens.length >= 2 && tokens[0] === "agent" ? tokens[1] : undefined;
  const telegramIndex = tokens.indexOf("telegram");
  if (telegramIndex < 0) {
    return { kind: "unknown", agentId };
  }

  const suffix = tokens.slice(telegramIndex + 1);
  if (suffix.length >= 2 && (suffix[0] === "group" || suffix[0] === "direct")) {
    return { kind: suffix[0], agentId };
  }
  if (suffix.length >= 3 && (suffix[1] === "group" || suffix[1] === "direct")) {
    return {
      kind: suffix[1],
      accountId: suffix[0],
      agentId,
    };
  }
  return { kind: "unknown", agentId };
};

const resolveProtectedTelegramGroupAccountId = (
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
): string | undefined => {
  const pluginEntry = cfg.plugins?.entries?.[TELEGRAM_GROUP_ALLOWLIST_GUARD_PLUGIN_ID];
  if (!pluginEntry || pluginEntry.enabled === false) {
    return undefined;
  }

  const pluginConfig = asRecord(pluginEntry.config);
  if (pluginConfig?.blockAllGroupReplies !== true) {
    return undefined;
  }

  const enabledAccounts = new Set(asLowerStringList(pluginConfig.enabledAccounts));
  if (enabledAccounts.size === 0) {
    return undefined;
  }

  const targetSessionKey =
    ctx.CommandSource === "native" ? ctx.CommandTargetSessionKey?.trim() : undefined;
  const sessionKey = (targetSessionKey ?? ctx.SessionKey)?.trim();
  const parsedSession = sessionKey
    ? parseTelegramSessionKey(sessionKey)
    : ({ kind: "unknown" } satisfies ParsedTelegramSession);

  for (const candidate of [ctx.AccountId, parsedSession.accountId, parsedSession.agentId]) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = candidate.trim().toLowerCase();
    if (normalized && enabledAccounts.has(normalized)) {
      return normalized;
    }
  }

  return undefined;
};

const shouldSuppressProtectedTelegramGroupReplies = (
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
): boolean => {
  const targetSessionKey =
    ctx.CommandSource === "native" ? ctx.CommandTargetSessionKey?.trim() : undefined;
  const sessionKey = (targetSessionKey ?? ctx.SessionKey)?.trim();
  const parsedSession = sessionKey
    ? parseTelegramSessionKey(sessionKey)
    : ({ kind: "unknown" } satisfies ParsedTelegramSession);
  const channel = String(
    ctx.OriginatingChannel ??
      ctx.Surface ??
      ctx.Provider ??
      (parsedSession.kind !== "unknown" ? "telegram" : ""),
  ).toLowerCase();

  if (channel !== "telegram") {
    return false;
  }
  if (parsedSession.kind !== "group" && ctx.ChatType !== "group") {
    return false;
  }

  return Boolean(resolveProtectedTelegramGroupAccountId(ctx, cfg));
};

const resolveSessionTtsAuto = (
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
): string | undefined => {`,
  );

  patched = replaceOnce(
    patched,
    `  const sessionTtsAuto = resolveSessionTtsAuto(ctx, cfg);
  const hookRunner = getGlobalHookRunner();`,
    `  const sessionTtsAuto = resolveSessionTtsAuto(ctx, cfg);
  const hookRunner = getGlobalHookRunner();
  const suppressProtectedTelegramGroupReplies = shouldSuppressProtectedTelegramGroupReplies(
    ctx,
    cfg,
  );
  if (suppressProtectedTelegramGroupReplies) {
    logVerbose(
      \`dispatch-from-config: suppressing outbound payloads for protected telegram group session \${ctx.CommandTargetSessionKey ?? ctx.SessionKey ?? "unknown"}\`,
    );
  }`,
  );

  patched = replaceOnce(
    patched,
    `  const sendPayloadAsync = async (
    payload: ReplyPayload,
    abortSignal?: AbortSignal,
    mirror?: boolean,
  ): Promise<void> => {
    // TypeScript doesn't narrow these from the shouldRouteToOriginating check,`,
    `  const sendPayloadAsync = async (
    payload: ReplyPayload,
    abortSignal?: AbortSignal,
    mirror?: boolean,
  ): Promise<void> => {
    if (suppressProtectedTelegramGroupReplies) {
      return;
    }
    // TypeScript doesn't narrow these from the shouldRouteToOriginating check,`,
  );

  patched = replaceOnce(
    patched,
    `    if (fastAbort.handled) {
      const payload = {
        text: formatAbortReplyText(fastAbort.stoppedSubagents),
      } satisfies ReplyPayload;`,
    `    if (fastAbort.handled) {
      if (suppressProtectedTelegramGroupReplies) {
        const counts = dispatcher.getQueuedCounts();
        recordProcessed("completed", { reason: "protected_group_fast_abort_suppressed" });
        markIdle("message_completed");
        return { queuedFinal: false, counts };
      }
      const payload = {
        text: formatAbortReplyText(fastAbort.stoppedSubagents),
      } satisfies ReplyPayload;`,
  );

  patched = replaceOnce(
    patched,
    `    const resolveToolDeliveryPayload = (payload: ReplyPayload): ReplyPayload | null => {
      if (shouldSendToolSummaries) {
        return payload;
      }`,
    `    const resolveToolDeliveryPayload = (payload: ReplyPayload): ReplyPayload | null => {
      if (suppressProtectedTelegramGroupReplies) {
        return null;
      }
      if (shouldSendToolSummaries) {
        return payload;
      }`,
  );

  patched = replaceOnce(
    patched,
    `        onToolResult: (payload: ReplyPayload) => {
          const run = async () => {
            const ttsPayload = await maybeApplyTtsToPayload({`,
    `        onToolResult: (payload: ReplyPayload) => {
          const run = async () => {
            if (suppressProtectedTelegramGroupReplies) {
              return;
            }
            const ttsPayload = await maybeApplyTtsToPayload({`,
  );

  patched = replaceOnce(
    patched,
    `        onBlockReply: (payload: ReplyPayload, context) => {
          const run = async () => {
            // Accumulate block text for TTS generation after streaming`,
    `        onBlockReply: (payload: ReplyPayload, context) => {
          const run = async () => {
            if (suppressProtectedTelegramGroupReplies) {
              return;
            }
            // Accumulate block text for TTS generation after streaming`,
  );

  patched = replaceOnce(
    patched,
    `    const replies = replyResult ? (Array.isArray(replyResult) ? replyResult : [replyResult]) : [];

    let queuedFinal = false;`,
    `    const replies = replyResult ? (Array.isArray(replyResult) ? replyResult : [replyResult]) : [];
    const dispatchableReplies = suppressProtectedTelegramGroupReplies ? [] : replies;

    let queuedFinal = false;`,
  );

  patched = replaceOnce(
    patched,
    `    for (const reply of replies) {`,
    `    for (const reply of dispatchableReplies) {`,
  );

  patched = replaceOnce(
    patched,
    `      replies.length === 0 &&`,
    `      dispatchableReplies.length === 0 &&`,
  );

  return patched;
}

export function patchProtectedGroupReplySuppression(runtimeRoot = process.env.OPENCLAW_RUNTIME_ROOT ?? "/app") {
  const targetPath = join(runtimeRoot, "src/auto-reply/reply/dispatch-from-config.ts");
  const original = readFileSync(targetPath, "utf8");
  const patched = applyProtectedGroupReplySuppression(original);
  if (patched !== original) {
    writeFileSync(targetPath, patched);
  }
  return targetPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const targetPath = patchProtectedGroupReplySuppression();
  process.stdout.write(`patched ${targetPath}\n`);
}
