import type { AiClient, ChatMessage } from "@arcon/shared";
import type { RuntimeIdentity } from "../runtime-identity.js";
import { createLogger } from "../tools/tool-logger.js";

export interface ArconLoRAProviderOptions {
  baseUrl: string;
  model?: string;
  timeoutMs?: number;
}

interface LoRAHealthResponse {
  status: string;
  model_loaded: boolean;
}

interface LoRAModelInfoResponse {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  base_model: string;
  adapter_name: string;
  adapter_path: string;
  adapter_version: string;
  inference_backend: string;
  gpu_memory: {
    allocated_MB: number;
    reserved_MB: number;
  };
  loaded_at: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

interface ToolCallFunction {
  name?: string;
  arguments?: string;
}

interface ToolCallItem {
  function?: ToolCallFunction;
}

interface ChatCompletionChoice {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: ToolCallItem[];
  };
  finish_reason?: string;
}

interface ChatCompletionResponse {
  choices: ChatCompletionChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface StreamDelta {
  content?: string;
}

interface StreamChunk {
  choices?: Array<{ delta?: StreamDelta }>;
}

export class ArconLoRAProvider implements AiClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private modelInfo: LoRAModelInfoResponse | null = null;
  private readonly logger = createLogger(false);

  constructor(private readonly options: ArconLoRAProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model ?? "arcon-v1";
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async generateReply(messages: ChatMessage[]): Promise<string>;
  async generateReply(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<string>;
  async generateReply(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<string> {
    const toolChoice = tools && tools.length > 0 ? "required" : undefined;
    const toolSchemas = tools
      ? tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema ?? { type: "object", properties: {} },
          },
        }))
      : undefined;

    this.logger.info("ArconLoRAProvider.generateReply", {
      model: this.model,
      messageCount: messages.length,
      toolCount: tools?.length ?? 0,
      toolChoice,
      toolNames: tools?.map((t) => t.name) ?? [],
    });

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
        ...(toolSchemas ? { tools: toolSchemas } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Arcon LoRA inference failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;

    const message = data.choices?.[0]?.message;
    const toolCalls = message?.tool_calls;
    const content = message?.content?.trim();
    const finishReason = data.choices?.[0]?.finish_reason;

    this.logger.info("ArconLoRAProvider.generateReply response", {
      finishReason,
      hasToolCalls: toolCalls && toolCalls.length > 0,
      toolCallCount: toolCalls?.length ?? 0,
      contentPreview: content ? content.slice(0, 500) : undefined,
    });

    if (toolCalls && toolCalls.length > 0) {
      const toolCall = toolCalls[0];
      const toolName = toolCall.function?.name;
      const toolArgs = toolCall.function?.arguments;
      this.logger.info("ArconLoRAProvider tool call detected", { toolName, toolArgs });
      if (toolName) {
        return JSON.stringify({ tool: toolName, arguments: toolArgs ? JSON.parse(toolArgs) : {} });
      }
    }

    const reply = content ?? "";
    if (!reply) {
      throw new Error("Arcon LoRA inference returned an empty response");
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
      throw new Error(`Arcon LoRA inference failed (${response.status}): ${text}`);
    }

    if (!response.body) {
      throw new Error("Arcon LoRA inference returned an empty response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6);
            if (payload.trim() === "[DONE]") {
              return;
            }

            let chunk: StreamChunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }

            const content = chunk.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
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
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as LoRAHealthResponse;
      return data.status === "ok" && data.model_loaded === true;
    } catch {
      return false;
    }
  }

  async getModelInfo(): Promise<LoRAModelInfoResponse> {
    if (this.modelInfo) {
      return this.modelInfo;
    }

    const response = await fetch(`${this.baseUrl}/v1/models`, {
      method: "GET",
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch model info (${response.status}): ${text}`);
    }

    this.modelInfo = (await response.json()) as LoRAModelInfoResponse;
    return this.modelInfo;
  }

  async getRuntimeIdentity(): Promise<RuntimeIdentity> {
    try {
      const info = await this.getModelInfo();

      return {
        baseModel: info.base_model,
        adapterName: info.adapter_name,
        adapterVersion: info.adapter_version,
        adapterPath: info.adapter_path,
        inferenceBackend: "arcon-lora",
        adapterActive: info.adapter_name !== "none" && info.adapter_path !== "none",
        loadedAt: info.loaded_at,
        gpuMemoryAllocatedMB: info.gpu_memory.allocated_MB,
        gpuMemoryReservedMB: info.gpu_memory.reserved_MB,
      };
    } catch {
      return {
        baseModel: "Qwen/Qwen3-4B",
        adapterName: this.model,
        adapterVersion: "unknown",
        adapterPath: "unknown",
        inferenceBackend: "arcon-lora",
        adapterActive: false,
        loadedAt: "",
        gpuMemoryAllocatedMB: 0,
        gpuMemoryReservedMB: 0,
      };
    }
  }

  async isAdapterActive(): Promise<boolean> {
    try {
      const identity = await this.getRuntimeIdentity();
      return identity.adapterActive;
    } catch {
      return false;
    }
  }
}

export function createArconLoRAProvider(options: ArconLoRAProviderOptions): ArconLoRAProvider {
  return new ArconLoRAProvider(options);
}
