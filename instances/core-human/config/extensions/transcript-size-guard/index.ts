import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type TranscriptSizeGuardConfig = {
  maxChars?: number;
  headChars?: number;
  tailChars?: number;
  truncateDetails?: boolean;
  tools?: string[];
};

type TruncateSettings = {
  maxChars: number;
  headChars: number;
  tailChars: number;
  truncateDetails: boolean;
  toolAllowlist: Set<string> | null;
};

type TrimResult<T> = {
  value: T;
  changed: boolean;
};

const DEFAULT_MAX_CHARS = 12000;
const DEFAULT_HEAD_CHARS = 4000;
const DEFAULT_TAIL_CHARS = 3000;

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function normalizeToolAllowlist(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry) => entry.length > 0);
  if (normalized.length === 0) {
    return null;
  }
  return new Set(normalized);
}

function resolveSettings(config: TranscriptSizeGuardConfig | undefined): TruncateSettings {
  const maxChars = toPositiveInt(config?.maxChars, DEFAULT_MAX_CHARS);
  let headChars = toPositiveInt(config?.headChars, DEFAULT_HEAD_CHARS);
  let tailChars = toPositiveInt(config?.tailChars, DEFAULT_TAIL_CHARS);
  if (headChars + tailChars >= maxChars) {
    const budget = Math.max(2, maxChars - 1);
    headChars = Math.max(1, Math.floor((budget * 2) / 3));
    tailChars = Math.max(1, budget - headChars);
  }
  return {
    maxChars,
    headChars,
    tailChars,
    truncateDetails: toBoolean(config?.truncateDetails, true),
    toolAllowlist: normalizeToolAllowlist(config?.tools),
  };
}

function truncateString(
  input: string,
  settings: TruncateSettings,
  label: string,
): TrimResult<string> {
  if (input.length <= settings.maxChars) {
    return {
      value: input,
      changed: false,
    };
  }
  const removed = input.length - settings.headChars - settings.tailChars;
  return {
    value:
      `${input.slice(0, settings.headChars)}\n` +
      `...[${label} truncated ${removed} chars]...\n` +
      `${input.slice(-settings.tailChars)}`,
    changed: true,
  };
}

function trimUnknownDeep(value: unknown, settings: TruncateSettings, label: string): TrimResult<unknown> {
  if (typeof value === "string") {
    return truncateString(value, settings, label);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const trimmed = trimUnknownDeep(entry, settings, label);
      if (trimmed.changed) {
        changed = true;
      }
      return trimmed.value;
    });
    return { value: next, changed };
  }
  if (!value || typeof value !== "object") {
    return { value, changed: false };
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const trimmed = trimUnknownDeep(entry, settings, `${label}:${key}`);
    next[key] = trimmed.value;
    if (trimmed.changed) {
      changed = true;
    }
  }
  return { value: next, changed };
}

function isToolResultMessage(message: unknown): message is Record<string, unknown> {
  return Boolean(
    message &&
      typeof message === "object" &&
      (message as Record<string, unknown>).role === "toolResult",
  );
}

function shouldProcessTool(toolAllowlist: Set<string> | null, toolName: unknown): boolean {
  if (!toolAllowlist || toolAllowlist.size === 0) {
    return true;
  }
  if (typeof toolName !== "string") {
    return false;
  }
  return toolAllowlist.has(toolName.trim().toLowerCase());
}

function cloneMessage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default function register(api: OpenClawPluginApi): void {
  const settings = resolveSettings((api.pluginConfig ?? {}) as TranscriptSizeGuardConfig);

  api.on("tool_result_persist", (event) => {
    if (!shouldProcessTool(settings.toolAllowlist, event.toolName)) {
      return;
    }
    if (!isToolResultMessage(event.message)) {
      return;
    }

    const next = cloneMessage(event.message);
    let changed = false;

    if (Array.isArray(next.content)) {
      next.content = next.content.map((part) => {
        if (!part || typeof part !== "object") {
          return part;
        }
        const text = (part as Record<string, unknown>).text;
        if (typeof text !== "string") {
          return part;
        }
        const trimmed = truncateString(text, settings, "toolResult.content");
        if (!trimmed.changed) {
          return part;
        }
        changed = true;
        return {
          ...(part as Record<string, unknown>),
          text: trimmed.value,
        };
      });
    }

    if (settings.truncateDetails && next.details !== undefined) {
      const trimmed = trimUnknownDeep(next.details, settings, "toolResult.details");
      if (trimmed.changed) {
        changed = true;
        next.details = trimmed.value;
      }
    }

    if (!changed) {
      return;
    }

    api.logger.info?.(
      `transcript-size-guard: truncated persisted toolResult for tool=${String(event.toolName ?? "unknown")}`,
    );
    return { message: next };
  });
}

