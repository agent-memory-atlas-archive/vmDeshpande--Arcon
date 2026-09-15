import type { Tool, ToolContext, ToolResult } from "./tool.js";

export interface GetCurrentTimeToolOptions {}

export function createGetCurrentTimeTool(_options: GetCurrentTimeToolOptions): Tool {
  return {
    name: "get_current_time",
    description: "Returns current local time, UTC time, date, timezone, and weekday.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const now = new Date();

      return {
        success: true,
        toolName: "get_current_time",
        status: "success",
        output: {
          localTime: now.toLocaleTimeString("en-US", { hour12: false }),
          utcTime: now.toISOString(),
          date: now.toLocaleDateString("en-US"),
          isoDate: now.toISOString().split("T")[0],
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
          dayOfWeek: now.getDay(),
          month: now.getMonth() + 1,
          day: now.getDate(),
          year: now.getFullYear(),
          hour: now.getHours(),
          minute: now.getMinutes(),
          second: now.getSeconds(),
        },
        durationMs: 0,
      };
    },
  };
}
