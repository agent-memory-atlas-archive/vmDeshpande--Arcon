import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ToolRegistry,
  ToolExecutor,
  parseToolCall,
  executeToolLoop,
  describeAllTools,
  type Tool,
  type ToolResult,
  type ToolContext,
} from "../src/tools/index.js";

function makeTool(name: string, inputSchema?: { type: "object"; properties: Record<string, { type: string }>; required?: string[] }): Tool {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: inputSchema ?? { type: "object", properties: {} },
    async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      return { success: true, toolName: name, status: "success", output: { done: true }, durationMs: 10 };
    },
  };
}

function makeToolWithResult(name: string, result: ToolResult): Tool {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: "object", properties: {} },
    async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      return result;
    },
  };
}

function makeStreamingAiClient(chunks: string[]): { generateReply: (messages: Array<{ role: string; content: string }>) => Promise<string>; generateReplyStream: (messages: Array<{ role: string; content: string }>) => AsyncIterable<string> } {
  return {
    async generateReply(_messages: Array<{ role: string; content: string }>): Promise<string> {
      return chunks.join("");
    },
    async *generateReplyStream(_messages: Array<{ role: string; content: string }>): AsyncIterable<string> {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function createLoopInput(
  responses: string[],
  tools: Tool[],
  options: { initialMessages?: { role: string; content: string }[]; maxIterations?: number } = {},
): { getModelResponse: (messages: { role: string; content: string }[]) => Promise<string>; executor: ToolExecutor; registry: ToolRegistry; maxIterations: number } {
  let index = 0;
  const registry = new ToolRegistry();
  for (const tool of tools) {
    registry.register(tool);
  }
  const executor = new ToolExecutor(registry, { logEnabled: false });
  const getModelResponse = async (messages: { role: string; content: string }[]): Promise<string> => {
    const response = responses[index] ?? "";
    index++;
    return response;
  };
  return {
    getModelResponse,
    executor,
    registry,
    maxIterations: options.maxIterations ?? 5,
  };
}

describe("parseToolCall", () => {
  it("parses a valid tool call from a JSON code block", () => {
    const response = 'Here is the tool call: ```json\n{"tool": "get_current_time", "arguments": {}}\n```';
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "get_current_time");
    assert.deepStrictEqual(result.toolCall!.arguments, {});
    assert.strictEqual(result.finalReply, undefined);
  });

  it("parses a tool call with arguments", () => {
    const response = '```json\n{"tool": "search_files", "arguments": {"query": "test", "path": "/data"}}\n```';
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "search_files");
    assert.strictEqual(result.toolCall!.arguments.query, "test");
  });

  it("accepts toolName as field name", () => {
    const response = '```json\n{"toolName": "get_time", "arguments": {}}\n```';
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "get_time");
  });

  it("returns final reply for plain text without tool call", () => {
    const response = "Hello, how can I help you?";
    const result = parseToolCall(response);

    assert.strictEqual(result.finalReply, "Hello, how can I help you?");
    assert.strictEqual(result.toolCall, undefined);
  });

  it("returns final reply for malformed JSON", () => {
    const response = '```json\n{not valid json}\n```';
    const result = parseToolCall(response);

    assert.ok(result.finalReply);
    assert.strictEqual(result.toolCall, undefined);
  });

  it("returns final reply for JSON without tool field", () => {
    const response = '```json\n{"action": "do_something", "arguments": {}}\n```';
    const result = parseToolCall(response);

    assert.ok(result.finalReply);
    assert.strictEqual(result.toolCall, undefined);
  });

  it("returns final reply for tool call with non-object arguments", () => {
    const response = '```json\n{"tool": "get_time", "arguments": "bad"}\n```';
    const result = parseToolCall(response);

    assert.ok(result.finalReply);
    assert.strictEqual(result.toolCall, undefined);
  });

  it("returns final reply for array arguments", () => {
    const response = '```json\n{"tool": "get_time", "arguments": []}\n```';
    const result = parseToolCall(response);

    assert.ok(result.finalReply);
    assert.strictEqual(result.toolCall, undefined);
  });

  it("handles empty response", () => {
    const result = parseToolCall("");

    assert.strictEqual(result.finalReply, "");
  });

  it("handles markdown code block without json language tag", () => {
    const response = '```\n{"tool": "get_time", "arguments": {}}\n```';
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "get_time");
  });
});

describe("parseToolCall - plain JSON fallback", () => {
  it("parses a tool call from plain JSON without code block", () => {
    const response = '{"tool": "get_time", "arguments": {}}';
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "get_time");
    assert.strictEqual(result.finalReply, undefined);
  });

  it("parses a tool call from JSON with toolName field", () => {
    const response = '{"toolName": "get_time", "arguments": {"tz": "utc"}}';
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "get_time");
    assert.deepStrictEqual(result.toolCall!.arguments, { tz: "utc" });
  });

  it("handles JSON with nested braces in string values", () => {
    const response = '{"tool": "read_file", "arguments": {"path": "file {not a brace}.txt"}}';
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "read_file");
    assert.strictEqual(result.toolCall!.arguments.path, "file {not a brace}.txt");
  });

  it("handles response with text before code block", () => {
    const response = "I'll check that for you.\n```json\n{\"tool\": \"get_current_time\", \"arguments\": {}}\n```";
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "get_current_time");
  });

  it("handles response with text after code block", () => {
    const response = '```json\n{"tool": "get_current_time", "arguments": {}}\n```\nHere is the result.';
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "get_current_time");
  });

  it("handles multiple code blocks by finding first valid tool JSON", () => {
    const response = 'Some text\n```json\n{"action": "skip"}\n```\n```json\n{"tool": "get_time", "arguments": {}}\n```\nMore text';
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "get_time");
  });

  it("returns final reply for JSON without tool/toolName field", () => {
    const response = '{"action": "do_something", "arguments": {}}';
    const result = parseToolCall(response);

    assert.ok(result.finalReply);
    assert.strictEqual(result.toolCall, undefined);
  });

  it("returns final reply for tool call with non-string tool name", () => {
    const response = '{"tool": 123, "arguments": {}}';
    const result = parseToolCall(response);

    assert.ok(result.finalReply);
    assert.strictEqual(result.toolCall, undefined);
  });

  it("returns final reply for null tool name", () => {
    const response = '{"tool": null, "arguments": {}}';
    const result = parseToolCall(response);

    assert.ok(result.finalReply);
    assert.strictEqual(result.toolCall, undefined);
  });

  it("handles unicode in response", () => {
    const response = "こんにちは\n```json\n{\"tool\": \"get_time\", \"arguments\": {}}\n```";
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "get_time");
  });
});

describe("parseToolCall - edge cases", () => {
  it("handles response with only whitespace", () => {
    const result = parseToolCall("   \n  \t  ");
    assert.ok(result.finalReply !== undefined);
  });

  it("handles very long plain JSON", () => {
    const bigArgs = { data: "x".repeat(1000) };
    const response = JSON.stringify({ tool: "get_time", arguments: bigArgs });
    const result = parseToolCall(response);

    assert.ok(result.toolCall);
    assert.strictEqual(result.toolCall!.toolName, "get_time");
    assert.strictEqual(result.toolCall!.arguments.data.length, 1000);
  });
});

describe("executeToolLoop - no tool needed", () => {
  it("returns model response as final reply when no tool call is detected", async () => {
    const { getModelResponse, executor, registry, maxIterations } = createLoopInput(
      ["Hello, I can help you with that."],
      [makeTool("get_time")],
    );

    const result = await executeToolLoop({ getModelResponse, executor, registry, maxIterations });

    assert.strictEqual(result.finalReply, "Hello, I can help you with that.");
    assert.strictEqual(result.toolResults.length, 0);
    assert.strictEqual(result.toolCallsMade, 0);
    assert.strictEqual(result.iterationLimitReached, false);
  });

  it("returns final reply when model output is a normal response with no JSON", async () => {
    const { getModelResponse, executor, registry, maxIterations } = createLoopInput(
      ["I don't need any tools for this."],
      [makeTool("get_time")],
    );

    const result = await executeToolLoop({ getModelResponse, executor, registry, maxIterations });

    assert.strictEqual(result.finalReply, "I don't need any tools for this.");
    assert.strictEqual(result.toolCallsMade, 0);
  });
});

describe("executeToolLoop - one successful tool call", () => {
  it("executes one tool and returns final answer", async () => {
    const { getModelResponse, executor, registry, maxIterations } = createLoopInput(
      [
        '```json\n{"tool": "get_time", "arguments": {}}\n```',
        "The current time is 2:30 PM.",
      ],
      [makeTool("get_time")],
    );

    const result = await executeToolLoop({ getModelResponse, executor, registry, maxIterations });

    assert.strictEqual(result.toolCallsMade, 1);
    assert.strictEqual(result.toolResults.length, 1);
    assert.strictEqual(result.toolResults[0].success, true);
    assert.strictEqual(result.toolResults[0].toolName, "get_time");
    assert.strictEqual(result.iterationLimitReached, false);
    assert.ok(result.finalReply.includes("2:30 PM"));
  });
});

describe("executeToolLoop - multiple sequential tool calls", () => {
  it("executes multiple tools in sequence", async () => {
    const { getModelResponse, executor, registry, maxIterations } = createLoopInput(
      [
        '```json\n{"tool": "get_current_time", "arguments": {}}\n```',
        '```json\n{"tool": "get_runtime_info", "arguments": {}}\n```',
        "I have gathered the information you requested.",
      ],
      [makeTool("get_current_time"), makeTool("get_runtime_info")],
    );

    const result = await executeToolLoop({ getModelResponse, executor, registry, maxIterations });

    assert.strictEqual(result.toolCallsMade, 2);
    assert.strictEqual(result.toolResults.length, 2);
    assert.strictEqual(result.toolResults[0].toolName, "get_current_time");
    assert.strictEqual(result.toolResults[1].toolName, "get_runtime_info");
  });
});

describe("executeToolLoop - unknown tool", () => {
  it("handles unknown tool from model with structured error", async () => {
    const { getModelResponse, executor, registry, maxIterations } = createLoopInput(
      [
        '```json\n{"tool": "unknown_tool", "arguments": {}}\n```',
        "I've completed my analysis.",
      ],
      [makeTool("known_tool")],
    );

    const result = await executeToolLoop({ getModelResponse, executor, registry, maxIterations });

    assert.strictEqual(result.toolCallsMade, 1);
    assert.strictEqual(result.toolResults[0].success, false);
    assert.strictEqual(result.toolResults[0].code, "NOT_FOUND");
    assert.ok(result.finalReply.includes("completed"));
  });
});

describe("executeToolLoop - invalid arguments", () => {
  it("handles invalid tool arguments with structured error", async () => {
    const { getModelResponse, executor, registry, maxIterations } = createLoopInput(
      [
        '```json\n{"tool": "get_time", "arguments": {"bad_field": true}}\n```',
        "I've finished.",
      ],
      [makeTool("get_time", { type: "object", properties: {}, required: ["required_field"] })],
    );

    const result = await executeToolLoop({ getModelResponse, executor, registry, maxIterations });

    assert.strictEqual(result.toolResults[0].success, false);
    assert.strictEqual(result.toolResults[0].code, "VALIDATION_ERROR");
  });
});

describe("executeToolLoop - tool execution failure", () => {
  it("handles tool that throws an error", async () => {
    const { getModelResponse, executor, registry, maxIterations } = createLoopInput(
      [
        '```json\n{"tool": "error_tool", "arguments": {}}\n```',
        "Done.",
      ],
      [makeToolWithResult("error_tool", { success: false, toolName: "error_tool", status: "error", error: "intentional failure", code: "EXECUTION_ERROR", durationMs: 5 })],
    );

    const result = await executeToolLoop({ getModelResponse, executor, registry, maxIterations });

    assert.strictEqual(result.toolResults[0].success, false);
    assert.strictEqual(result.toolResults[0].code, "EXECUTION_ERROR");
    assert.ok(result.finalReply.includes("Done."));
  });
});

describe("executeToolLoop - timeout", () => {
  it("handles tool timeout with structured error", async () => {
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

    const result = await executeToolLoop({
      getModelResponse: async (_messages) => '```json\n{"tool": "slow_tool", "arguments": {}}\n```',
      executor,
      registry,
      maxIterations: 3,
    });

    assert.strictEqual(result.toolResults[0].status, "timeout");
    assert.strictEqual(result.toolResults[0].code, "TIMEOUT");
  });
});

describe("executeToolLoop - cancellation", () => {
  it("handles cancellation via abort signal", async () => {
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

    const result = await executeToolLoop({
      getModelResponse: async (_messages) => '```json\n{"tool": "cancel_tool", "arguments": {}}\n```',
      executor,
      registry,
      maxIterations: 3,
      signal: controller.signal,
    });

    assert.strictEqual(result.toolResults[0].status, "cancelled");
    assert.strictEqual(result.toolResults[0].code, "CANCELLED");
  });
});

describe("executeToolLoop - validation null bytes in input", () => {
  it("rejects null bytes in tool arguments", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("get_time"));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executeToolLoop({
      getModelResponse: async (_messages) => '```json\n{"tool": "get_time", "arguments": {"tz": "utc\\u0000malicious"}}\n```',
      executor,
      registry,
      maxIterations: 3,
    });

    assert.strictEqual(result.toolResults[0].success, false);
    assert.strictEqual(result.toolResults[0].code, "VALIDATION_ERROR");
  });
});

describe("executeToolLoop - error tracking", () => {
  it("tracks toolErrors when tool returns error status", async () => {
    const registry = new ToolRegistry();
    registry.register(makeToolWithResult("fail_tool", { success: false, toolName: "fail_tool", status: "error", error: "fail", code: "EXECUTION_ERROR", durationMs: 5 }));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executeToolLoop({
      getModelResponse: async (_messages) => '```json\n{"tool": "fail_tool", "arguments": {}}\n```',
      executor,
      registry,
      maxIterations: 3,
    });

    assert.strictEqual(result.toolCallsMade, 3);
    assert.strictEqual(result.toolErrors, 3);
    assert.strictEqual(result.toolTimeouts, 0);
  });

  it("tracks toolTimeouts", async () => {
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

    const result = await executeToolLoop({
      getModelResponse: async (_messages) => '```json\n{"tool": "slow_tool", "arguments": {}}\n```',
      executor,
      registry,
      maxIterations: 3,
    });

    assert.strictEqual(result.toolTimeouts, 3);
    assert.strictEqual(result.toolErrors, 3);
  });

  it("has zero errors for fully successful loop", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("get_time"));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executeToolLoop({
      getModelResponse: async (_messages) => '```json\n{"tool": "get_time", "arguments": {}}\n```',
      executor,
      registry,
      maxIterations: 3,
    });

    assert.strictEqual(result.toolErrors, 0);
    assert.strictEqual(result.toolTimeouts, 0);
  });
});

describe("executeToolLoop - iteration delay", () => {
  it("applies delay between iterations when configured", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("get_time"));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const start = Date.now();
    await executeToolLoop({
      getModelResponse: async (_messages) => '```json\n{"tool": "get_time", "arguments": {}}\n```',
      executor,
      registry,
      maxIterations: 3,
      iterationDelayMs: 100,
    });
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= 200, `Expected at least 200ms delay (2 gaps x 100ms), got ${elapsed}ms`);
  });
});

describe("executeToolLoop - maxInputLength", () => {
  it("truncates overly long model responses", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("get_time"));
    const executor = new ToolExecutor(registry, { logEnabled: false });
    const longResponse = "x".repeat(600_000);

    const result = await executeToolLoop({
      getModelResponse: async (_messages) => longResponse,
      executor,
      registry,
      maxIterations: 3,
      maxInputLength: 500_000,
    });

    assert.ok(result.finalReply.length <= 500_000);
    assert.strictEqual(result.toolCallsMade, 0);
  });
});

describe("executeToolLoop - max iteration limit", () => {
  it("stops when max iterations reached and returns safe message", async () => {
    const { getModelResponse, executor, registry, maxIterations } = createLoopInput(
      [
        '```json\n{"tool": "get_time", "arguments": {}}\n```',
        '```json\n{"tool": "get_time", "arguments": {}}\n```',
        '```json\n{"tool": "get_time", "arguments": {}}\n```',
      ],
      [makeTool("get_time")],
      { maxIterations: 3 },
    );

    const result = await executeToolLoop({ getModelResponse, executor, registry, maxIterations: 3 });

    assert.strictEqual(result.toolCallsMade, 3);
    assert.strictEqual(result.iterationLimitReached, true);
    assert.ok(result.finalReply.includes("maximum"));
  });

  it("handles single iteration limit", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("get_time"));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executeToolLoop({
      getModelResponse: async (_messages) => '```json\n{"tool": "get_time", "arguments": {}}\n```',
      executor,
      registry,
      maxIterations: 1,
    });

    assert.strictEqual(result.toolCallsMade, 1);
    assert.strictEqual(result.iterationLimitReached, true);
  });
});

describe("executeToolLoop - malformed model output", () => {
  it("handles response with malformed JSON in code block", async () => {
    const { getModelResponse, executor, registry, maxIterations } = createLoopInput(
      ["This is not a valid JSON: {tool: missing quotes}"],
      [makeTool("get_time")],
    );

    const result = await executeToolLoop({ getModelResponse, executor, registry, maxIterations });

    assert.strictEqual(result.finalReply, "This is not a valid JSON: {tool: missing quotes}");
    assert.strictEqual(result.toolCallsMade, 0);
  });

  it("handles empty model response", async () => {
    const { getModelResponse, executor, registry, maxIterations } = createLoopInput(
      [""],
      [makeTool("get_time")],
    );

    const result = await executeToolLoop({ getModelResponse, executor, registry, maxIterations });

    assert.strictEqual(result.finalReply, "");
    assert.strictEqual(result.toolCallsMade, 0);
  });

  it("handles partial JSON in code block", async () => {
    const { getModelResponse, executor, registry, maxIterations } = createLoopInput(
      ["```json\n{incomplete\n```"],
      [makeTool("get_time")],
    );

    const result = await executeToolLoop({ getModelResponse, executor, registry, maxIterations });

    assert.ok(result.finalReply);
    assert.strictEqual(result.toolCall === undefined, true);
  });
});

describe("executeToolLoop - initialMessages", () => {
  it("starts with provided initial messages", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("get_time"));
    const executor = new ToolExecutor(registry, { logEnabled: false });

    const result = await executeToolLoop({
      getModelResponse: async (_messages) => '```json\n{"tool": "get_time", "arguments": {}}\n```',
      executor,
      registry,
      maxIterations: 3,
      initialMessages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "What time is it?" },
      ],
    });

    assert.strictEqual(result.toolCallsMade, 3);
    assert.strictEqual(result.iterationLimitReached, true);
  });
});

describe("describeAllTools", () => {
  it("returns empty message for no tools", () => {
    assert.strictEqual(describeAllTools([]), "No tools are currently available.");
  });

  it("describes a single tool", () => {
    const tool = makeTool("get_time");
    const result = describeAllTools([tool]);

    assert.ok(result.includes("get_time"));
    assert.ok(result.includes("Input schema"));
  });

  it("describes multiple tools", () => {
    const tools = [makeTool("get_time"), makeTool("get_runtime_info")];
    const result = describeAllTools(tools);

    assert.ok(result.includes("get_time"));
    assert.ok(result.includes("get_runtime_info"));
  });
});
