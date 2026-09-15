import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import type { ChatMessage } from "@arcon/shared";
import {
  MemoryRepository,
  MemoryPipeline,
  MemoryType,
  MemoryStatus,
  MemorySourceType,
  type PipelineResult,
} from "@arcon/memory";
import { ChatService } from "../src/chat-service.js";
import { DEFAULT_RUNTIME_IDENTITY } from "../src/runtime-identity.js";
import { buildRuntimeCapabilities } from "../src/runtime-state.js";
import { CapabilityRecall } from "../src/capability-recall.js";

class StreamTrackingAiClient {
  generateReplyCallCount = 0;
  streamCallCount = 0;

  async generateReply(messages: ChatMessage[]): Promise<string> {
    this.generateReplyCallCount++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return `reply to: ${messages[messages.length - 1]?.content ?? ""}`;
  }

  async *generateReplyStream(messages: ChatMessage[]): AsyncIterable<string> {
    this.streamCallCount++;
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      yield `chunk${i}`;
    }
  }
}

interface AiClient {
  generateReply(messages: ChatMessage[]): Promise<string>;
  generateReplyStream?(messages: ChatMessage[]): AsyncIterable<string>;
}

function createService(aiClient: AiClient, options: { dbPath?: string; conversationDb?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "arcon-completion-"));
  const dbPath = options.dbPath ?? join(dir, "memories.sqlite");
  const conversationDb = options.conversationDb ?? join(dir, "conversations.sqlite");

  const repository = new MemoryRepository(dbPath);
  const pipeline = new MemoryPipeline(repository);

  return {
    service: new ChatService(
      repository,
      pipeline,
      aiClient as any,
      {
        experienceDatabasePath: join(dir, "experiences.sqlite"),
        moodDatabasePath: join(dir, "mood.sqlite"),
        entityDatabasePath: join(dir, "entities.sqlite"),
        conversationDatabasePath: conversationDb,
        runtimeIdentity: {
          ...DEFAULT_RUNTIME_IDENTITY,
          baseModel: "Qwen/Qwen3-4B",
          adapterName: "arcon-v1",
          adapterVersion: "rank-8",
          adapterActive: true,
          inferenceBackend: "arcon-lora",
        },
        runtimeCapabilities: buildRuntimeCapabilities({
          identity: {
            ...DEFAULT_RUNTIME_IDENTITY,
            baseModel: "Qwen/Qwen3-4B",
            adapterName: "arcon-v1",
            adapterVersion: "rank-8",
            adapterActive: true,
            inferenceBackend: "arcon-lora",
          },
          hasPersistentMemory: true,
          hasConversationPersistence: true,
          hasVoice: false,
          hasWebAccess: false,
          hasComputerControl: false,
          hasBackgroundProcessing: false,
          hasVectorSearch: false,
          hasToolCalling: false,
          hasStreaming: true,
        }),
        hasStreaming: true,
      },
      "conv-completion",
    ),
    repository,
    dbPath,
    conversationDb,
  };
}

function countMemoriesInDb(dbPath: string, status?: MemoryStatus): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    if (status) {
      const row = db.prepare("SELECT COUNT(*) as c FROM personal_memories WHERE status = ?").get(status) as { c: number };
      return row.c;
    }
    const row = db.prepare("SELECT COUNT(*) as c FROM personal_memories").get() as { c: number };
    return row.c;
  } finally {
    db.close();
  }
}

function countMessagesInDb(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number };
    return row.c;
  } finally {
    db.close();
  }
}

describe("Memory stream completion contract", () => {
  describe("Stream completion is separate from memory extraction completion", () => {
    it("stream yields all chunks before chatStream returns", async () => {
      const aiClient = new StreamTrackingAiClient();
      const { service } = createService(aiClient);

      const chunks: string[] = [];
      for await (const chunk of service.chatStream("I like programming")) {
        chunks.push(chunk);
      }

      assert.ok(chunks.length >= 5, `stream should yield at least 5 chunks, got ${chunks.length}`);
      assert.ok(aiClient.streamCallCount >= 1, "stream should have been invoked");

      service.close();
    });
  });

  describe("Memory extraction completion is deterministically awaited", () => {
    it("chatStream awaits memory extraction before returning", async () => {
      const aiClient = new StreamTrackingAiClient();
      const { service, repository } = createService(aiClient);

      for await (const _ of service.chatStream("I like TypeScript")) {
        // consume stream to ensure generator completes
      }

      const preferences = repository.listMemories({ type: MemoryType.PREFERENCE });
      assert.ok(preferences.length >= 1, `preference memory should be committed (${preferences.length})`);
      assert.ok(preferences.some((p) => p.content.includes("TypeScript")), "TypeScript preference should be stored");

      service.close();
    });

    it("chat() awaits memory extraction before returning", async () => {
      const aiClient = new StreamTrackingAiClient();
      const { service, repository } = createService(aiClient);

      const result = await service.chat("I like Python");

      assert.ok(result.reply.length > 0, "reply should be non-empty");
      const preferences = repository.listMemories({ type: MemoryType.PREFERENCE });
      assert.ok(preferences.length >= 1, `preference memory should be committed (${preferences.length})`);

      service.close();
    });

    it("pipeline result includes created memories", async () => {
      const repoDir = mkdtempSync(join(tmpdir(), "arcon-pipeline-"));
      const repository = new MemoryRepository(join(repoDir, "memories.sqlite"));
      const pipeline = new MemoryPipeline(repository);

      const result: PipelineResult = await pipeline.processCandidates([
        {
          type: MemoryType.PREFERENCE,
          content: "User likes TypeScript",
          confidenceScore: 0.95,
          importanceScore: 7,
          sourceType: MemorySourceType.INFERRED,
          reasoning: "test",
        },
      ]);

      assert.ok(result.created >= 1, `should create memory, got ${result.created}`);
      assert.ok(result.createdMemories.length >= 1, "should have memory objects");
      assert.ok(result.pendingConfirmations.length === 0, "no pending confirmations");

      const retrieved = repository.listMemories({ type: MemoryType.PREFERENCE });
      assert.equal(retrieved.length, 1);
      assert.equal(retrieved[0].status, MemoryStatus.ACTIVE);

      repository.close();
    });
  });

  describe("Memory commit is verifiable in SQLite", () => {
    it("memory is persisted in SQLite after chatStream returns", async () => {
      const aiClient = new StreamTrackingAiClient();
      const { service, dbPath, conversationDb } = createService(aiClient);

      const beforeMemories = countMemoriesInDb(dbPath);
      const beforeMessages = countMessagesInDb(conversationDb);

      for await (const _ of service.chatStream("I like reading")) {
        // consume stream to ensure generator completes
      }

      const afterMemories = countMemoriesInDb(dbPath);
      const afterMessages = countMessagesInDb(conversationDb);

      assert.ok(afterMemories > beforeMemories, `memory should be committed (${beforeMemories} -> ${afterMemories})`);
      assert.ok(afterMessages > beforeMessages, `messages should be persisted (${beforeMessages} -> ${afterMessages})`);

      service.close();
    });

    it("committed memory is retrievable on next turn", async () => {
      const aiClient = new StreamTrackingAiClient();
      const { service, repository } = createService(aiClient);

      await service.chat("My name is Vedant");
      await service.chat("I like buttermilk");

      const preferences = repository.listMemories({ type: MemoryType.PREFERENCE });
      assert.ok(preferences.some((p) => p.content.includes("buttermilk")), "buttermilk preference should be stored");

      service.close();
    });
  });

  describe("Extraction failure handling", () => {
    it("chatStream suppresses memory extraction failure", async () => {
      let extractionCallCount = 0;
      const extractionFailingClient: AiClient = {
        async generateReply(messages: ChatMessage[]): Promise<string> {
          extractionCallCount++;
          if (extractionCallCount === 1) {
            throw new Error("EXTRACTION_FAILED");
          }
          return "reply";
        },
      };

      const { service } = createService(extractionFailingClient);

      let threw = false;
      try {
        for await (const _ of service.chatStream("I like cooking")) {
          // consume
        }
      } catch {
        threw = true;
      }

      assert.ok(!threw, "chatStream should suppress extraction failure");
      service.close();
    });

    it("chat propagates memory extraction failure", async () => {
      let callCount = 0;
      const client: AiClient = {
        async generateReply(messages: ChatMessage[]): Promise<string> {
          callCount++;
          if (callCount === 1) {
            throw new Error("EXTRACTION_FAILED");
          }
          return `reply to: ${messages[messages.length - 1]?.content ?? ""}`;
        },
      };
      const { service } = createService(client);

      let threw = false;
      let errorMsg = "";
      try {
        await service.chat("Tell me about your day");
      } catch (error) {
        threw = true;
        errorMsg = error instanceof Error ? error.message : String(error);
      }

      assert.ok(threw, "chat should propagate extraction failure");
      assert.ok(errorMsg.includes("EXTRACTION_FAILED"), `error should indicate extraction failure: ${errorMsg}`);
      assert.ok(callCount >= 1, "extraction should have been attempted");

      service.close();
    });
  });

  describe("Timeout handling", () => {
    it("inference timeout is propagated as an error", async () => {
      let callCount = 0;
      const timeoutClient: AiClient = {
        async generateReply(_messages: ChatMessage[]): Promise<string> {
          callCount++;
          if (callCount === 1) {
            return "extracted";
          }
          return new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error("INFERENCE_TIMEOUT")), 200);
          });
        },
      };
      const { service } = createService(timeoutClient);

      let threw = false;
      let errorMsg = "";
      try {
        await service.chat("Hello");
      } catch (error) {
        threw = true;
        errorMsg = error instanceof Error ? error.message : String(error);
      }

      assert.ok(threw, "should throw on timeout");
      assert.ok(
        errorMsg.includes("TIMEOUT") || errorMsg.includes("timeout"),
        `error should indicate timeout: ${errorMsg}`,
      );

      service.close();
    });
  });

  describe("Early stream cancellation", () => {
    it("cancelling a stream leaves the service usable", async () => {
      const aiClient = new StreamTrackingAiClient();
      const { service } = createService(aiClient);

      let chunksReceived = 0;
      for await (const _ of service.chatStream("I like reading")) {
        chunksReceived++;
        if (chunksReceived >= 2) {
          break;
        }
      }

      assert.ok(chunksReceived >= 2, "should receive at least 2 chunks before cancel");

      const result = await service.chat("I like writing");
      assert.ok(result.reply.length > 0, "service should still work after cancellation");

      service.close();
    });
  });

  describe("Capability recall pattern safety", () => {
    it("self_identity pattern does not match opinion questions", () => {
      const recall = new CapabilityRecall({
        version: "0.2.0",
        generatedAt: new Date().toISOString(),
        identity: DEFAULT_RUNTIME_IDENTITY,
        capabilities: buildRuntimeCapabilities({
          identity: DEFAULT_RUNTIME_IDENTITY,
          hasPersistentMemory: true,
          hasConversationPersistence: true,
          hasVoice: false,
          hasWebAccess: false,
          hasComputerControl: false,
          hasBackgroundProcessing: false,
          hasVectorSearch: false,
          hasToolCalling: false,
          hasStreaming: true,
        }),
        status: "degraded",
      });

      const opinionResult = recall.handleMessage("What do you think about yourself?");
      assert.equal(opinionResult.reply, null, "opinion questions must not short-circuit");
      assert.equal(opinionResult.category, "unknown");

      const selfResult = recall.handleMessage("Who are you?");
      assert.ok(selfResult.reply !== null, "self-identity questions should short-circuit");
      assert.equal(selfResult.category, "self_identity");
    });

    it("memory pattern does not match personal preference questions", () => {
      const recall = new CapabilityRecall({
        version: "0.2.0",
        generatedAt: new Date().toISOString(),
        identity: DEFAULT_RUNTIME_IDENTITY,
        capabilities: buildRuntimeCapabilities({
          identity: DEFAULT_RUNTIME_IDENTITY,
          hasPersistentMemory: true,
          hasConversationPersistence: true,
          hasVoice: false,
          hasWebAccess: false,
          hasComputerControl: false,
          hasBackgroundProcessing: false,
          hasVectorSearch: false,
          hasToolCalling: false,
          hasStreaming: true,
        }),
        status: "degraded",
      });

      const opinionResult = recall.handleMessage("What hobbies do you enjoy?");
      assert.equal(opinionResult.reply, null);
      assert.equal(opinionResult.category, "unknown");

      const memResult = recall.handleMessage("Can you remember things across conversations?");
      assert.ok(memResult.reply !== null);
      assert.equal(memResult.category, "memory");
    });
  });
});
