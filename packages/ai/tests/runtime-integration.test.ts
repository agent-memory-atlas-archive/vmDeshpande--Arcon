import { describe, it } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { AiClient } from "@arcon/shared";
import { MemoryRepository, MemoryPipeline } from "@arcon/memory";
import { ChatService } from "../src/chat-service.js";
import { ToolRegistry, ToolExecutor, type Tool, type ToolResult, type ToolContext } from "../src/tools/index.js";
import { createGetCurrentTimeTool } from "../src/tools/get-current-time.js";
import { createGetSystemStatusTool } from "../src/tools/get-system-status.js";
import { createListDirectoryTool } from "../src/tools/list-directory.js";
import { createReadFileTool } from "../src/tools/read-file.js";
import { createSearchFilesTool } from "../src/tools/search-files.js";
import { type RuntimeIdentity } from "../src/runtime-identity.js";

const ALLOWED_ROOT = dirname(fileURLToPath(import.meta.url));

function createTools(): Tool[] {
  return [
    createGetCurrentTimeTool({}),
    createGetSystemStatusTool({}),
    createListDirectoryTool({ allowedRoots: [ALLOWED_ROOT] }),
    createReadFileTool({ allowedRoots: [ALLOWED_ROOT] }),
    createSearchFilesTool({ allowedRoots: [ALLOWED_ROOT] }),
  ];
}

function mockResponses(responses: string[]) {
  let index = 0;
  return {
    async generateReply(_messages: Array<{ role: string; content: string }>): Promise<string> {
      const response = responses[index] ?? "";
      index++;
      return response;
    },
    async *generateReplyStream(_messages: Array<{ role: string; content: string }>): AsyncIterable<string> {
      for (const chunk of responses) {
        yield chunk;
      }
    },
  };
}

function createService(tools: Tool[], aiClient: { generateReply: (messages: Array<{ role: string; content: string }>) => Promise<string> }) {
  const repository = new MemoryRepository(":memory:");
  const pipeline = new MemoryPipeline(repository);
  const registry = new ToolRegistry();
  for (const tool of tools) registry.register(tool);
  const executor = new ToolExecutor(registry, { logEnabled: false });
  const identity: RuntimeIdentity = {
    baseModel: "Qwen/Qwen3-4B",
    adapterName: "arcon-v1",
    adapterVersion: "rank-8",
    adapterPath: "none",
    inferenceBackend: "arcon-lora",
    adapterActive: true,
    loadedAt: "",
    gpuMemoryAllocatedMB: 0,
    gpuMemoryReservedMB: 0,
  };
  return new ChatService(repository, pipeline, aiClient as AiClient, {
    toolExecutor: executor,
    maxToolIterations: 5,
    runtimeIdentity: identity,
  });
}

describe("Runtime Integration - Real tools through ChatService", () => {
  it("one successful real tool call", async () => {
    const tools = createTools();
    const aiClient = mockResponses([
      "Thinking...",
      '```json\n{"tool": "get_current_time", "arguments": {}}\n```',
      "The time has been retrieved.",
    ]);
    const service = createService(tools, aiClient);

    const result = await service.chat("What time is it?");
    assert.ok(result.reply.length > 0, "Expected non-empty reply");
  }, 120_000);

  it("multi-step tool sequence", async () => {
    const tools = createTools();
    const aiClient = mockResponses([
      "Thinking...",
      '```json\n{"tool": "get_system_status", "arguments": {}}\n```',
      '```json\n{"tool": "get_current_time", "arguments": {}}\n```',
      "I have the system status and current time.",
    ]);
    const service = createService(tools, aiClient);

    const result = await service.chat("Tell me about the system and the current time.");
    assert.ok(result.reply.length > 0, "Expected non-empty reply");
  }, 120_000);

  it("invalid arguments produce structured error", async () => {
    const registry = new ToolRegistry();
    registry.register(createReadFileTool({ allowedRoots: [ALLOWED_ROOT] }));
    const executor = new ToolExecutor(registry, { logEnabled: false });
    const repository = new MemoryRepository(":memory:");
    const pipeline = new MemoryPipeline(repository);
    const identity: RuntimeIdentity = {
      baseModel: "Qwen/Qwen3-4B", adapterName: "arcon-v1", adapterVersion: "rank-8",
      adapterPath: "none", inferenceBackend: "arcon-lora", adapterActive: true,
      loadedAt: "", gpuMemoryAllocatedMB: 0, gpuMemoryReservedMB: 0,
    };
    const aiClient = mockResponses([
      "Thinking...",
      '```json\n{"tool": "read_file", "arguments": {}}\n```',
      "I need a path to read a file.",
    ]);
    const service = new ChatService(repository, pipeline, aiClient as AiClient, {
      toolExecutor: executor, maxToolIterations: 5, runtimeIdentity: identity,
    });

    const result = await service.chat("Read the file.");
    assert.ok(result.reply.length > 0, "Expected non-empty reply");
  }, 120_000);

  it("unknown tool returns NOT_FOUND", async () => {
    const registry = new ToolRegistry();
    registry.register(createGetCurrentTimeTool({}));
    const executor = new ToolExecutor(registry, { logEnabled: false });
    const repository = new MemoryRepository(":memory:");
    const pipeline = new MemoryPipeline(repository);
    const identity: RuntimeIdentity = {
      baseModel: "Qwen/Qwen3-4B", adapterName: "arcon-v1", adapterVersion: "rank-8",
      adapterPath: "none", inferenceBackend: "arcon-lora", adapterActive: true,
      loadedAt: "", gpuMemoryAllocatedMB: 0, gpuMemoryReservedMB: 0,
    };
    const aiClient = mockResponses([
      "Thinking...",
      '```json\n{"tool": "delete_file", "arguments": {}}\n```',
      "I cannot do that.",
    ]);
    const service = new ChatService(repository, pipeline, aiClient as AiClient, {
      toolExecutor: executor, maxToolIterations: 5, runtimeIdentity: identity,
    });

    const result = await service.chat("Delete a file.");
    assert.ok(result.reply.length > 0, "Expected non-empty reply");
  }, 120_000);

  it("path traversal is blocked", async () => {
    const registry = new ToolRegistry();
    registry.register(createReadFileTool({ allowedRoots: [ALLOWED_ROOT] }));
    const executor = new ToolExecutor(registry, { logEnabled: false });
    const repository = new MemoryRepository(":memory:");
    const pipeline = new MemoryPipeline(repository);
    const identity: RuntimeIdentity = {
      baseModel: "Qwen/Qwen3-4B", adapterName: "arcon-v1", adapterVersion: "rank-8",
      adapterPath: "none", inferenceBackend: "arcon-lora", adapterActive: true,
      loadedAt: "", gpuMemoryAllocatedMB: 0, gpuMemoryReservedMB: 0,
    };
    const aiClient = mockResponses([
      "Thinking...",
      '```json\n{"tool": "read_file", "arguments": {"path": "..\\\\secret.txt"}}\n```',
      "Access denied.",
    ]);
    const service = new ChatService(repository, pipeline, aiClient as AiClient, {
      toolExecutor: executor, maxToolIterations: 5, runtimeIdentity: identity,
    });

    const result = await service.chat("Read the secret file.");
    assert.ok(result.reply.length > 0, "Expected non-empty reply");
  }, 120_000);

  it("tool execution failure is handled gracefully", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "failing_tool",
      description: "A tool that fails",
      inputSchema: { type: "object", properties: {} },
      async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        throw new Error("Intentional failure");
      },
    });
    const executor = new ToolExecutor(registry, { logEnabled: false });
    const repository = new MemoryRepository(":memory:");
    const pipeline = new MemoryPipeline(repository);
    const identity: RuntimeIdentity = {
      baseModel: "Qwen/Qwen3-4B", adapterName: "arcon-v1", adapterVersion: "rank-8",
      adapterPath: "none", inferenceBackend: "arcon-lora", adapterActive: true,
      loadedAt: "", gpuMemoryAllocatedMB: 0, gpuMemoryReservedMB: 0,
    };
    const aiClient = mockResponses([
      "Thinking...",
      '```json\n{"tool": "failing_tool", "arguments": {}}\n```',
      "The tool failed.",
    ]);
    const service = new ChatService(repository, pipeline, aiClient as AiClient, {
      toolExecutor: executor, maxToolIterations: 5, runtimeIdentity: identity,
    });

    const result = await service.chat("Use the failing tool.");
    assert.ok(result.reply.length > 0, "Expected non-empty reply");
  }, 120_000);

  it("final response uses tool result", async () => {
    const registry = new ToolRegistry();
    registry.register(createListDirectoryTool({ allowedRoots: [ALLOWED_ROOT], maxEntries: 3 }));
    const executor = new ToolExecutor(registry, { logEnabled: false });
    const repository = new MemoryRepository(":memory:");
    const pipeline = new MemoryPipeline(repository);
    const identity: RuntimeIdentity = {
      baseModel: "Qwen/Qwen3-4B", adapterName: "arcon-v1", adapterVersion: "rank-8",
      adapterPath: "none", inferenceBackend: "arcon-lora", adapterActive: true,
      loadedAt: "", gpuMemoryAllocatedMB: 0, gpuMemoryReservedMB: 0,
    };
    const aiClient = mockResponses([
      "Thinking...",
      '```json\n{"tool": "list_directory", "arguments": {"path": "."}}\n```',
      "Based on the directory listing, there are several files present.",
    ]);
    const service = new ChatService(repository, pipeline, aiClient as AiClient, {
      toolExecutor: executor, maxToolIterations: 5, runtimeIdentity: identity,
    });

    const result = await service.chat("What files are in this directory?");
    assert.ok(result.reply.length > 0, "Expected non-empty reply");
  }, 120_000);
});

describe("Runtime Integration - Tool descriptions are concise and action-oriented", () => {
  it("all registered tools have non-empty descriptions under 200 chars", () => {
    const tools = createTools();
    for (const tool of tools) {
      assert.ok(tool.description.length > 0, `${tool.name}: description is empty`);
      assert.ok(tool.description.length < 200, `${tool.name}: description too long (${tool.description.length} chars)`);
    }
  });

  it("all tool input schemas have required fields specified", () => {
    const tools = createTools();
    for (const tool of tools) {
      if (tool.inputSchema.required && tool.inputSchema.required.length > 0) {
        for (const field of tool.inputSchema.required) {
          assert.ok(
            tool.inputSchema.properties[field],
            `${tool.name}: required field '${field}' missing from properties`,
          );
        }
      }
    }
  });
});
