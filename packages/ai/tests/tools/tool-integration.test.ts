import { describe, it } from "node:test";
import assert from "node:assert";
import { MemoryPipeline, MemoryRepository } from "@arcon/memory";
import { PromptBuilder } from "../../src/prompt-builder.js";
import { ToolExecutor, ToolRegistry, createGetRuntimeInfoTool } from "../../src/tools/index.js";
import type { ToolResult } from "../../src/tools/tool.js";

function createService() {
  const repository = new MemoryRepository(":memory:");
  const pipeline = new MemoryPipeline(repository);
  const registry = new ToolRegistry();
  registry.register(createGetRuntimeInfoTool({
    getRuntimeState: () => ({
      version: "0.2.0",
      generatedAt: "2026-09-15",
      status: "ready",
      identity: {
        baseModel: "Qwen/Qwen3-4B",
        adapterName: "arcon-v1",
        adapterVersion: "rank-8",
        adapterPath: "none",
        inferenceBackend: "arcon-lora",
        adapterActive: false,
        loadedAt: "",
        gpuMemoryAllocatedMB: 0,
        gpuMemoryReservedMB: 0,
      },
      capabilities: {
        version: "0.2.0",
        generatedAt: "2026-09-15",
        capabilities: [{ name: "test", status: "IMPLEMENTED", notes: "ok" }],
      },
    }),
  }));
  const executor = new ToolExecutor(registry, { logEnabled: false });
  return { executor, registry };
}

describe("Tool integration: executor + prompt", () => {
  it("executes tool and includes result in prompt", async () => {
    const { executor } = createService();

    const result = await executor.execute("get_runtime_info", {});

    assert.strictEqual(result.success, true);

    const prompt = new PromptBuilder().build({
      systemPrompt: "You are Arcon.",
      context: {
        understanding: {
          intent: "GENERAL",
          subject: "general",
          topic: null,
          requiresMemory: false,
          requiresEmotion: false,
          requiresInterests: false,
          requiresIdentity: false,
          requiresProjects: false,
          requiresConversation: false,
          requiresArconState: false,
          isQuestion: true,
          isAmbiguous: false,
          confidence: 0.8,
        },
        memories: [],
        includeUserProfile: false,
        includeArconIdentity: false,
        includeEmotionState: false,
        includeInterests: false,
        includeProjects: false,
        includeRecentConversation: false,
        includeRelevantPastConversations: false,
        maxConversationTurns: 6,
        maxPastConversations: 1,
        maxMemories: 5,
        selectedTopics: [],
        excludedTopics: [],
      },
      snapshot: undefined,
      conversationHistory: [],
      userMessage: "What is the runtime status?",
      toolResults: [result],
    });

    assert.ok(prompt.includes("TOOL RESULTS:"));
    assert.ok(prompt.includes("get_runtime_info"));
    assert.ok(prompt.includes("SUCCESS"));
    assert.ok(prompt.includes("Qwen/Qwen3-4B"));
  });

  it("does not include TOOL RESULTS section when no results provided", () => {
    const prompt = new PromptBuilder().build({
      systemPrompt: "You are Arcon.",
      context: {
        understanding: {
          intent: "GENERAL",
          subject: "general",
          topic: null,
          requiresMemory: false,
          requiresEmotion: false,
          requiresInterests: false,
          requiresIdentity: false,
          requiresProjects: false,
          requiresConversation: false,
          requiresArconState: false,
          isQuestion: true,
          isAmbiguous: false,
          confidence: 0.8,
        },
        memories: [],
        includeUserProfile: false,
        includeArconIdentity: false,
        includeEmotionState: false,
        includeInterests: false,
        includeProjects: false,
        includeRecentConversation: false,
        includeRelevantPastConversations: false,
        maxConversationTurns: 6,
        maxPastConversations: 1,
        maxMemories: 5,
        selectedTopics: [],
        excludedTopics: [],
      },
      conversationHistory: [],
      userMessage: "Hello",
    });

    assert.strictEqual(prompt.includes("TOOL RESULTS:"), false);
  });
});

describe("Tool integration: ChatService.executeTool", () => {
  it("executes tool through ChatService and returns result", async () => {
    const { executor } = createService();

    const result = await executor.execute("get_runtime_info", {});

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.toolName, "get_runtime_info");
    assert.strictEqual(result.status, "success");
    assert.ok(result.output);
  });

  it("handles unknown tool through executor", async () => {
    const { executor } = createService();

    const result = await executor.execute("nonexistent", {});

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "NOT_FOUND");
  });

  it("formats result for LLM context", async () => {
    const { executor } = createService();

    const toolResult = await executor.execute("get_runtime_info", {});
    const formatter = await import("../../src/tools/tool-result-formatter.js");
    const formatted = formatter.formatToolResults([toolResult]);

    assert.ok(formatted.includes("TOOL RESULTS:"));
    assert.ok(formatted.includes("get_runtime_info"));
  });
});
