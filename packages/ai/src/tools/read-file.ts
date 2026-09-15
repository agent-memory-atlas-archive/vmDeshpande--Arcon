import { readFileSync, statSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { resolveSafePath } from "./safe-path.js";
import { isBlockedFile } from "./blocked-files.js";
import type { Tool, ToolContext, ToolResult } from "./tool.js";

export interface ReadFileToolOptions {
  allowedRoots: string[];
  maxFileSizeBytes?: number;
}

const BINARY_THRESHOLD = 8192;
const DEFAULT_MAX_FILE_SIZE = 1048576;

export function createReadFileTool(options: ReadFileToolOptions): Tool {
  const maxFileSize = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;

  return {
    name: "read_file",
    description: "Read-only file access. Restricted to approved directories. Prevents path traversal and blocks sensitive files.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read. Must be within an allowed root." },
      },
      required: ["path"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const rawPath = input.path as string | undefined;
      if (!rawPath || typeof rawPath !== "string") {
        return { success: false, toolName: "read_file", status: "error", error: "Missing or invalid path", code: "VALIDATION_ERROR", durationMs: 0 };
      }

      const pathCheck = resolveSafePath(rawPath, options.allowedRoots);
      if (!pathCheck.safe || !pathCheck.resolved) {
        return { success: false, toolName: "read_file", status: "error", error: pathCheck.reason ?? "Path outside allowed directories", code: "PATH_DENIED", durationMs: 0 };
      }

      const filePath = pathCheck.resolved;

      const blockCheck = isBlockedFile(filePath);
      if (blockCheck.blocked) {
        context.logger.warn("read_file: blocked sensitive file", { path: filePath });
        return { success: false, toolName: "read_file", status: "error", error: blockCheck.reason, code: "BLOCKED", durationMs: 0 };
      }

      let fileSize: number;
      try {
        fileSize = statSync(filePath)?.size ?? 0;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, toolName: "read_file", status: "error", error: `Cannot stat file: ${message}`, code: "READ_ERROR", durationMs: 0 };
      }

      if (fileSize > maxFileSize) {
        return { success: false, toolName: "read_file", status: "error", error: `File too large: ${fileSize} bytes (max: ${maxFileSize})`, code: "FILE_TOO_LARGE", durationMs: 0 };
      }

      if (fileSize === 0) {
        return { success: true, toolName: "read_file", status: "success", output: { content: "", byteSize: 0, filePath }, durationMs: 0 };
      }

      let buffer: Buffer;
      try {
        buffer = readFileSync(filePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, toolName: "read_file", status: "error", error: `Cannot read file: ${message}`, code: "READ_ERROR", durationMs: 0 };
      }

      if (buffer.length > maxFileSize) {
        return { success: false, toolName: "read_file", status: "error", error: `File too large after read: ${buffer.length} bytes`, code: "FILE_TOO_LARGE", durationMs: 0 };
      }

      const hasNullByte = buffer.indexOf(0) !== -1;
      const ext = extname(filePath).toLowerCase();
      const textExtensions = [".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx", ".py", ".yaml", ".yml", ".xml", ".html", ".css", ".toml", ".ini", ".cfg", ".log", ".csv"];
      const isLikelyText = textExtensions.includes(ext) || !hasNullByte;

      if (hasNullByte && !textExtensions.includes(ext)) {
        return { success: true, toolName: "read_file", status: "success", output: { content: `[binary file: ${filePath}] byteSize: ${buffer.length}`, byteSize: buffer.length, filePath, binary: true }, durationMs: 0 };
      }

      let content: string;
      try {
        content = buffer.toString("utf8");
      } catch {
        content = buffer.toString("latin1");
      }

      if (content.length > maxFileSize * 2) {
        return { success: true, toolName: "read_file", status: "success", output: { content: content.slice(0, maxFileSize * 2), byteSize: buffer.length, filePath, truncated: true }, durationMs: 0 };
      }

      return { success: true, toolName: "read_file", status: "success", output: { content, byteSize: buffer.length, filePath }, durationMs: 0 };
    },
  };
}
