import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { resolveSafePath } from "./safe-path.js";
import { isBlockedFile } from "./blocked-files.js";
import type { Tool, ToolContext, ToolResult } from "./tool.js";

export interface ListDirectoryToolOptions {
  allowedRoots: string[];
  maxEntries?: number;
  maxOutputBytes?: number;
}

export function createListDirectoryTool(options: ListDirectoryToolOptions): Tool {
  const maxEntries = options.maxEntries ?? 200;
  const maxOutputBytes = options.maxOutputBytes ?? 65536;

  return {
    name: "list_directory",
    description: "Use to list files in a directory. Requires a path within an allowed root. Returns entries labeled as file or directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list. Must be within an allowed root." },
      },
      required: ["path"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const rawPath = input.path as string | undefined;
      if (!rawPath || typeof rawPath !== "string") {
        return { success: false, toolName: "list_directory", status: "error", error: "Missing or invalid path", code: "VALIDATION_ERROR", durationMs: 0 };
      }

      const pathCheck = resolveSafePath(rawPath, options.allowedRoots);
      if (!pathCheck.safe || !pathCheck.resolved) {
        return { success: false, toolName: "list_directory", status: "error", error: pathCheck.reason ?? "Path outside allowed directories", code: "PATH_DENIED", durationMs: 0 };
      }

      const targetPath = pathCheck.resolved;

      let entries: string[];
      try {
        entries = readdirSync(targetPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, toolName: "list_directory", status: "error", error: `Cannot read directory: ${message}`, code: "READ_ERROR", durationMs: 0 };
      }

      if (entries.length > maxEntries) {
        entries = entries.slice(0, maxEntries);
        context.logger.warn(`list_directory: truncated ${maxEntries} entries`, { path: targetPath });
      }

      const lines = entries.map((name) => {
        const fullPath = join(targetPath, name);
        let type = "file";
        try {
          const stat = listStatSync(fullPath);
          type = stat?.isDirectory() ? "directory" : stat?.isFile() ? "file" : "other";
        } catch {
          type = "unknown";
        }
        return `${type}: ${name}`;
      });

      const output = lines.join("\n");
      if (Buffer.byteLength(output, "utf8") > maxOutputBytes) {
        const truncated = output.slice(0, maxOutputBytes);
        context.logger.warn("list_directory: truncated output by byte limit", { path: targetPath });
        return {
          success: true,
          toolName: "list_directory",
          status: "success",
          output: { entries: truncated, truncated: true, totalEntries: lines.length, maxEntries, allowedRoot: targetPath },
          durationMs: 0,
        };
      }

      return {
        success: true,
        toolName: "list_directory",
        status: "success",
        output: { entries: output, totalEntries: lines.length, allowedRoot: targetPath },
        durationMs: 0,
      };
    },
  };
}

function listStatSync(path: string): { isDirectory: () => boolean; isFile: () => boolean } | null {
  try {
    const stats = statSync(path);
    return { isDirectory: () => stats.isDirectory(), isFile: () => stats.isFile() };
  } catch {
    return null;
  }
}
