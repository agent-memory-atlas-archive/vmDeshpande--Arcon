import { resolve, normalize, sep } from "node:path";

export interface SafePathResult {
  safe: boolean;
  resolved?: string;
  reason?: string;
}

export function resolveSafePath(inputPath: string, allowedRoots: string[]): SafePathResult {
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
