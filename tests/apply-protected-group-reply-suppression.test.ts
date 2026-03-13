import { describe, expect, test } from "bun:test";
import {
  applyProtectedGroupReplySuppression,
  PATCH_MARKER,
} from "../instances/core-human/config/openclaw-runtime-patches/apply-protected-group-reply-suppression.mjs";

const FIXTURE = `import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadSessionStore, resolveStorePath } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { createInternalHookEvent, triggerInternalHook } from "../../hooks/internal-hooks.js";
import { isDiagnosticsEnabled } from "../../infra/diagnostic-events.js";
import {
  logMessageProcessed,
  logMessageQueued,
  logSessionStateChange,
} from "../../logging/diagnostic.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { maybeApplyTtsToPayload, normalizeTtsAutoMode, resolveTtsConfig } from "../../tts/tts.js";
import { getReplyFromConfig } from "../reply.js";
import type { FinalizedMsgContext } from "../templating.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { formatAbortReplyText, tryFastAbortFromMessage } from "./abort.js";
import { shouldSkipDuplicateInbound } from "./inbound-dedupe.js";
import type { ReplyDispatcher, ReplyDispatchKind } from "./reply-dispatcher.js";
import { isRoutableChannel, routeReply } from "./route-reply.js";

const resolveSessionTtsAuto = (
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
): string | undefined => {
  const targetSessionKey =
    ctx.CommandSource === "native" ? ctx.CommandTargetSessionKey?.trim() : undefined;
  const sessionKey = (targetSessionKey ?? ctx.SessionKey)?.trim();
  if (!sessionKey) {
    return undefined;
  }
  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  try {
    const store = loadSessionStore(storePath);
    const entry = store[sessionKey.toLowerCase()] ?? store[sessionKey];
    return normalizeTtsAutoMode(entry?.ttsAuto);
  } catch {
    return undefined;
  }
};

export type DispatchFromConfigResult = {
  queuedFinal: boolean;
  counts: Record<ReplyDispatchKind, number>;
};

export async function dispatchReplyFromConfig(params: {
  ctx: FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof getReplyFromConfig;
}): Promise<DispatchFromConfigResult> {
  const { ctx, cfg, dispatcher } = params;
  const diagnosticsEnabled = isDiagnosticsEnabled(cfg);
  const channel = String(ctx.Surface ?? ctx.Provider ?? "unknown").toLowerCase();
  const chatId = ctx.To ?? ctx.From;
  const messageId = ctx.MessageSid ?? ctx.MessageSidFirst ?? ctx.MessageSidLast;
  const sessionKey = ctx.SessionKey;
  const startTime = diagnosticsEnabled ? Date.now() : 0;
  const canTrackSession = diagnosticsEnabled && Boolean(sessionKey);
  const recordProcessed = (
    outcome: "completed" | "skipped" | "error",
    opts?: {
      reason?: string;
      error?: string;
    },
  ) => {};
  const markProcessing = () => {};
  const markIdle = (reason: string) => {};

  if (shouldSkipDuplicateInbound(ctx)) {
    recordProcessed("skipped", { reason: "duplicate" });
    return { queuedFinal: false, counts: dispatcher.getQueuedCounts() };
  }

  const inboundAudio = false;
  const sessionTtsAuto = resolveSessionTtsAuto(ctx, cfg);
  const hookRunner = getGlobalHookRunner();
  const shouldRouteToOriginating = false;
  const originatingChannel = ctx.OriginatingChannel;
  const originatingTo = ctx.OriginatingTo;
  const ttsChannel = "telegram";

  const sendPayloadAsync = async (
    payload: ReplyPayload,
    abortSignal?: AbortSignal,
    mirror?: boolean,
  ): Promise<void> => {
    // TypeScript doesn't narrow these from the shouldRouteToOriginating check,
    // but they're guaranteed non-null when this function is called.
    if (!originatingChannel || !originatingTo) {
      return;
    }
    const result = await routeReply({
      payload,
      channel: originatingChannel,
      to: originatingTo,
      sessionKey: ctx.SessionKey,
      accountId: ctx.AccountId,
      threadId: ctx.MessageThreadId,
      cfg,
      abortSignal,
      mirror,
    });
    if (!result.ok) {
      logVerbose(\`dispatch-from-config: route-reply failed: \${result.error ?? "unknown error"}\`);
    }
  };

  markProcessing();

  try {
    const fastAbort = await tryFastAbortFromMessage({ ctx, cfg });
    if (fastAbort.handled) {
      const payload = {
        text: formatAbortReplyText(fastAbort.stoppedSubagents),
      } satisfies ReplyPayload;
      let queuedFinal = false;
      let routedFinalCount = 0;
      if (shouldRouteToOriginating && originatingChannel && originatingTo) {
        const result = await routeReply({
          payload,
          channel: originatingChannel,
          to: originatingTo,
          sessionKey: ctx.SessionKey,
          accountId: ctx.AccountId,
          threadId: ctx.MessageThreadId,
          cfg,
        });
        queuedFinal = result.ok;
        if (result.ok) {
          routedFinalCount += 1;
        }
      } else {
        queuedFinal = dispatcher.sendFinalReply(payload);
      }
      const counts = dispatcher.getQueuedCounts();
      counts.final += routedFinalCount;
      recordProcessed("completed", { reason: "fast_abort" });
      markIdle("message_completed");
      return { queuedFinal, counts };
    }

    let accumulatedBlockText = "";
    let blockCount = 0;
    const shouldSendToolSummaries = ctx.ChatType !== "group" && ctx.CommandSource !== "native";

    const resolveToolDeliveryPayload = (payload: ReplyPayload): ReplyPayload | null => {
      if (shouldSendToolSummaries) {
        return payload;
      }
      const hasMedia = Boolean(payload.mediaUrl) || (payload.mediaUrls?.length ?? 0) > 0;
      if (!hasMedia) {
        return null;
      }
      return { ...payload, text: undefined };
    };

    const replyResult = await (params.replyResolver ?? getReplyFromConfig)(
      ctx,
      {
        ...params.replyOptions,
        onToolResult: (payload: ReplyPayload) => {
          const run = async () => {
            const ttsPayload = await maybeApplyTtsToPayload({
              payload,
              cfg,
              channel: ttsChannel,
              kind: "tool",
              inboundAudio,
              ttsAuto: sessionTtsAuto,
            });
            const deliveryPayload = resolveToolDeliveryPayload(ttsPayload);
            if (!deliveryPayload) {
              return;
            }
            if (shouldRouteToOriginating) {
              await sendPayloadAsync(deliveryPayload, undefined, false);
            } else {
              dispatcher.sendToolResult(deliveryPayload);
            }
          };
          return run();
        },
        onBlockReply: (payload: ReplyPayload, context) => {
          const run = async () => {
            // Accumulate block text for TTS generation after streaming
            if (payload.text) {
              if (accumulatedBlockText.length > 0) {
                accumulatedBlockText += "\\n";
              }
              accumulatedBlockText += payload.text;
              blockCount++;
            }
            const ttsPayload = await maybeApplyTtsToPayload({
              payload,
              cfg,
              channel: ttsChannel,
              kind: "block",
              inboundAudio,
              ttsAuto: sessionTtsAuto,
            });
            if (shouldRouteToOriginating) {
              await sendPayloadAsync(ttsPayload, context?.abortSignal, false);
            } else {
              dispatcher.sendBlockReply(ttsPayload);
            }
          };
          return run();
        },
      },
      cfg,
    );

    const replies = replyResult ? (Array.isArray(replyResult) ? replyResult : [replyResult]) : [];

    let queuedFinal = false;
    let routedFinalCount = 0;
    for (const reply of replies) {
      const ttsReply = await maybeApplyTtsToPayload({
        payload: reply,
        cfg,
        channel: ttsChannel,
        kind: "final",
        inboundAudio,
        ttsAuto: sessionTtsAuto,
      });
      if (shouldRouteToOriginating && originatingChannel && originatingTo) {
        const result = await routeReply({
          payload: ttsReply,
          channel: originatingChannel,
          to: originatingTo,
          sessionKey: ctx.SessionKey,
          accountId: ctx.AccountId,
          threadId: ctx.MessageThreadId,
          cfg,
        });
        if (!result.ok) {
          logVerbose(
            \`dispatch-from-config: route-reply (final) failed: \${result.error ?? "unknown error"}\`,
          );
        }
        queuedFinal = result.ok || queuedFinal;
        if (result.ok) {
          routedFinalCount += 1;
        }
      } else {
        queuedFinal = dispatcher.sendFinalReply(ttsReply) || queuedFinal;
      }
    }

    const ttsMode = resolveTtsConfig(cfg).mode ?? "final";
    if (
      ttsMode === "final" &&
      replies.length === 0 &&
      blockCount > 0 &&
      accumulatedBlockText.trim()
    ) {
      const ttsSyntheticReply = await maybeApplyTtsToPayload({
        payload: { text: accumulatedBlockText },
        cfg,
        channel: ttsChannel,
        kind: "final",
        inboundAudio,
        ttsAuto: sessionTtsAuto,
      });
      if (ttsSyntheticReply.mediaUrl) {
        const ttsOnlyPayload: ReplyPayload = {
          mediaUrl: ttsSyntheticReply.mediaUrl,
          audioAsVoice: ttsSyntheticReply.audioAsVoice,
        };
        if (shouldRouteToOriginating && originatingChannel && originatingTo) {
          const result = await routeReply({
            payload: ttsOnlyPayload,
            channel: originatingChannel,
            to: originatingTo,
            sessionKey: ctx.SessionKey,
            accountId: ctx.AccountId,
            threadId: ctx.MessageThreadId,
            cfg,
          });
          queuedFinal = result.ok || queuedFinal;
          if (result.ok) {
            routedFinalCount += 1;
          }
        } else {
          const didQueue = dispatcher.sendFinalReply(ttsOnlyPayload);
          queuedFinal = didQueue || queuedFinal;
        }
      }
    }

    const counts = dispatcher.getQueuedCounts();
    counts.final += routedFinalCount;
    recordProcessed("completed");
    markIdle("message_completed");
    return { queuedFinal, counts };
  } catch (err) {
    recordProcessed("error", { error: String(err) });
    markIdle("message_error");
    throw err;
  }
}`;

describe("applyProtectedGroupReplySuppression", () => {
  test("injects protected Telegram group suppression into the runtime dispatcher", () => {
    const patched = applyProtectedGroupReplySuppression(FIXTURE);

    expect(patched).toContain(PATCH_MARKER);
    expect(patched).toContain(
      `const suppressProtectedTelegramGroupReplies = shouldSuppressProtectedTelegramGroupReplies(`,
    );
    expect(patched).toContain(`if (suppressProtectedTelegramGroupReplies) {`);
    expect(patched).toContain(`return null;`);
    expect(patched).toContain(`return;`);
    expect(patched).toContain(
      `const dispatchableReplies = suppressProtectedTelegramGroupReplies ? [] : replies;`,
    );
    expect(patched).toContain(`for (const reply of dispatchableReplies) {`);
    expect(patched).toContain(`dispatchableReplies.length === 0 &&`);
  });

  test("is idempotent when the marker is already present", () => {
    const patched = applyProtectedGroupReplySuppression(FIXTURE);

    expect(applyProtectedGroupReplySuppression(patched)).toBe(patched);
  });
});
