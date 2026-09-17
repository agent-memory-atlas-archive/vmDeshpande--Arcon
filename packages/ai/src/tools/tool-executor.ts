import { validateInput, type ValidationResult } from "./tool-validation.js";
import type { Tool, ToolContext, ToolResult } from "./tool.js";
import type { ToolRegistry } from "./tool-registry.js";
import { createLogger, type Logger } from "./tool-logger.js";

export interface ToolExecutorOptions {
  defaultTimeoutMs?: number;
  logger?: Logger;
  logEnabled?: boolean;
}

export class ToolExecutor {
  private readonly timeoutMs: number;
  private readonly logger: Logger;

  constructor(private registry: ToolRegistry, options: ToolExecutorOptions = {}) {
    this.timeoutMs = options.defaultTimeoutMs ?? 5000;
    this.logger = options.logger ?? createLogger(options.logEnabled ?? false);
  }

  getTools(): Tool[] {
    return this.registry.list();
  }

  get(name: string): Tool | undefined {
    return this.registry.get(name);
  }

  list(): Tool[] {
    return this.registry.list();
  }

  private findTool(name: string): Tool | undefined {
    const exact = this.registry.get(name);
    if (exact) return exact;
    const lower = name.toLowerCase();
    return this.registry.list().find((t) => t.name.toLowerCase() === lower);
  }

  async execute(toolName: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const tool = this.findTool(toolName);

    if (!tool) {
      return {
        success: false,
        toolName,
        status: "error",
        error: `Tool not found: ${toolName}`,
        code: "NOT_FOUND",
        durationMs: 0,
      };
    }

    const validation = this.validate(tool, input);
    if (!validation.valid) {
      return {
        success: false,
        toolName,
        status: "error",
        error: validation.errors.join("; "),
        code: "VALIDATION_ERROR",
        durationMs: 0,
      };
    }

    this.logger.info(`Executing tool: ${toolName}`, { input });

    const startTime = Date.now();

    try {
      const result = await this.runWithTimeout(tool.execute(input, { logger: this.logger, signal }), this.timeoutMs, toolName, signal);
      const durationMs = Date.now() - startTime;

      this.logger.info(`Tool completed: ${toolName}`, { durationMs, status: result.status });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Tool failed: ${toolName}`, { durationMs, error: message });

      return {
        success: false,
        toolName,
        status: "error",
        error: message,
        code: "EXECUTION_ERROR",
        durationMs,
      };
    }
  }

  private validate(tool: Tool, input: Record<string, unknown>): ValidationResult {
    return validateInput(tool.inputSchema, input);
  }

  private async runWithTimeout(
    execution: Promise<ToolResult>,
    timeoutMs: number,
    toolName: string,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<ToolResult>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms: ${toolName}`));
      }, timeoutMs);
    });

    if (signal?.aborted) {
      return {
        success: false,
        toolName,
        status: "cancelled",
        error: `Tool execution cancelled: ${toolName}`,
        code: "CANCELLED",
        durationMs: 0,
      };
    }

    try {
      const result = await Promise.race([execution, timeoutPromise]);

      if (signal?.aborted) {
        return {
          success: false,
          toolName,
          status: "cancelled",
          error: `Tool execution cancelled: ${toolName}`,
          code: "CANCELLED",
          durationMs: 0,
        };
      }

      return result;
    } catch (error) {
      if (signal?.aborted) {
        return {
          success: false,
          toolName,
          status: "cancelled",
          error: `Tool execution cancelled: ${toolName}`,
          code: "CANCELLED",
          durationMs: 0,
        };
      }
      if (error instanceof Error && error.message.includes("timed out")) {
        return {
          success: false,
          toolName,
          status: "timeout",
          error: error.message,
          code: "TIMEOUT",
          durationMs: timeoutMs,
        };
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
