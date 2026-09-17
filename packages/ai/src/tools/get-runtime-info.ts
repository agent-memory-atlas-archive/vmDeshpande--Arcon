import type { Tool, ToolContext, ToolResult } from "./tool.js";
import type { RuntimeState } from "../runtime-state.js";

export interface RuntimeInfoToolOptions {
  getRuntimeState: () => RuntimeState;
}

export function createGetRuntimeInfoTool(options: RuntimeInfoToolOptions): Tool {
  return {
    name: "get_runtime_info",
    description: "Use when asked about system version, model, adapter, or capabilities. Returns Arcon runtime identity and capability status.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const state = options.getRuntimeState();

      return {
        success: true,
        toolName: "get_runtime_info",
        status: "success",
        output: {
          version: state.version,
          generatedAt: state.generatedAt,
          status: state.status,
          identity: state.identity,
          capabilities: state.capabilities.capabilities.map((cap: import("../runtime-capabilities.js").RuntimeCapability) => ({
            name: cap.name,
            status: cap.status,
            notes: cap.notes,
          })),
        },
        durationMs: 0,
      };
    },
  };
}
