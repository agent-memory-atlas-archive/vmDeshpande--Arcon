import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReadFileTool } from "../../src/tools/read-file.js";

function createTestFile(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe("read_file", () => {
  it("reads a text file within allowed root", async () => {
    const root = mkdtempSync(join(tmpdir(), "read-test-"));
    createTestFile(root, "test.txt", "Hello World");
    const tool = createReadFileTool({ allowedRoots: [root] });
    const result = await tool.execute({ path: join(root, "test.txt") }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, true);
    const output = result.output as Record<string, unknown>;
    assert.strictEqual(output.content, "Hello World");

    rmSync(root, { recursive: true });
  });

  it("rejects path outside allowed root", async () => {
    const root = mkdtempSync(join(tmpdir(), "read-test-"));
    createTestFile(root, "test.txt", "Hello");
    const tool = createReadFileTool({ allowedRoots: [root] });
    const result = await tool.execute({ path: "/etc/passwd" }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "PATH_DENIED");

    rmSync(root, { recursive: true });
  });

  it("rejects path traversal", async () => {
    const root = mkdtempSync(join(tmpdir(), "read-test-"));
    mkdirSync(join(root, "safe"), { recursive: true });
    createTestFile(root, "test.txt", "Hello");
    const tool = createReadFileTool({ allowedRoots: [root] });
    const result = await tool.execute({ path: join(root, "..", "test.txt") }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "PATH_DENIED");

    rmSync(root, { recursive: true });
  });

  it("rejects .env files", async () => {
    const root = mkdtempSync(join(tmpdir(), "read-test-"));
    createTestFile(root, ".env", "SECRET=password");
    const tool = createReadFileTool({ allowedRoots: [root] });
    const result = await tool.execute({ path: join(root, ".env") }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "BLOCKED");

    rmSync(root, { recursive: true });
  });

  it("rejects files with secret-like names", async () => {
    const root = mkdtempSync(join(tmpdir(), "read-test-"));
    createTestFile(root, "credentials.json", "{\"token\":\"abc\"}");
    const tool = createReadFileTool({ allowedRoots: [root] });
    const result = await tool.execute({ path: join(root, "credentials.json") }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "BLOCKED");

    rmSync(root, { recursive: true });
  });

  it("rejects oversized files", async () => {
    const root = mkdtempSync(join(tmpdir(), "read-test-"));
    const largeContent = "x".repeat(2 * 1024 * 1024);
    createTestFile(root, "large.txt", largeContent);
    const tool = createReadFileTool({ allowedRoots: [root], maxFileSizeBytes: 1048576 });
    const result = await tool.execute({ path: join(root, "large.txt") }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "FILE_TOO_LARGE");

    rmSync(root, { recursive: true });
  });

  it("handles empty files", async () => {
    const root = mkdtempSync(join(tmpdir(), "read-test-"));
    createTestFile(root, "empty.txt", "");
    const tool = createReadFileTool({ allowedRoots: [root] });
    const result = await tool.execute({ path: join(root, "empty.txt") }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, true);
    const output = result.output as Record<string, unknown>;
    assert.strictEqual(output.content, "");

    rmSync(root, { recursive: true });
  });
});
