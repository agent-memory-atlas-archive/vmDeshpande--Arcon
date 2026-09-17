import { describe, it } from "node:test";
import assert from "node:assert";
import { resolveSafePath } from "../src/tools/safe-path.js";

describe("resolveSafePath - basic", () => {
  it("allows paths within allowed root", () => {
    const result = resolveSafePath("/home/user/docs/file.txt", ["/home/user"]);
    assert.strictEqual(result.safe, true);
    assert.ok(result.resolved);
  });

  it("denies paths outside allowed root", () => {
    const result = resolveSafePath("/etc/passwd", ["/home/user"]);
    assert.strictEqual(result.safe, false);
    assert.ok(result.reason);
  });

  it("allows exact root path", () => {
    const result = resolveSafePath("/home/user", ["/home/user"]);
    assert.strictEqual(result.safe, true);
  });

  it("returns error for empty path", () => {
    const result = resolveSafePath("", ["/home/user"]);
    assert.strictEqual(result.safe, false);
  });

  it("returns error for null path", () => {
    const result = resolveSafePath(null as unknown as string, ["/home/user"]);
    assert.strictEqual(result.safe, false);
  });
});

describe("resolveSafePath - security", () => {
  it("denies path traversal with ..", () => {
    const result = resolveSafePath("/home/user/../secret", ["/home/user"]);
    assert.strictEqual(result.safe, false);
  });

  it("denies null bytes in path", () => {
    const result = resolveSafePath("/home/user\0/etc/passwd", ["/home/user"]);
    assert.strictEqual(result.safe, false);
    assert.ok(result.reason?.includes("null"));
  });

  it("denies relative traversal", () => {
    const result = resolveSafePath("../../etc/passwd", ["/home/user"]);
    assert.strictEqual(result.safe, false);
  });

  it("handles Windows-style paths", () => {
    const result = resolveSafePath("C:\\Users\\docs\\file.txt", ["C:\\Users"]);
    assert.strictEqual(result.safe, true);
  });

  it("denies Windows path traversal", () => {
    const result = resolveSafePath("C:\\..\\Windows\\secret.txt", ["C:\\Users"]);
    assert.strictEqual(result.safe, false);
  });
});
