import type { Tool } from "./tools/tool.js";
import type { RuntimeIdentity } from "./runtime-identity.js";
import type { RuntimeCapabilities } from "./runtime-capabilities.js";
import type { ToolExecutorLike } from "./tools/tool-call.js";
import type { ToolRegistryLike } from "./tools/tool-call.js";
import type { AiClient } from "@arcon/shared";

export interface RuntimeDiagnostics {
  registeredTools: Array<{ name: string; description: string; requiredArgs: string[] }>;
  modelProviderStatus: "healthy" | "degraded" | "unknown";
  modelIdentity: RuntimeIdentity | null;
  toolCallingEnabled: boolean;
  toolExecutorConfigured: boolean;
  lastToolLoopIterations: number;
  lastToolLoopLatencyMs: number;
  lastResponseLatencyMs: number;
  totalToolCallsExecuted: number;
  totalToolErrors: number;
  totalValidationErrors: number;
  totalTimeouts: number;
  capabilities: RuntimeCapabilities | null;
  timestamp: string;
  toolStats?: ToolStats[];
}

export interface ToolStats {
  name: string;
  calls: number;
  errors: number;
  lastLatencyMs: number;
}

export interface DiagnosticOptions {
  registry?: ToolRegistryLike;
  executor?: ToolExecutorLike;
  aiClient?: AiClient;
  runtimeIdentity?: RuntimeIdentity;
  runtimeCapabilities?: RuntimeCapabilities;
  lastToolLoopIterations?: number;
  lastToolLoopLatencyMs?: number;
  lastResponseLatencyMs?: number;
  totalToolCallsExecuted?: number;
  totalToolErrors?: number;
  totalValidationErrors?: number;
  totalTimeouts?: number;
  toolStats?: ToolStats[];
  registeredTools?: Array<{ name: string; description: string; requiredArgs: string[] }>;
}

export async function getRuntimeDiagnostics(options: DiagnosticOptions): Promise<RuntimeDiagnostics> {
  const registry = options.registry;
  const executor = options.executor;
  const aiClient = options.aiClient;

  let providerStatus: "healthy" | "degraded" | "unknown" = "unknown";
  if (aiClient && "healthCheck" in aiClient && typeof (aiClient as { healthCheck: () => Promise<boolean> }).healthCheck === "function") {
    try {
      const healthy = await (aiClient as { healthCheck: () => Promise<boolean> }).healthCheck();
      providerStatus = healthy ? "healthy" : "degraded";
    } catch {
      providerStatus = "degraded";
    }
  }

  let modelIdentity: RuntimeIdentity | null = options.runtimeIdentity ?? null;
  if (!modelIdentity && aiClient && "getRuntimeIdentity" in aiClient && typeof (aiClient as { getRuntimeIdentity: () => Promise<RuntimeIdentity> }).getRuntimeIdentity === "function") {
    try {
      modelIdentity = await (aiClient as { getRuntimeIdentity: () => Promise<RuntimeIdentity> }).getRuntimeIdentity();
    } catch {
      modelIdentity = null;
    }
  }

  let capabilities: RuntimeCapabilities | null = options.runtimeCapabilities ?? null;

  const registeredTools = options.registeredTools
    ?? (registry
      ? registry.list().map((tool) => ({
          name: tool.name,
          description: tool.description,
          requiredArgs: tool.inputSchema.required ?? [],
        }))
      : []);

  return {
    registeredTools,
    modelProviderStatus: providerStatus,
    modelIdentity,
    toolCallingEnabled: (options.lastToolLoopIterations ?? 0) > 0,
    toolExecutorConfigured: executor !== undefined,
    lastToolLoopIterations: options.lastToolLoopIterations ?? 0,
    lastToolLoopLatencyMs: options.lastToolLoopLatencyMs ?? 0,
    lastResponseLatencyMs: options.lastResponseLatencyMs ?? 0,
    totalToolCallsExecuted: options.totalToolCallsExecuted ?? 0,
    totalToolErrors: options.totalToolErrors ?? 0,
    totalValidationErrors: options.totalValidationErrors ?? 0,
    totalTimeouts: options.totalTimeouts ?? 0,
    capabilities,
    timestamp: new Date().toISOString(),
    toolStats: options.toolStats,
  };
}

export function formatDiagnostics(diagnostics: RuntimeDiagnostics): string {
  const lines: string[] = [
    "=== Arcon Runtime Diagnostics ===",
    `Timestamp: ${diagnostics.timestamp}`,
    `Model Provider: ${diagnostics.modelProviderStatus}`,
    `Tool Calling Enabled: ${diagnostics.toolCallingEnabled}`,
    `Tool Executor Configured: ${diagnostics.toolExecutorConfigured}`,
    "",
    "Model Identity:",
    diagnostics.modelIdentity
      ? [
          `  Base Model: ${diagnostics.modelIdentity.baseModel}`,
          `  Adapter: ${diagnostics.modelIdentity.adapterName} (${diagnostics.modelIdentity.adapterVersion})`,
          `  Active: ${diagnostics.modelIdentity.adapterActive ? "yes" : "no"}`,
          `  Backend: ${diagnostics.modelIdentity.inferenceBackend}`,
        ].join("\n")
      : "  Not available",
    "",
    `Tool Loop Stats: iterations=${diagnostics.lastToolLoopIterations} latency=${diagnostics.lastToolLoopLatencyMs}ms totalCalls=${diagnostics.totalToolCallsExecuted} errors=${diagnostics.totalToolErrors} validationErrors=${diagnostics.totalValidationErrors} timeouts=${diagnostics.totalTimeouts}`,
    `Response Latency: ${diagnostics.lastResponseLatencyMs}ms`,
    "",
    `Registered Tools (${diagnostics.registeredTools.length}):`,
  ];

  if (diagnostics.toolStats && diagnostics.toolStats.length > 0) {
    lines.push("", "Tool Statistics:");
    for (const stat of diagnostics.toolStats) {
      lines.push(`  - ${stat.name}: calls=${stat.calls} errors=${stat.errors} lastLatency=${stat.lastLatencyMs}ms`);
    }
  }

  for (const tool of diagnostics.registeredTools) {
    const args = tool.requiredArgs.length > 0 ? ` [${tool.requiredArgs.join(", ")}]` : "";
    lines.push(`  - ${tool.name}${args}: ${tool.description}`);
  }

  if (diagnostics.capabilities) {
    lines.push("", "Capabilities:");
    for (const cap of diagnostics.capabilities.capabilities) {
      lines.push(`  - ${cap.name}: ${cap.status}${cap.notes ? ` (${cap.notes})` : ""}`);
    }
  }

  return lines.join("\n");
}
