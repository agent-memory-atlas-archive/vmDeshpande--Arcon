import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSearchFilesTool } from "../../src/tools/search-files.js";

function createTestStructure(root: string): void {
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export {}");
  writeFileSync(join(root, "src", "helper.ts"), "export {}");
  writeFileSync(join(root, "src", "config.json"), "{}");
  writeFileSync(join(root, "node_modules", "pkg", "index.js"), "{}");
  writeFileSync(join(root, ".git", "config"), "[]");
  writeFileSync(join(root, "dist", "bundle.js"), "{}");
  writeFileSync(join(root, "README.md"), "# Project");
}

describe("search_files", () => {
  it("finds files matching query", async () => {
    const root = mkdtempSync(join(tmpdir(), "search-test-"));
    createTestStructure(root);
    const tool = createSearchFilesTool({ allowedRoots: [root] });
    const result = await tool.execute({ query: "index", path: root }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, true);
    const output = result.output as Record<string, unknown>;
    assert.ok(output.resultCount > 0);
    const results = output.results as Array<{ path: string }>;
    assert.ok(results.some((r) => r.path.includes("index")));

    rmSync(root, { recursive: true });
  });

  it("excludes node_modules from results", async () => {
    const root = mkdtempSync(join(tmpdir(), "search-test-"));
    createTestStructure(root);
    const tool = createSearchFilesTool({ allowedRoots: [root] });
    const result = await tool.execute({ query: "index", path: root }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    const output = result.output as Record<string, unknown>;
    const results = output.results as Array<{ path: string }>;
    assert.ok(!results.some((r) => r.path.includes("node_modules")));

    rmSync(root, { recursive: true });
  });

  it("excludes .git from results", async () => {
    const root = mkdtempSync(join(tmpdir(), "search-test-"));
    createTestStructure(root);
    const tool = createSearchFilesTool({ allowedRoots: [root] });
    const result = await tool.execute({ query: "config", path: root }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    const output = result.output as Record<string, unknown>;
    const results = output.results as Array<{ path: string }>;
    assert.ok(!results.some((r) => r.path.includes(".git")));

    rmSync(root, { recursive: true });
  });

  it("excludes dist build output", async () => {
    const root = mkdtempSync(join(tmpdir(), "search-test-"));
    createTestStructure(root);
    const tool = createSearchFilesTool({ allowedRoots: [root] });
    const result = await tool.execute({ query: "bundle", path: root }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    const output = result.output as Record<string, unknown>;
    const results = output.results as Array<{ path: string }>;
    assert.ok(!results.some((r) => r.path.includes("dist")));

    rmSync(root, { recursive: true });
  });

  it("rejects path outside allowed root", async () => {
    const root = mkdtempSync(join(tmpdir(), "search-test-"));
    createTestStructure(root);
    const tool = createSearchFilesTool({ allowedRoots: [root] });
    const result = await tool.execute({ query: "test", path: "/etc" }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "PATH_DENIED");

    rmSync(root, { recursive: true });
  });

  it("enforces result count limit", async () => {
    const root = mkdtempSync(join(tmpdir(), "search-test-"));
    createTestStructure(root);
    const tool = createSearchFilesTool({ allowedRoots: [root], maxResults: 2 });
    const result = await tool.execute({ query: "ts", path: root }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    const output = result.output as Record<string, unknown>;
    assert.strictEqual(output.resultCount as number, 2);

    rmSync(root, { recursive: true });
  });

  it("handles missing query", async () => {
    const root = mkdtempSync(join(tmpdir(), "search-test-"));
    createTestStructure(root);
    const tool = createSearchFilesTool({ allowedRoots: [root] });
    const result = await tool.execute({ path: root }, { logger: { info: () => {}, warn: () => {}, error: () => {} } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "VALIDATION_ERROR");

    rmSync(root, { recursive: true });
  });
});
