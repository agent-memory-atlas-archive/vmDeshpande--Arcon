import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createListDirectoryTool } from "../../src/tools/list-directory.js";

function createTestDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "list-test-"));
  mkdirSync(join(dir, "subdir"), { recursive: true });
  writeFileSync(join(dir, "file1.txt"), "content1");
  writeFileSync(join(dir, "file2.ts"), "content2");
  writeFileSync(join(dir, "subdir", "nested.txt"), "nested");
  return dir;
}

describe("list_directory", () => {
  it("lists directory entries", async () => {
    const root = createTestDir();
    const tool = createListDirectoryTool({ allowedRoots: [root] });
    const result = await tool.execute({ path: root }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, true);
    const output = result.output as Record<string, unknown>;
    assert.ok(output.entries.includes("file1.txt"));
    assert.ok(output.entries.includes("file2.ts"));
    assert.ok(output.entries.includes("subdir"));

    rmSync(root, { recursive: true });
  });

  it("rejects path outside allowed root", async () => {
    const root = createTestDir();
    const tool = createListDirectoryTool({ allowedRoots: [root] });
    const result = await tool.execute({ path: "/etc" }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "PATH_DENIED");

    rmSync(root, { recursive: true });
  });

  it("rejects path traversal", async () => {
    const root = createTestDir();
    const tool = createListDirectoryTool({ allowedRoots: [root] });
    const result = await tool.execute({ path: join(root, "..") }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "PATH_DENIED");

    rmSync(root, { recursive: true });
  });

  it("limits large directory listings to maxEntries", async () => {
    const root = mkdtempSync(join(tmpdir(), "list-large-"));
    for (let i = 0; i < 500; i++) {
      writeFileSync(join(root, `file${i}.txt`), "x");
    }

    const tool = createListDirectoryTool({ allowedRoots: [root], maxEntries: 200 });
    const result = await tool.execute({ path: root }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, true);
    const output = result.output as Record<string, unknown>;
    assert.ok((output.totalEntries as number) <= 200);
    assert.ok((output.entries as string).length > 0);

    rmSync(root, { recursive: true });
  });

  it("handles missing path", async () => {
    const root = createTestDir();
    const tool = createListDirectoryTool({ allowedRoots: [root] });
    const result = await tool.execute({}, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "VALIDATION_ERROR");

    rmSync(root, { recursive: true });
  });
});
