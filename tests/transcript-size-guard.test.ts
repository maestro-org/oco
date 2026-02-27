import { describe, expect, test } from "bun:test";
import registerPlugin from "../instances/core-human/config/extensions/transcript-size-guard/index";

type HookHandler = (event: Record<string, unknown>) => unknown;

function createHarness(pluginConfig?: Record<string, unknown>) {
  const hooks: Record<string, HookHandler[]> = {
    tool_result_persist: [],
  };
  const api = {
    pluginConfig,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    on: (hookName: string, handler: HookHandler) => {
      hooks[hookName] ??= [];
      hooks[hookName].push(handler);
    },
  };
  registerPlugin(api as never);
  return {
    toolResultPersist: hooks.tool_result_persist[0],
  };
}

describe("transcript-size-guard", () => {
  test("truncates oversized toolResult text payloads", () => {
    const { toolResultPersist } = createHarness({
      maxChars: 100,
      headChars: 30,
      tailChars: 20,
      truncateDetails: false,
    });

    const longText = "A".repeat(200);
    const result = toolResultPersist({
      toolName: "exec",
      message: {
        role: "toolResult",
        content: [{ type: "text", text: longText }],
      },
    }) as { message: { content: Array<{ text: string }> } };

    expect(result).toBeDefined();
    expect(result.message.content[0].text.length).toBeLessThan(longText.length);
    expect(result.message.content[0].text.includes("truncated")).toBe(true);
  });

  test("truncates oversized toolResult details when enabled", () => {
    const { toolResultPersist } = createHarness({
      maxChars: 120,
      headChars: 40,
      tailChars: 30,
      truncateDetails: true,
    });

    const longDetails = "Z".repeat(400);
    const result = toolResultPersist({
      toolName: "exec",
      message: {
        role: "toolResult",
        content: [{ type: "text", text: "ok" }],
        details: {
          aggregated: longDetails,
        },
      },
    }) as { message: { details: { aggregated: string } } };

    expect(result).toBeDefined();
    expect(result.message.details.aggregated.length).toBeLessThan(longDetails.length);
    expect(result.message.details.aggregated.includes("truncated")).toBe(true);
  });

  test("respects configured tool allowlist", () => {
    const { toolResultPersist } = createHarness({
      maxChars: 80,
      headChars: 20,
      tailChars: 20,
      tools: ["web_search"],
    });

    const result = toolResultPersist({
      toolName: "exec",
      message: {
        role: "toolResult",
        content: [{ type: "text", text: "B".repeat(300) }],
      },
    });

    expect(result).toBe(undefined);
  });
});

