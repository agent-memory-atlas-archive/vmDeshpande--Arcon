import type {
  ModelProvider,
  ModelDiagnostics,
  ModelStatus,
} from "../model-provider.js";
import type { AiClient, ChatMessage } from "@arcon/shared";

export interface Ling3TinyProviderOptions {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

interface LingHealthResponse {
  status: string;
  model_loaded?: boolean;
}

interface LingModelInfoResponse {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  base_model: string;
  adapter_name: string;
  adapter_path: string;
  adapter_version: string;
  inference_backend: string;
  gpu_memory?: {
    allocated_MB: number;
    reserved_MB: number;
  };
  loaded_at?: string;
}

interface LingChatCompletionChoice {
  index: number;
  message: { role: string; content: string };
  finish_reason: string;
}

interface LingChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface LingChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: LingChatCompletionChoice[];
  usage: LingChatCompletionUsage;
}

interface LingStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { content?: string; role?: string };
    finish_reason: string | null;
  }>;
}

export class Ling3TinyProvider implements ModelProvider, AiClient {
  name = "ling3-tiny";
  modelId = "ling-tiny-q4-k-m";
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private lastHealth: boolean = false;
  private lastModelInfo: LingModelInfoResponse | null = null;

  constructor(private readonly options: Ling3TinyProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model ?? "ling-tiny-q4-k-m";
    this.modelId = this.model;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async generateReply(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        stream: false,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ling 3.0 Tiny request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as LingChatCompletionResponse;
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      throw new Error("Ling 3.0 Tiny returned an empty response");
    }

    return reply;
  }

  async *generateReplyStream(messages: ChatMessage[]): AsyncIterable<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        stream: true,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ling 3.0 Tiny stream request failed (${response.status}): ${text}`);
    }

    if (!response.body) {
      throw new Error("Ling 3.0 Tiny stream returned an empty response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          if (line === "[DONE]") break;
          if (!line.startsWith("data: ")) continue;

          let chunk: LingStreamChunk;
          try {
            chunk = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) { this.lastHealth = false; return false; }
      const data = (await response.json()) as LingHealthResponse;
      this.lastHealth = data.status === "ok";
      return this.lastHealth;
    } catch {
      this.lastHealth = false;
      return false;
    }
  }

  async getModelInfo(): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) { this.lastModelInfo = null; return null; }
      this.lastModelInfo = (await response.json()) as unknown as LingModelInfoResponse;
      return this.lastModelInfo as unknown as Record<string, unknown>;
    } catch {
      this.lastModelInfo = null;
      return null;
    }
  }

  async getRuntimeIdentity(): Promise<Record<string, unknown> | null> {
    try {
      const info = await this.getModelInfo();
      if (!info) return null;

      const typed = info as unknown as LingModelInfoResponse;
      return {
        baseModel: typed.base_model ?? "inclusionAI/Ling-3.0-tiny",
        adapterName: "none",
        adapterVersion: typed.adapter_version ?? "none",
        adapterPath: typed.adapter_path ?? "none",
        inferenceBackend: "ling3-tiny",
        adapterActive: false,
        loadedAt: typed.loaded_at ?? "",
        gpuMemoryAllocatedMB: typed.gpu_memory?.allocated_MB ?? 0,
        gpuMemoryReservedMB: typed.gpu_memory?.reserved_MB ?? 0,
      };
    } catch {
      return null;
    }
  }

  getDiagnostics(): ModelDiagnostics {
    const info = this.lastModelInfo;
    const baseModel = info?.base_model ?? "inclusionAI/Ling-3.0-tiny";
    const adapterVersion = info?.adapter_version ?? "unknown";
    const status: ModelStatus = this.lastHealth ? "ready" : "error";

    return {
      name: "ling3-tiny",
      modelId: this.model,
      baseModel,
      adapterName: "none",
      adapterVersion,
      inferenceBackend: "ling3-tiny",
      quantization: "Q4_K_M (GGUF via llama.cpp)",
      devicePlacement: "GPU (partial) + CPU",
      status,
      health: this.lastHealth,
      loadErrors: [],
      latency: {
        avgLatencyMs: 0,
        firstTokenMs: 0,
        lastRequestMs: 0,
        totalRequests: 0,
      },
    };
  }
}

export function createLing3TinyProvider(options: Ling3TinyProviderOptions): Ling3TinyProvider {
  return new Ling3TinyProvider(options);
}
