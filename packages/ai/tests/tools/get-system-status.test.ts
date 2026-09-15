import { describe, it } from "node:test";
import assert from "node:assert";
import { createGetSystemStatusTool } from "../../src/tools/get-system-status.js";

describe("get_system_status", () => {
  it("returns safe system information", async () => {
    const tool = createGetSystemStatusTool({});
    const result = await tool.execute({}, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, "success");
    assert.strictEqual(result.toolName, "get_system_status");

    const output = result.output as Record<string, unknown>;
    assert.strictEqual(typeof output.hostname, "string");
    assert.strictEqual(typeof output.platform, "string");
    assert.strictEqual(typeof output.architecture, "string");
    assert.ok(output.memory);
    assert.ok(output.cpuCount);
  });

  it("includes memory stats", async () => {
    const tool = createGetSystemStatusTool({});
    const result = await tool.execute({}, { logger: { info: () => {}, warn: () => {}, error: () => {} } });
    const output = result.output as Record<string, unknown>;
    const memory = output.memory as Record<string, unknown>;

    assert.ok(memory.totalBytes);
    assert.ok(memory.freeBytes);
    assert.ok(memory.usedBytes);
    assert.ok(memory.usagePercent);
  });

  it("does not expose secrets", async () => {
    const tool = createGetSystemStatusTool({});
    const result = await tool.execute({}, { logger: { info: () => {}, warn: () => {}, error: () => {} } });
    const output = JSON.stringify(result.output);

    assert.strictEqual(output.includes("process.env"), false);
    assert.strictEqual(output.includes("PATH="), false);
    assert.strictEqual(output.includes("HOME="), false);
  });
});
