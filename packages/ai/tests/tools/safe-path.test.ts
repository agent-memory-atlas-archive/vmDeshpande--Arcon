import { describe, it } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { resolveSafePath } from "../../src/tools/safe-path.js";

describe("resolveSafePath", () => {
  it("accepts path within allowed root", () => {
    const result = resolveSafePath("/home/user/docs/file.txt", ["/home/user"]);
    assert.strictEqual(result.safe, true);
    assert.ok(result.resolved?.endsWith("file.txt"));
  });

  it("rejects path outside allowed root", () => {
    const result = resolveSafePath("/etc/passwd", ["/home/user"]);
    assert.strictEqual(result.safe, false);
    assert.ok(result.reason?.includes("outside"));
  });

  it("rejects path traversal", () => {
    const result = resolveSafePath("../../etc/passwd", ["/home/user"]);
    assert.strictEqual(result.safe, false);
  });

  it("rejects absolute path traversal", () => {
    const result = resolveSafePath("/etc/shadow", ["/home/user"]);
    assert.strictEqual(result.safe, false);
  });

  it("accepts path at exact root boundary", () => {
    const result = resolveSafePath("/home/user", ["/home/user"]);
    assert.strictEqual(result.safe, true);
  });

  it("accepts nested path within root", () => {
    const root = "C:\\Users\\test";
    const result = resolveSafePath(join(root, "projects", "app", "src", "index.ts"), [root]);
    assert.strictEqual(result.safe, true);
  });

  it("rejects path with relative traversal from root", () => {
    const result = resolveSafePath("subdir/../../../etc/passwd", ["/home/user"]);
    assert.strictEqual(result.safe, false);
  });

  it("handles different allowed roots", () => {
    const result = resolveSafePath("/data/files/test.txt", ["/home/user", "/data"]);
    assert.strictEqual(result.safe, true);
  });

  it("handles Windows-style paths", () => {
    const result = resolveSafePath("C:\\Users\\test\\file.txt", ["C:\\Users"]);
    assert.strictEqual(result.safe, true);
  });

  it("rejects Windows path to different drive", () => {
    const result = resolveSafePath("D:\\secret.txt", ["C:\\Users"]);
    assert.strictEqual(result.safe, false);
  });
});
