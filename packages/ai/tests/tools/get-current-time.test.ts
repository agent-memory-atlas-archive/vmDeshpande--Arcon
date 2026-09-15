import { describe, it } from "node:test";
import assert from "node:assert";
import { createGetCurrentTimeTool } from "../../src/tools/get-current-time.js";

describe("get_current_time", () => {
  it("returns current time info", async () => {
    const tool = createGetCurrentTimeTool({});
    const result = await tool.execute({}, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, "success");
    assert.strictEqual(result.toolName, "get_current_time");
    assert.ok(result.output);

    const output = result.output as Record<string, unknown>;
    assert.ok(output.localTime);
    assert.ok(output.utcTime);
    assert.ok(output.date);
    assert.ok(output.timezone);
    assert.ok(output.weekday);
  });

  it("returns valid time values", async () => {
    const tool = createGetCurrentTimeTool({});
    const result = await tool.execute({}, { logger: { info: () => {}, warn: () => {}, error: () => {} } });
    const output = result.output as Record<string, unknown>;

    assert.strictEqual(typeof output.localTime, "string");
    assert.strictEqual(typeof output.utcTime, "string");
    assert.strictEqual(typeof output.timezone, "string");
    assert.strictEqual(typeof output.weekday, "string");
    assert.strictEqual(typeof output.hour, "number");
    assert.strictEqual(typeof output.minute, "number");
  });
});
