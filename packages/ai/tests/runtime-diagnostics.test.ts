import { describe, it } from "node:test";
import assert from "node:assert";
import { formatDiagnostics, getRuntimeDiagnostics } from "../src/runtime-diagnostics.js";
import type { ToolRegistryLike } from "../tools/tool-call.js";
import type { RuntimeIdentity } from "../runtime-identity.js";

describe("formatDiagnostics", () => {
  it("formats basic diagnostics", async () => {
    const diag = await getRuntimeDiagnostics({});
    const formatted = formatDiagnostics(diag);
    assert.ok(formatted.includes("=== Arcon Runtime Diagnostics ==="));
    assert.ok(formatted.includes("Timestamp:"));
    assert.ok(formatted.includes("Tool Loop Stats:"));
  });

  it("includes error stats in formatted output", async () => {
    const diag = await getRuntimeDiagnostics({
      totalToolErrors: 3,
      totalValidationErrors: 1,
      totalTimeouts: 2,
    });
    const formatted = formatDiagnostics(diag);
    assert.ok(formatted.includes("errors=3"), `Expected errors=3 in: ${formatted}`);
    assert.ok(formatted.includes("validationErrors=1"), `Expected validationErrors=1 in: ${formatted}`);
    assert.ok(formatted.includes("timeouts=2"), `Expected timeouts=2 in: ${formatted}`);
  });

  it("includes tool stats when provided", async () => {
    const diag = await getRuntimeDiagnostics({
      toolStats: [{ name: "get_time", calls: 5, errors: 0, lastLatencyMs: 10 }],
    });
    const formatted = formatDiagnostics(diag);
    assert.ok(formatted.includes("get_time"), `Expected tool name in output: ${formatted}`);
  });

  it("shows not available for missing model identity", async () => {
    const diag = await getRuntimeDiagnostics({});
    const formatted = formatDiagnostics(diag);
    assert.ok(formatted.includes("Not available"));
  });

  it("shows registered tools", async () => {
    const diag = await getRuntimeDiagnostics({
      registeredTools: [
        { name: "get_time", description: "Get current time", requiredArgs: [] },
        { name: "read_file", description: "Read a file", requiredArgs: ["path"] },
      ],
    });
    const formatted = formatDiagnostics(diag);
    assert.ok(formatted.includes("get_time"));
    assert.ok(formatted.includes("read_file"));
    assert.ok(formatted.includes("path"));
  });

  it("shows no tools section for empty registry", async () => {
    const diag = await getRuntimeDiagnostics({ registeredTools: [] });
    const formatted = formatDiagnostics(diag);
    assert.ok(formatted.includes("Registered Tools (0):"));
  });
});

describe("getRuntimeDiagnostics", () => {
  it("returns default values for empty options", async () => {
    const diag = await getRuntimeDiagnostics({});
    assert.strictEqual(diag.totalToolCallsExecuted, 0);
    assert.strictEqual(diag.totalToolErrors, 0);
    assert.strictEqual(diag.totalValidationErrors, 0);
    assert.strictEqual(diag.totalTimeouts, 0);
    assert.strictEqual(diag.toolCallingEnabled, false);
    assert.strictEqual(diag.toolExecutorConfigured, false);
    assert.ok(diag.timestamp);
  });

  it("accepts all new diagnostic fields", async () => {
    const registry: ToolRegistryLike = {
      get: () => undefined,
      list: () => [],
    };
    const identity: RuntimeIdentity = {
      baseModel: "Qwen/Qwen3-4B",
      adapterName: "arcon-v1",
      adapterVersion: "rank-8",
      adapterPath: "none",
      inferenceBackend: "arcon-lora",
      adapterActive: true,
      loadedAt: "2026-01-01",
      gpuMemoryAllocatedMB: 0,
      gpuMemoryReservedMB: 0,
    };

    const diag = await getRuntimeDiagnostics({
      registry,
      runtimeIdentity: identity,
      lastToolLoopIterations: 10,
      lastToolLoopLatencyMs: 500,
      lastResponseLatencyMs: 200,
      totalToolCallsExecuted: 15,
      totalToolErrors: 2,
      totalValidationErrors: 1,
      totalTimeouts: 1,
      toolStats: [{ name: "get_time", calls: 10, errors: 0, lastLatencyMs: 5 }],
    });

    assert.strictEqual(diag.lastToolLoopIterations, 10);
    assert.strictEqual(diag.totalToolErrors, 2);
    assert.strictEqual(diag.totalValidationErrors, 1);
    assert.strictEqual(diag.totalTimeouts, 1);
    assert.strictEqual(diag.toolStats?.length, 1);
    assert.strictEqual(diag.toolStats![0].name, "get_time");
  });
});
