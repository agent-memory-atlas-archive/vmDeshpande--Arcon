# Tool Calling

## Overview

Arcon supports tool-augmented conversations where the model can decide to invoke registered tools (e.g., `get_current_time`, `get_runtime_info`, `list_directory`, `read_file`, `search_files`) and use their results to produce a final answer.

## How the Model Selects Tools

1. The system prompt includes a `TOOLS:` section listing every registered tool with its name, description, and JSON input schema.
2. The model processes the prompt and generates a text response.
3. If the model intends to use a tool, it outputs the call as a JSON object inside a Markdown code block:

```
Here is what I need:
```json
{"tool": "get_current_time", "arguments": {}}
```
```

4. A JSON code block without the `json` language tag is also accepted.
5. If no tool-call block is found, the response is treated as a final answer.

## Tool-Call Format

The model must output a valid JSON object with:

| Field        | Type                 | Required | Description                                   |
|--------------|----------------------|----------|-----------------------------------------------|
| `tool`       | string               | Yes      | Exact name of a registered tool               |
| `arguments`  | object               | Yes      | Parameter object matching the tool's schema   |

Alternative field name `toolName` is also accepted for `tool`.

Malformed output (invalid JSON, missing fields, wrong types) is treated as a final answer and returned verbatim to the user.

## Execution Loop

When a `ToolExecutor` is configured on `ChatService`:

1. The user message is processed normally (intent, context, cognitive decision, prompt building).
2. The model's response is checked for a tool call.
3. If found:
   a. The tool name and arguments are validated strictly against the registered schema.
   b. Validation failures return a `VALIDATION_ERROR` result.
   c. Unknown tools return a `NOT_FOUND` result.
   d. The tool is executed via `ToolExecutor` (supports timeout, cancellation).
   e. The tool result is appended to conversation history.
   f. The loop repeats: the model sees previous results and decides again.
4. If not a tool call: the response is the final answer.
5. A configurable iteration limit (`maxToolIterations`, default 5) prevents infinite loops.
6. When the limit is reached, a safe message is returned instead of looping forever.

The full flow:

```
user message → model decision → tool execution → tool result → model continuation → final answer
```

## Safety Limits

| Limit | Default | Purpose                              |
|-------|---------|--------------------------------------|
| `maxToolIterations` | 5 | Prevents infinite tool loops           |
| `defaultTimeoutMs` (ToolExecutor) | 5000ms | Prevents hanging on slow tools |

When the iteration limit is reached, the model's response becomes the final answer and no further tool calls are made.

## Failure Handling

All failure modes produce structured `ToolResult` objects with `success: false`, a `code`, and a safe error message:

| Code              | When                                          |
|-------------------|-----------------------------------------------|
| `NOT_FOUND`       | Model requested an unregistered tool          |
| `VALIDATION_ERROR`| Model provided invalid arguments              |
| `TIMEOUT`         | Tool execution exceeded timeout               |
| `CANCELLED`       | Abort signal triggered before completion      |
| `EXECUTION_ERROR` | Tool threw an exception                       |

Error messages never expose stack traces or filesystem details.

## Streaming Behavior

`chatStream()` preserves streaming as before:
1. Model response chunks are streamed to the caller as they arrive.
2. After streaming completes, tool call processing happens (sequential execution).
3. The async generator does not complete until all tool calls and their results are finished.
4. Memory extraction and commit still happen after all tool processing is done.

## Registering Tools

1. Create a `Tool` object (name, description, inputSchema, execute function).
2. Register it with the `ToolRegistry` used by your `ToolExecutor`.
3. Pass the `ToolExecutor` to `ChatServiceOptions.toolExecutor`.
4. Tools are automatically discovered and described in the prompt.

Example:

```typescript
import { ToolRegistry, ToolExecutor } from "@arcon/ai";

const registry = new ToolRegistry();
registry.register({
  name: "get_greeting",
  description: "Returns a greeting message.",
  inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  async execute(input) {
    return { success: true, toolName: "get_greeting", status: "success", output: { greeting: `Hello, ${input.name}!` }, durationMs: 5 };
  },
});

const executor = new ToolExecutor(registry);
const service = new ChatService(repository, pipeline, aiClient, { toolExecutor: executor });
```

Future tools (file writing, web access, browser automation, etc.) follow the same registration pattern. They require separate approval before implementation.

## Runtime Integration Tests

The `runtime-integration.test.ts` test suite exercises the actual end-to-end path through ChatService with real local tools:

1. **One successful real tool call** - get_current_time via ChatService
2. **Multi-step tool sequence** - get_system_status → get_current_time
3. **Invalid arguments** - missing required field → VALIDATION_ERROR
4. **Unknown tool** - unregistered tool → NOT_FOUND
5. **Path traversal blocked** - file outside allowed root → PATH_DENIED
6. **Tool execution failure** - tool throws → EXECUTION_ERROR
7. **Final response uses tool result** - model incorporates result into answer

### Running runtime tests (requires inference service):

```bash
# Start the inference service first (see docs/local-integration.md)
npx tsx --test tests/runtime-integration.test.ts
npx tsx --test tests/runtime-verification.test.ts
```

## Known Limitations (Qwen3-4B)

1. **Response latency**: ~4-5 seconds for simple responses on RTX 3050 6GB (4-bit quantized).
2. **Tool call format**: Model may occasionally output tool calls without proper markdown code blocks. Malformed calls are safely treated as final replies.
3. **Iteration limit**: Default max 5 iterations may be reached for complex multi-step tasks.
4. **No streaming tool calls**: Tool execution is sequential after the main response.
5. **Model warmup**: First inference after service start is slower due to model loading.
