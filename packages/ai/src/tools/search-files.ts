import { readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { resolveSafePath } from "./safe-path.js";
import { isBlockedFile } from "./blocked-files.js";
import type { Tool, ToolContext, ToolResult } from "./tool.js";

export interface SearchFilesToolOptions {
  allowedRoots: string[];
  maxFiles?: number;
  maxResults?: number;
  maxFileSizeBytes?: number;
  timeoutMs?: number;
}

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".gitignore",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  "__pycache__",
  ".venv",
  ".idea",
  ".vscode",
]);

const EXCLUDED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".bmp",
  ".mp3",
  ".mp4",
  ".wav",
  ".zip",
  ".tar",
  ".gz",
  ".db",
  ".sqlite",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

export function createSearchFilesTool(options: SearchFilesToolOptions): Tool {
  const maxFiles = options.maxFiles ?? 1000;
  const maxResults = options.maxResults ?? 50;
  const maxFileSize = options.maxFileSizeBytes ?? 1048576;
  const timeoutMs = options.timeoutMs ?? 5000;

  return {
    name: "search_files",
    description: "Search files within approved directories. Excludes node_modules, .git, build output, and sensitive files.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring to search in filenames" },
        path: { type: "string", description: "Directory to search within. Must be within an allowed root." },
      },
      required: ["query", "path"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const rawQuery = input.query as string | undefined;
      const rawPath = input.path as string | undefined;

      if (!rawQuery || typeof rawQuery !== "string") {
        return { success: false, toolName: "search_files", status: "error", error: "Missing or invalid query", code: "VALIDATION_ERROR", durationMs: 0 };
      }
      if (!rawPath || typeof rawPath !== "string") {
        return { success: false, toolName: "search_files", status: "error", error: "Missing or invalid path", code: "VALIDATION_ERROR", durationMs: 0 };
      }

      const pathCheck = resolveSafePath(rawPath, options.allowedRoots);
      if (!pathCheck.safe || !pathCheck.resolved) {
        return { success: false, toolName: "search_files", status: "error", error: pathCheck.reason ?? "Path outside allowed directories", code: "PATH_DENIED", durationMs: 0 };
      }

      const searchRoot = pathCheck.resolved;
      const startTime = Date.now();
      const results: Array<{ path: string; size: number }> = [];
      let filesScanned = 0;

      const searchDir = (dir: string): boolean => {
        if (Date.now() - startTime > timeoutMs) {
          context.logger.warn("search_files: timeout reached", { scanned: filesScanned });
          return false;
        }

        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          return true;
        }

        for (const entry of entries) {
          if (Date.now() - startTime > timeoutMs) {
            return false;
          }

          const fullPath = join(dir, entry);
          let stat: ReturnType<typeof statSync>;
          try {
            stat = statSync(fullPath);
          } catch {
            continue;
          }

          filesScanned++;

          if (stat.isDirectory()) {
            const dirName = entry.toLowerCase();
            if (EXCLUDED_DIRS.has(dirName)) {
              continue;
            }
            if (entry.startsWith(".") && dirName !== ".git") {
              continue;
            }
            if (results.length < maxFiles) {
              searchDir(fullPath);
            }
          } else if (stat.isFile()) {
            const lowerName = entry.toLowerCase();
            const ext = entry.toLowerCase().split(".").pop() ?? "";

            if (EXCLUDED_EXTENSIONS.has("." + ext)) {
              continue;
            }

            const blockCheck = isBlockedFile(fullPath);
            if (blockCheck.blocked) {
              continue;
            }

            if (lowerName.includes(rawQuery.toLowerCase())) {
              if (stat.size > maxFileSize) {
                continue;
              }
              results.push({ path: fullPath, size: stat.size });
              if (results.length >= maxResults) {
                return false;
              }
            }
          }
        }

        return true;
      };

      searchDir(searchRoot);

      const elapsed = Date.now() - startTime;

      return {
        success: true,
        toolName: "search_files",
        status: "success",
        output: {
          results: results.map((r) => ({ path: r.path, size: r.size })),
          resultCount: results.length,
          filesScanned,
          timeout: Date.now() - startTime > timeoutMs,
          elapsedMs: elapsed,
          maxResults,
          maxFiles,
          maxFileSizeBytes: maxFileSize,
        },
        durationMs: elapsed,
      };
    },
  };
}
