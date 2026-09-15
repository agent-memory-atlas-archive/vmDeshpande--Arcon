export type ModelStatus = "ready" | "degraded" | "error" | "unavailable";

export interface LatencyInfo {
  avgLatencyMs: number;
  firstTokenMs: number;
  lastRequestMs: number;
  totalRequests: number;
}

export interface ModelLoadError {
  code: string;
  message: string;
  timestamp: string;
  recoverable: boolean;
}

export interface ModelDiagnostics {
  name: string;
  modelId: string;
  baseModel: string;
  adapterName: string;
  adapterVersion: string;
  inferenceBackend: string;
  quantization: string;
  devicePlacement: string;
  status: ModelStatus;
  health: boolean;
  loadErrors: ModelLoadError[];
  latency: LatencyInfo;
  runtimeIdentity?: Record<string, unknown>;
  runtimeCapabilities?: Record<string, unknown>;
}

export interface ModelProvider {
  name: string;
  modelId: string;
  generateReply(messages: Array<{ role: string; content: string }>): Promise<string>;
  generateReplyStream?(messages: Array<{ role: string; content: string }>): AsyncIterable<string>;
  healthCheck?(): Promise<boolean>;
  getModelInfo?(): Promise<Record<string, unknown> | null>;
  getRuntimeIdentity?(): Promise<Record<string, unknown> | null>;
  getDiagnostics?(): ModelDiagnostics;
}
