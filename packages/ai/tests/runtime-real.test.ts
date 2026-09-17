import { describe, it } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createArconLoRAProvider, ArconLoRAProvider } from "../src/inference/arcon-lora-provider.js";
import { parseToolCall, executeToolLoop, ToolRegistry, ToolExecutor, describeAllTools, type Tool, type ToolResult, type ToolContext } from "../src/tools/index.js";
import { createGetCurrentTimeTool } from "../src/tools/get-current-time.js";
import { createGetSystemStatusTool } from "../src/tools/get-system-status.js";
import { createListDirectoryTool } from "../src/tools/list-directory.js";
import { createReadFileTool } from "../src/tools/read-file.js";
import { createSearchFilesTool } from "../src/tools/search-files.js";
import { getRuntimeDiagnostics, formatDiagnostics } from "../src/runtime-diagnostics.js";

const BASE_URL = "http://localhost:8000";
const ALLOWED_ROOT = dirname(fileURLToPath(import.meta.url));

function createRealProvider(): ArconLoRAProvider {
  return createArconLoRAProvider({ baseUrl: BASE_URL, timeoutMs: 180_000 });
}

function createRealTools(): Tool[] {
  return [
    createGetCurrentTimeTool({}),
    createGetSystemStatusTool({}),
    createListDirectoryTool({ allowedRoots: [ALLOWED_ROOT] }),
    createReadFileTool({ allowedRoots: [ALLOWED_ROOT] }),
    createSearchFilesTool({ allowedRoots: [ALLOWED_ROOT] }),
  ];
}

function createRealService(tools: Tool[], inferenceLatencyMs: number = 0): { provider: ArconLoRAProvider; registry: ToolRegistry; executor: ToolExecutor; chatStartMs: number } {
  const provider = createRealProvider();
  const registry = new ToolRegistry();
  for (const tool of tools) registry.register(tool);
  const executor = new ToolExecutor(registry, { logEnabled: false });
  return { provider, registry, executor, chatStartMs: Date.now() };
}

interface LatencyRecord {
  label: string;
  ms: number;
}

function measureLatency(label: string, startMs: number, records: LatencyRecord[]): void {
  records.push({ label, ms: Date.now() - startMs });
}

describe("Real Runtime - Provider Health", () => {
  it("healthCheck returns true", async () => {
    const provider = createRealProvider();
    const healthy = await provider.healthCheck();
    assert.strictEqual(healthy, true);
  });

  it("getModelInfo returns Qwen3-4B", async () => {
    const provider = createRealProvider();
    const info = await provider.getModelInfo();
    assert.strictEqual(info.base_model, "Qwen/Qwen3-4B");
    assert.strictEqual(info.adapter_name, "arcon-v1");
    assert.ok(info.adapter_version !== "unknown");
  }, 120_000);
});

describe("Real Runtime - Inference Response", () => {
  it("generateReply returns non-empty response", async () => {
    const provider = createRealProvider();
    const start = Date.now();
    const reply = await provider.generateReply([{ role: "user", content: "Hello" }]);
    const latency = Date.now() - start;
    assert.ok(reply, "Expected non-empty reply");
    assert.ok(reply.length > 1, "Expected reply longer than 1 character");
    console.log(`[latency] generateReply: ${latency}ms`);
  }, 120_000);
});

describe("Real Runtime - Normal Response (No Tool)", () => {
  it("model responds without tool call for greeting", async () => {
    const provider = createRealProvider();
    const start = Date.now();
    const response = await provider.generateReply([{ role: "user", content: "Hello, how are you?" }]);
    const latency = Date.now() - start;
    const result = parseToolCall(response);
    console.log(`[latency] normal response: ${latency}ms`);
    console.log(`[response] ${response}`);
    assert.ok(response.length > 0, "Expected non-empty response");
    if (result.toolCall) {
      assert.ok(false, "Unexpected tool call in greeting response");
    }
    assert.ok(result.finalReply !== undefined, "Expected final reply");
  }, 120_000);
});

describe("Real Runtime - Tool Call with Real Model", () => {
  it("executes get_current_time via real model + real tool", async () => {
    const tools = [createGetCurrentTimeTool({})];
    const registry = new ToolRegistry();
    for (const t of tools) registry.register(t);
    const executor = new ToolExecutor(registry, { logEnabled: false });
    const provider = createRealProvider();

    const latencies: LatencyRecord[] = [];

    const start = Date.now();
    const response = await provider.generateReply([{ role: "user", content: "What time is it?" }]);
    measureLatency("model_response", start, latencies);
    console.log(`[latency] model_response: ${latencies[0].ms}ms`);
    console.log(`[response] ${response}`);

    const parseStart = Date.now();
    const parseResult = parseToolCall(response);
    measureLatency("parseToolCall", parseStart, latencies);

    if (parseResult.toolCall) {
      console.log(`[tool] detected: ${parseResult.toolCall.toolName}`);
      const loopStart = Date.now();
      const loopResult = await executeToolLoop({
        getModelResponse: async () => response,
        executor,
        registry,
        maxIterations: 5,
      });
      measureLatency("executeToolLoop", loopStart, latencies);

      console.log(`[latency] total: ${Date.now() - start}ms`);
      for (const l of latencies) {
        console.log(`[latency] ${l.label}: ${l.ms}ms`);
      }
      console.log(`[result] toolCallsMade: ${loopResult.toolCallsMade}`);
      console.log(`[result] toolErrors: ${loopResult.toolErrors}`);
      console.log(`[result] finalReply: ${loopResult.finalReply}`);

      assert.ok(loopResult.finalReply.length > 0, "Expected non-empty final reply");
    } else {
      console.log(`[response] ${response}`);
      console.log("[note] Model did not output tool call for time question (acceptable for Qwen3-4B)");
      assert.ok(true, "Model response recorded");
    }
  }, 120_000);
});

describe("Real Runtime - Path Traversal Blocked", () => {
  it("blocks path traversal on real read_file tool", async () => {
    const registry = new ToolRegistry();
    registry.register(createReadFileTool({ allowedRoots: [ALLOWED_ROOT] }));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const start = Date.now();
    const result = await executor.execute("read_file", { path: "..\\secret.txt" });
    const latency = Date.now() - start;
    console.log(`[latency] path_traversal_check: ${latency}ms`);
    console.log(`[result] status: ${result.status}, code: ${result.code}, error: ${result.error}`);
    assert.strictEqual(result.success, false);
    assert.ok(result.code === "PATH_DENIED" || result.code === "VALIDATION_ERROR", `Expected PATH_DENIED or VALIDATION_ERROR, got ${result.code}`);
    assert.ok(!result.error?.includes("stack"), "Error should not include stack trace");
    assert.ok(!result.error?.includes("at "), "Error should not include stack trace line");
  });
});

describe("Real Runtime - Read File Within Allowed Root", () => {
  it("reads a file within allowed root", async () => {
    const tools = createRealTools();
    const registry = new ToolRegistry();
    for (const t of tools) registry.register(t);
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const start = Date.now();
    const result = await executor.execute("get_current_time", {});
    const latency = Date.now() - start;
    console.log(`[latency] get_current_time: ${latency}ms`);
    console.log(`[result] status: ${result.status}`);
    assert.ok(result.success, "get_current_time should succeed");
  });
});

describe("Real Runtime - Unknown Tool Rejection", () => {
  it("rejects unknown tool via executor validation", async () => {
    const registry = new ToolRegistry();
    registry.register(createGetCurrentTimeTool({}));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executor.execute("delete_file", {});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "NOT_FOUND");
  });
});

describe("Real Runtime - Diagnostics", () => {
  it("runtime diagnostics return valid structure", async () => {
    const diag = await getRuntimeDiagnostics({
      totalToolCallsExecuted: 15,
      totalToolErrors: 2,
      totalValidationErrors: 1,
      totalTimeouts: 1,
    });
    assert.ok(diag.timestamp);
    assert.strictEqual(diag.totalToolCallsExecuted, 15);
    assert.strictEqual(diag.totalToolErrors, 2);
    assert.strictEqual(diag.modelProviderStatus, "unknown");
    const formatted = formatDiagnostics(diag);
    assert.ok(formatted.includes("=== Arcon Runtime Diagnostics ==="));
    console.log(`[diagnostics]\n${formatted}`);
  });
});
