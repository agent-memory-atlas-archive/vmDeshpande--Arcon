import { describe, it } from "node:test";
import assert from "node:assert";
import { formatToolResults } from "../../src/tools/tool-result-formatter.js";
import type { ToolResult } from "../../src/tools/tool.js";

describe("formatToolResults", () => {
  it("returns empty string for empty array", () => {
    const result = formatToolResults([]);
    assert.strictEqual(result, "");
  });

  it("formats a single successful result", () => {
    const results: ToolResult[] = [
      {
        success: true,
        toolName: "get_runtime_info",
        status: "success",
        output: { version: "0.1.0" },
        durationMs: 5,
      },
    ];

    const result = formatToolResults(results);

    assert.ok(result.includes("TOOL RESULTS:"));
    assert.ok(result.includes("get_runtime_info"));
    assert.ok(result.includes("SUCCESS"));
    assert.ok(result.includes('"version":"0.1.0"'));
  });

  it("formats a failed result with error", () => {
    const results: ToolResult[] = [
      {
        success: false,
        toolName: "unknown_tool",
        status: "error",
        error: "Tool not found",
        code: "NOT_FOUND",
        durationMs: 0,
      },
    ];

    const result = formatToolResults(results);

    assert.ok(result.includes("unknown_tool"));
    assert.ok(result.includes("ERROR"));
    assert.ok(result.includes("Tool not found"));
    assert.ok(result.includes("NOT_FOUND"));
  });

  it("formats timeout result", () => {
    const results: ToolResult[] = [
      {
        success: false,
        toolName: "slow_tool",
        status: "timeout",
        error: "timed out",
        code: "TIMEOUT",
        durationMs: 5000,
      },
    ];

    const result = formatToolResults(results);

    assert.ok(result.includes("slow_tool"));
    assert.ok(result.includes("TIMEOUT"));
  });

  it("formats cancellation result", () => {
    const results: ToolResult[] = [
      {
        success: false,
        toolName: "cancel_tool",
        status: "cancelled",
        error: "cancelled",
        code: "CANCELLED",
        durationMs: 0,
      },
    ];

    const result = formatToolResults(results);

    assert.ok(result.includes("cancel_tool"));
    assert.ok(result.includes("CANCELLED"));
  });

  it("formats multiple results", () => {
    const results: ToolResult[] = [
      {
        success: true,
        toolName: "tool_a",
        status: "success",
        output: { done: true },
        durationMs: 3,
      },
      {
        success: false,
        toolName: "tool_b",
        status: "error",
        error: "failure",
        code: "EXECUTION_ERROR",
        durationMs: 1,
      },
    ];

    const result = formatToolResults(results);

    assert.ok(result.includes("tool_a"));
    assert.ok(result.includes("tool_b"));
    assert.ok(result.includes("SUCCESS"));
    assert.ok(result.includes("ERROR"));
    assert.ok(result.includes('"done":true'));
    assert.ok(result.includes("failure"));
  });

  it("uses 'No details' when error is undefined", () => {
    const results: ToolResult[] = [
      {
        success: false,
        toolName: "mystery",
        status: "error",
        durationMs: 0,
      },
    ];

    const result = formatToolResults(results);

    assert.ok(result.includes("No details"));
  });
});
