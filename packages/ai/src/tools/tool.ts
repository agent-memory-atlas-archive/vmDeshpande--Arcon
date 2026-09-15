export interface ToolInputSchema {
  type: "object";
  properties: Record<string, { type: "string" | "number" | "boolean" | "integer" | "array" | "object"; description?: string }>;
  required?: string[];
}

export type ToolResultStatus = "success" | "error" | "timeout" | "cancelled";

export interface ToolResult {
  success: boolean;
  toolName: string;
  status: ToolResultStatus;
  output?: unknown;
  error?: string;
  code?: string;
  durationMs: number;
}

export interface ToolContext {
  logger: Logger;
  signal?: AbortSignal;
}

export interface Logger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
