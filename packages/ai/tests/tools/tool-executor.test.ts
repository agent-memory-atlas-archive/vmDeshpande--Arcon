import { describe, it } from "node:test";
import assert from "node:assert";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { ToolExecutor } from "../../src/tools/tool-executor.js";
import { validateInput } from "../../src/tools/tool-validation.js";
import type { Tool } from "../../src/tools/tool.js";
import type { ToolResult } from "../../src/tools/tool.js";

function makeTool(name: string, inputSchema?: { type: "object"; properties: Record<string, { type: "string" | "number" | "boolean" | "integer" | "array" | "object" }>; required?: string[] }): Tool {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: inputSchema ?? { type: "object", properties: {} },
    async execute(_input: Record<string, unknown>): Promise<ToolResult> {
      return { success: true, toolName: name, status: "success", output: { done: true }, durationMs: 10 };
    },
  };
}

describe("ToolExecutor", () => {
  it("executes a registered tool successfully", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("test_tool"));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executor.execute("test_tool", {});

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.toolName, "test_tool");
    assert.strictEqual(result.status, "success");
    assert.strictEqual(result.durationMs, 10);
  });

  it("returns NOT_FOUND error for unknown tool", async () => {
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executor.execute("unknown_tool", {});

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, "error");
    assert.strictEqual(result.code, "NOT_FOUND");
    assert.ok(result.error?.includes("unknown_tool"));
  });

  it("returns VALIDATION_ERROR for invalid input", async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool("typed_tool", {
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
      }),
    );
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executor.execute("typed_tool", { count: "not_a_number" });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, "error");
    assert.strictEqual(result.code, "VALIDATION_ERROR");
    assert.ok(result.error?.includes("count"));
  });

  it("returns VALIDATION_ERROR for missing required field", async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool("required_tool", {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      }),
    );
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executor.execute("required_tool", {});

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR for unknown field", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("strict_tool", { type: "object", properties: { a: { type: "string" } } }));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executor.execute("strict_tool", { b: "extra" });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "VALIDATION_ERROR");
    assert.ok(result.error?.includes("b"));
  });

  it("returns TIMEOUT for slow tools", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "slow_tool",
      description: "Slow",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { success: true, toolName: "slow_tool", status: "success", durationMs: 200 };
      },
    });
    const executor = new ToolExecutor(registry, { defaultTimeoutMs: 50, logEnabled: false });

    const result = await executor.execute("slow_tool", {});

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, "timeout");
    assert.strictEqual(result.code, "TIMEOUT");
  });

  it("returns Cancelled when abort signal is triggered", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "cancel_tool",
      description: "Cancelable",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { success: true, toolName: "cancel_tool", status: "success", durationMs: 1000 };
      },
    });
    const executor = new ToolExecutor(registry, { defaultTimeoutMs: 5000, logEnabled: false });
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 30);

    const result = await executor.execute("cancel_tool", {}, controller.signal);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, "cancelled");
    assert.strictEqual(result.code, "CANCELLED");
  });

  it("handles tool execution errors gracefully", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "error_tool",
      description: "Errors",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        throw new Error("intentional failure");
      },
    });
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executor.execute("error_tool", {});

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, "error");
    assert.strictEqual(result.code, "EXECUTION_ERROR");
    assert.ok(result.error?.includes("intentional failure"));
  });

  it("executes tool with complex valid input", async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool("complex_tool", {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "integer" },
          enabled: { type: "boolean" },
          ratio: { type: "number" },
          tags: { type: "array" },
        },
        required: ["name", "count"],
      }),
    );
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executor.execute("complex_tool", {
      name: "test",
      count: 5,
      enabled: true,
      ratio: 1.5,
      tags: ["a", "b"],
    });

    assert.strictEqual(result.success, true);
  });

  it("rejects integer type as number", async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool("int_tool", {
        type: "object",
        properties: { age: { type: "integer" } },
        required: ["age"],
      }),
    );
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executor.execute("int_tool", { age: 3.14 });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "VALIDATION_ERROR");
  });
});

describe("validateInput", () => {
  it("accepts valid input", () => {
    const result = validateInput(
      {
        type: "object",
        properties: { name: { type: "string" }, age: { type: "integer" } },
        required: ["name"],
      },
      { name: "test", age: 30 },
    );

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it("rejects missing required field", () => {
    const result = validateInput(
      {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name", "age"],
      },
      { name: "test" },
    );

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("age")));
  });

  it("rejects wrong type", () => {
    const result = validateInput(
      {
        type: "object",
        properties: { count: { type: "number" } },
      },
      { count: "five" },
    );

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("count")));
  });

  it("rejects unknown field", () => {
    const result = validateInput(
      {
        type: "object",
        properties: { a: { type: "string" } },
      },
      { b: "extra" } as Record<string, unknown>,
    );

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("b")));
  });
});
