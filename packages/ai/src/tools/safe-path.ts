import { resolve, normalize, sep } from "node:path";

export interface SafePathResult {
  safe: boolean;
  resolved?: string;
  reason?: string;
}

export function resolveSafePath(inputPath: string, allowedRoots: string[]): SafePathResult {
  if (!inputPath || typeof inputPath !== "string") {
    return { safe: false, reason: "Path is required" };
  }

  if (inputPath.includes("\0")) {
    return { safe: false, reason: "Path contains null bytes" };
  }

  const normalized = normalize(inputPath);
  const absolute = resolve(normalized);

  for (const root of allowedRoots) {
    const resolvedRoot = resolve(root);
    const rootWithSep = resolvedRoot + sep;
    if (absolute === resolvedRoot || absolute.startsWith(rootWithSep)) {
      return { safe: true, resolved: absolute };
    }
  }

  return { safe: false, reason: `Path '${inputPath}' is outside allowed directories` };
}
