import { describe, it } from "node:test";
import assert from "node:assert";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import type { Tool } from "../../src/tools/tool.js";

function makeTool(name: string): Tool {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: "object", properties: {} },
    async execute() {
      return { success: true, toolName: name, status: "success", durationMs: 0 };
    },
  };
}

describe("ToolRegistry", () => {
  it("registers and retrieves a tool by name", () => {
    const registry = new ToolRegistry();
    const tool = makeTool("get_runtime_info");

    registry.register(tool);

    assert.strictEqual(registry.get("get_runtime_info"), tool);
  });

  it("returns undefined for unregistered tools", () => {
    const registry = new ToolRegistry();

    assert.strictEqual(registry.get("nonexistent"), undefined);
  });

  it("checks if a tool exists via has", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("foo"));

    assert.strictEqual(registry.has("foo"), true);
    assert.strictEqual(registry.has("bar"), false);
  });

  it("unregisters a tool by name", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("temp"));

    assert.strictEqual(registry.unregister("temp"), true);
    assert.strictEqual(registry.has("temp"), false);
  });

  it("returns false when unregistering non-existent tool", () => {
    const registry = new ToolRegistry();

    assert.strictEqual(registry.unregister("nothing"), false);
  });

  it("lists all registered tools", () => {
    const registry = new ToolRegistry();
    const toolA = makeTool("alpha");
    const toolB = makeTool("beta");

    registry.register(toolA);
    registry.register(toolB);

    const tools = registry.list();

    assert.strictEqual(tools.length, 2);
    assert(tools.some((t) => t.name === "alpha"));
    assert(tools.some((t) => t.name === "beta"));
  });

  it("replaces a tool when registering the same name", () => {
    const registry = new ToolRegistry();
    const first = makeTool("dup");
    const second = makeTool("dup");

    registry.register(first);
    registry.register(second);

    assert.strictEqual(registry.get("dup"), second);
    assert.strictEqual(registry.count, 1);
  });

  it("supports multiple tools", () => {
    const registry = new ToolRegistry();

    for (let i = 0; i < 10; i++) {
      registry.register(makeTool(`tool_${i}`));
    }

    assert.strictEqual(registry.count, 10);
    assert.strictEqual(registry.list().length, 10);
  });
});
