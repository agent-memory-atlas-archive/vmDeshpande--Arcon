import type { ToolResult } from "./tool.js";

export function formatToolResults(results: ToolResult[]): string {
  if (results.length === 0) {
    return "";
  }

  const lines = results.map((result) => {
    const status = result.status.toUpperCase();
    const detail = result.success && result.output !== undefined
      ? JSON.stringify(result.output)
      : result.error ?? "No details";

    const codeLine = result.code ? ` [${result.code}]` : "";

    return `- ${result.toolName}${codeLine} [${status}]: ${detail}`;
  });

  return ["TOOL RESULTS:", ...lines, ""].join("\n");
}
