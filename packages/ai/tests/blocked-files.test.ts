import { describe, it } from "node:test";
import assert from "node:assert";
import { isBlockedFile } from "../src/tools/blocked-files.js";

describe("isBlockedFile - blocked patterns", () => {
  it("blocks .env files", () => {
    const result = isBlockedFile("/project/.env");
    assert.strictEqual(result.blocked, true);
  });

  it("blocks .env.development", () => {
    const result = isBlockedFile("/project/.env.development");
    assert.strictEqual(result.blocked, true);
  });

  it("blocks credential files", () => {
    const result = isBlockedFile("/project/credentials.json");
    assert.strictEqual(result.blocked, true);
  });

  it("blocks private key files", () => {
    const result = isBlockedFile("/project/.ssh/id_rsa");
    assert.strictEqual(result.blocked, true);
  });

  it("blocks files with secret in name", () => {
    const result = isBlockedFile("/project/secret.txt");
    assert.strictEqual(result.blocked, true);
  });

  it("blocks .npmrc", () => {
    const result = isBlockedFile("/project/.npmrc");
    assert.strictEqual(result.blocked, true);
  });

  it("blocks package-lock.json", () => {
    const result = isBlockedFile("/project/package-lock.json");
    assert.strictEqual(result.blocked, true);
  });

  it("blocks .gitignore", () => {
    const result = isBlockedFile("/project/.gitignore");
    assert.strictEqual(result.blocked, true);
  });
});

describe("isBlockedFile - allowed files", () => {
  it("allows normal source files", () => {
    const result = isBlockedFile("/project/src/index.ts");
    assert.strictEqual(result.blocked, false);
  });

  it("allows .git directory", () => {
    const result = isBlockedFile("/project/.git/config");
    assert.strictEqual(result.blocked, false);
  });

  it("allows .vscode directory", () => {
    const result = isBlockedFile("/project/.vscode/settings.json");
    assert.strictEqual(result.blocked, false);
  });

  it("allows readme files", () => {
    const result = isBlockedFile("/project/README.md");
    assert.strictEqual(result.blocked, false);
  });

  it("allows package.json", () => {
    const result = isBlockedFile("/project/package.json");
    assert.strictEqual(result.blocked, false);
  });
});

describe("isBlockedFile - hidden files", () => {
  it("blocks hidden files that are not .git or .vscode", () => {
    const result = isBlockedFile("/project/.hidden");
    assert.strictEqual(result.blocked, true);
  });

  it("blocks hidden files with dot in name", () => {
    const result = isBlockedFile("/project/.config");
    assert.strictEqual(result.blocked, true);
  });
});
