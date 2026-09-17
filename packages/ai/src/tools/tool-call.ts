import type { Tool, ToolResult, ToolContext, Logger } from "./tool.js";
import { createLogger } from "./tool-logger.js";
import type { ValidationResult } from "./tool-validation.js";

export interface ToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallParseResult {
  toolCall?: ToolCall;
  finalReply?: string;
}

export interface ToolLoopResult {
  finalReply: string;
  toolResults: ToolResult[];
  toolCallsMade: number;
  iterationLimitReached: boolean;
  toolErrors: number;
  toolTimeouts: number;
}

export interface ToolLoopOptions {
  getModelResponse: (messages: { role: string; content: string }[]) => Promise<string>;
  executor: ToolExecutorLike;
  registry: ToolRegistryLike;
  maxIterations: number;
  initialMessages?: { role: string; content: string }[];
  signal?: AbortSignal;
  logger?: Logger;
  iterationDelayMs?: number;
  maxInputLength?: number;
}

export interface ToolExecutorLike {
  execute(toolName: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}

export interface ToolRegistryLike {
  get(name: string): Tool | undefined;
  list(): Tool[];
}

function extractJsonFromResponse(response: string): string | null {
  const codeBlockPatterns = [
    /```(?:json)?\s*\n?([\s\S]*?)\s*```/g,
    /```\s*\n?([\s\S]*?)\s*```/g,
  ];

  for (const pattern of codeBlockPatterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(response)) !== null) {
      const candidate = match[1].trim();
      const extracted = tryExtractJsonFromText(candidate);
      if (extracted !== null) {
        const parsed = safeParseJson(extracted);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && hasToolField(parsed)) {
          return extracted;
        }
      }
    }
  }

  return tryExtractJsonFromText(response.trim());
}

function hasToolField(obj: object): boolean {
  const record = obj as Record<string, unknown>;
  return record.tool !== undefined || record.toolName !== undefined;
}

function safeParseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function tryExtractJsonFromText(text: string): string | null {
  const firstOpen = text.indexOf("{");
  if (firstOpen === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = firstOpen; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escapeNext = true;
      continue;
    }

    if (ch === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(firstOpen, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export function parseToolCall(response: string): ToolCallParseResult {
  const jsonStr = extractJsonFromResponse(response);

  if (!jsonStr) {
    return { finalReply: response.trim() };
  }

  let parsed: { tool?: string; toolName?: string; arguments?: Record<string, unknown> };

  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { finalReply: response.trim() };
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if (parsed.tool !== undefined && typeof parsed.tool !== "string") {
      return { finalReply: response.trim() };
    }
    if (parsed.toolName !== undefined && typeof parsed.toolName !== "string") {
      return { finalReply: response.trim() };
    }
    if (parsed.arguments !== undefined && (typeof parsed.arguments !== "object" || Array.isArray(parsed.arguments))) {
      return { finalReply: response.trim() };
    }
  }

  const toolName = parsed.tool ?? parsed.toolName;

  if (typeof toolName !== "string" || !toolName) {
    return { finalReply: response.trim() };
  }

  if (!parsed.arguments || typeof parsed.arguments !== "object" || Array.isArray(parsed.arguments)) {
    return { finalReply: response.trim() };
  }

  return {
    toolCall: {
      toolName,
      arguments: parsed.arguments as Record<string, unknown>,
    },
  };
}

export function describeTool(tool: Tool): string {
  return `${tool.name}: ${tool.description}. Input schema: ${JSON.stringify(tool.inputSchema)}`;
}

export function describeAllTools(tools: Tool[]): string {
  if (tools.length === 0) {
    return "No tools are currently available.";
  }
  return tools.map(describeTool).join("\n");
}

export async function executeToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const { getModelResponse, executor, registry, maxIterations, initialMessages, signal, logger, iterationDelayMs = 0, maxInputLength = 500_000 } = options;
  const log = logger ?? createLogger(false);

  let finalReply = "";
  const toolResults: ToolResult[] = [];
  let toolCallsMade = 0;
  let iterationLimitReached = false;
  let toolErrors = 0;
  let toolTimeouts = 0;

  const messages: Array<{ role: string; content: string }> = initialMessages ?? [];

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) {
      finalReply = "Tool execution cancelled.";
      iterationLimitReached = i >= maxIterations - 1;
      break;
    }

    if (iterationDelayMs > 0 && i > 0) {
      await new Promise((resolve) => setTimeout(resolve, iterationDelayMs));
    }

    const response = await getModelResponse(messages);

    if (response.length > maxInputLength) {
      log.warn(`Tool loop: response exceeds max input length (${response.length} > ${maxInputLength}), treating as final reply`);
      finalReply = response.slice(0, maxInputLength);
      break;
    }

    const parseResult = parseToolCall(response);

    if (parseResult.finalReply !== undefined) {
      finalReply = parseResult.finalReply;
      break;
    }

    const toolCall = parseResult.toolCall!;
    log.info(`Tool loop: executing tool ${toolCall.toolName} (iteration ${i + 1})`);

    const validation = validateToolCall(executor, registry, toolCall);
    if (validation) {
      toolResults.push(validation);
      messages.push({ role: "assistant", content: response.trim() });
      messages.push({ role: "tool", content: formatToolResultForMessage(validation) });
      toolCallsMade++;
      if (!validation.success) {
        toolErrors++;
        if (validation.code === "TIMEOUT") {
          toolTimeouts++;
        }
      }
      continue;
    }

    const result = await executor.execute(toolCall.toolName, toolCall.arguments, signal);
    log.info(`Tool loop: tool ${toolCall.toolName} completed (${result.status})`);

    toolResults.push(result);
    messages.push({ role: "assistant", content: response.trim() });
    messages.push({ role: "tool", content: formatToolResultForMessage(result) });
    toolCallsMade++;
    if (!result.success) {
      toolErrors++;
      if (result.status === "timeout") {
        toolTimeouts++;
      }
    }
  }

  if (toolCallsMade >= maxIterations && !finalReply) {
    iterationLimitReached = true;
    finalReply = `I've reached the maximum number of tool calls (${maxIterations}). Let me provide my best answer based on what I've gathered.`;
  }

  return { finalReply, toolResults, toolCallsMade, iterationLimitReached, toolErrors, toolTimeouts };
}

function validateToolCall(
  executor: ToolExecutorLike,
  registry: ToolRegistryLike,
  toolCall: ToolCall,
): ToolResult | null {
  const tool = registry.get(toolCall.toolName);

  if (!tool) {
    return {
      success: false,
      toolName: toolCall.toolName,
      status: "error",
      error: `Tool not found: ${toolCall.toolName}`,
      code: "NOT_FOUND",
      durationMs: 0,
    };
  }

  const validation = validateInputForTool(tool, toolCall.arguments);
  if (!validation.valid) {
    return {
      success: false,
      toolName: toolCall.toolName,
      status: "error",
      error: validation.errors.join("; "),
      code: "VALIDATION_ERROR",
      durationMs: 0,
    };
  }

  return null;
}

function validateInputForTool(tool: { inputSchema: { type: string; properties?: Record<string, { type: string }>; required?: string[] } }, input: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const schema = tool.inputSchema;

  if (schema.type !== "object") {
    return { valid: false, errors: [`Unsupported schema type: ${schema.type}`] };
  }

  const required = schema.required ?? [];
  for (const field of required) {
    if (!(field in input)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  const props = schema.properties ?? {};
  for (const [key, value] of Object.entries(input)) {
    const prop = props[key];
    if (!prop) {
      errors.push(`Unknown field: ${key}`);
      continue;
    }

    if (typeof value === "string") {
      if (value.includes("\0")) {
        errors.push(`Field ${key}: contains null bytes`);
        continue;
      }
      if (value.length > 100_000) {
        errors.push(`Field ${key}: exceeds maximum length of 100000 characters`);
        continue;
      }
    }

    const typeCheck = typeof value;
    const expected = prop.type;

    if (expected === "integer") {
      if (!Number.isInteger(value)) {
        errors.push(`Field ${key}: expected integer, got ${typeCheck}`);
      }
    } else if (expected === "array") {
      if (!Array.isArray(value)) {
        errors.push(`Field ${key}: expected array, got ${typeCheck}`);
      }
    } else if (expected !== typeCheck) {
      errors.push(`Field ${key}: expected ${expected}, got ${typeCheck}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function formatToolResultForMessage(result: ToolResult): string {
  const status = result.status.toUpperCase();
  const detail = result.success && result.output !== undefined
    ? JSON.stringify(result.output)
    : result.error ?? "No details";
  const codeLine = result.code ? ` [${result.code}]` : "";
  return `[${status}] ${result.toolName}${codeLine}: ${detail}`;
}
