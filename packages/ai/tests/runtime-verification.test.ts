import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ArconLoRAProvider,
  createArconLoRAProvider,
} from "../src/inference/arcon-lora-provider.js";
import {
  parseToolCall,
  executeToolLoop,
  ToolRegistry,
  ToolExecutor,
  describeAllTools,
  type Tool,
  type ToolResult,
  type ToolContext,
} from "../src/tools/index.js";

const BASE_URL = "http://localhost:8000";

function createRealProvider(): ArconLoRAProvider {
  return createArconLoRAProvider({ baseUrl: BASE_URL, timeoutMs: 180_000 });
}

function makeTool(name: string, inputSchema?: { type: "object"; properties: Record<string, { type: string }>; required?: string[] }): Tool {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: inputSchema ?? { type: "object", properties: {} },
    async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      return { success: true, toolName: name, status: "success", output: { done: true }, durationMs: 0 };
    },
  };
}

describe("Runtime Verification - Provider Health", () => {
  it("healthCheck returns true when server is running", async () => {
    const provider = createRealProvider();
    const healthy = await provider.healthCheck();
    assert.strictEqual(healthy, true, "Expected healthCheck to return true");
  });
});

describe("Runtime Verification - Basic Inference", () => {
  it("generateReply returns a non-empty response", async () => {
    const provider = createRealProvider();
    const reply = await provider.generateReply([{ role: "user", content: "Hi" }]);
    assert.ok(reply, "Expected non-empty reply");
    assert.ok(reply.length > 1, "Expected reply longer than 1 character");
  }, 120_000);
});

describe("Runtime Verification - Model Info", () => {
  it("getModelInfo returns correct base model and adapter info", async () => {
    const provider = createRealProvider();
    const info = await provider.getModelInfo();
    assert.strictEqual(info.base_model, "Qwen/Qwen3-4B", "Wrong base model");
    assert.strictEqual(info.adapter_name, "arcon-v1", "Wrong adapter name");
    assert.ok(info.adapter_version !== "unknown", "Adapter version should be known");
    assert.strictEqual(info.inference_backend, "PEFT/Transformers");
  }, 120_000);
});

describe("Runtime Verification - Runtime Identity", () => {
  it("getRuntimeIdentity returns valid identity", async () => {
    const provider = createRealProvider();
    const identity = await provider.getRuntimeIdentity();
    assert.strictEqual(identity.baseModel, "Qwen/Qwen3-4B");
    assert.strictEqual(identity.adapterName, "arcon-v1");
    assert.ok(identity.adapterActive, "Adapter should be active");
    assert.strictEqual(identity.inferenceBackend, "arcon-lora");
  });

  it("isAdapterActive returns true", async () => {
    const provider = createRealProvider();
    const active = await provider.isAdapterActive();
    assert.strictEqual(active, true);
  });
});

describe("Runtime Verification - Tool Call Detection", () => {
  it("parseToolCall detects valid tool call from model-style response", () => {
    const response = 'I\'ll look that up for you. ```json\n{"tool": "get_current_time", "arguments": {}}\n```';
    const result = parseToolCall(response);
    assert.ok(result.toolCall, "Expected tool call to be detected");
    assert.strictEqual(result.toolCall!.toolName, "get_current_time");
    assert.deepStrictEqual(result.toolCall!.arguments, {});
    assert.strictEqual(result.finalReply, undefined);
  });

  it("parseToolCall returns finalReply when no tool call present", () => {
    const response = "The current time is 2:30 PM.";
    const result = parseToolCall(response);
    assert.strictEqual(result.finalReply, "The current time is 2:30 PM.");
    assert.strictEqual(result.toolCall, undefined);
  });
});

describe("Runtime Verification - Tool Execution Loop", () => {
  it("executes tool call from simulated model response with real tools", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("get_current_time"));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executeToolLoop({
      getModelResponse: async (_messages) => {
        if (_messages.length <= 1) {
          return '```json\n{"tool": "get_current_time", "arguments": {}}\n```';
        }
        return "The current time has been retrieved.";
      },
      executor,
      registry,
      maxIterations: 3,
    });

    assert.strictEqual(result.toolCallsMade, 1);
    assert.strictEqual(result.toolResults.length, 1);
    assert.strictEqual(result.toolResults[0].success, true);
    assert.strictEqual(result.toolResults[0].toolName, "get_current_time");
    assert.strictEqual(result.iterationLimitReached, false);
    assert.ok(result.finalReply, "Expected final reply");
  });

  it("handles unknown tool in model response", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("get_current_time"));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executeToolLoop({
      getModelResponse: async (_messages) => {
        if (_messages.length <= 1) {
          return '```json\n{"tool": "unknown_tool", "arguments": {}}\n```';
        }
        return "I tried looking that up but could not find the tool.";
      },
      executor,
      registry,
      maxIterations: 3,
    });

    assert.strictEqual(result.toolCallsMade, 1);
    assert.strictEqual(result.toolResults[0].success, false);
    assert.strictEqual(result.toolResults[0].code, "NOT_FOUND");
  });
});
