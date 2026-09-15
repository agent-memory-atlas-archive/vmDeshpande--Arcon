import { describe, it } from "node:test";
import assert from "node:assert";
import { MemoryType, MemoryStatus, MemorySourceType, MemoryScope } from "../src/personal-memory.js";
import { reviewCandidate } from "../src/pipeline/memory-review.js";
import type { MemoryCandidate } from "../src/extractor/candidate.js";

function makeMemory(overrides: {
  id?: string;
  type?: MemoryType;
  status?: MemoryStatus;
  content: string;
  updatedAt: string;
  importanceScore?: number;
  confidenceScore?: number;
  scope?: MemoryScope;
}): import("../src/personal-memory.js").Memory {
  return {
    id: overrides.id ?? "mem-" + overrides.content.length,
    type: overrides.type ?? MemoryType.PREFERENCE,
    status: overrides.status ?? MemoryStatus.ACTIVE,
    content: overrides.content,
    importanceScore: overrides.importanceScore ?? 6,
    confidenceScore: overrides.confidenceScore ?? 0.9,
    sourceType: MemorySourceType.USER_EXPLICIT,
    createdAt: overrides.updatedAt,
    updatedAt: overrides.updatedAt,
    subject: undefined,
    tags: [],
    evidenceCount: 1,
    scope: overrides.scope ?? MemoryScope.USER,
  };
}

function makeCandidate(content: string): MemoryCandidate {
  return {
    type: MemoryType.PREFERENCE,
    content,
    confidenceScore: 0.9,
    importanceScore: 6,
    sourceType: MemorySourceType.USER_EXPLICIT,
  };
}

describe("MemoryReview tiebreaker", () => {
  it("prefers newer memory on similarity tie regardless of array order", () => {
    const older = makeMemory({ id: "older", content: "User prefers TypeScript", updatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeMemory({ id: "newer", content: "User also prefers TypeScript", updatedAt: "2026-09-01T00:00:00.000Z" });
    const candidate = makeCandidate("User moved from TypeScript to Python");

    const result = reviewCandidate(candidate, [older, newer]);

    assert.strictEqual(result.decision, "SUPERSEDE");
    assert.strictEqual(result.targetMemory?.id, "newer");
  });

  it("prefers newer memory on similarity tie (newer first in array)", () => {
    const older = makeMemory({ id: "older", content: "User prefers TypeScript", updatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeMemory({ id: "newer", content: "User also prefers TypeScript", updatedAt: "2026-09-01T00:00:00.000Z" });
    const candidate = makeCandidate("User moved from TypeScript to Python");

    const result = reviewCandidate(candidate, [newer, older]);

    assert.strictEqual(result.decision, "SUPERSEDE");
    assert.strictEqual(result.targetMemory?.id, "newer");
  });

  it("uses similarity as primary criterion with tiebreaker only on ties", () => {
    const lowerSim = makeMemory({ id: "lower", content: "User likes Python", updatedAt: "2026-09-01T00:00:00.000Z" });
    const higherSim = makeMemory({ id: "higher", content: "User prefers JavaScript", updatedAt: "2026-01-01T00:00:00.000Z" });
    const candidate = makeCandidate("User moved from JavaScript to Rust");

    const result = reviewCandidate(candidate, [lowerSim, higherSim]);

    assert.strictEqual(result.decision, "SUPERSEDE");
    assert.strictEqual(result.targetMemory?.id, "higher");
  });

  it("prefers newer memory on tie in cross-type supersession path", () => {
    const older = makeMemory({ id: "older", content: "User works with TypeScript", type: MemoryType.FACT, updatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeMemory({ id: "newer", content: "User codes in TypeScript", type: MemoryType.FACT, updatedAt: "2026-09-01T00:00:00.000Z" });

    const candidate: MemoryCandidate = {
      type: MemoryType.PROJECT,
      content: "User moved from TypeScript to Go",
      confidenceScore: 0.9,
      importanceScore: 6,
      sourceType: MemorySourceType.USER_EXPLICIT,
    };

    const result = reviewCandidate(candidate, [older, newer], "I switched to Go");

    assert.strictEqual(result.decision, "SUPERSEDE");
  });
});
