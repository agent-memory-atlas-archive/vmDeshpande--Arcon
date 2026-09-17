export const BLOCKED_FILE_PATTERNS: string[] = [
  ".env",
  ".env.",
  ".envrc",
  "_env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.staging",
  ".env.test",
  "credentials",
  "credential",
  "private",
  "secret",
  ".pem",
  ".key",
  ".ppk",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
  ".truststore",
  ".id_rsa",
  ".ssh",
  ".gnupg",
  ".netrc",
  ".npmrc",
  ".yarnrc",
  "token",
  "tokens",
  "api_key",
  "apikey",
  "access_key",
  "secret_key",
  "auth",
  ".htpasswd",
  ".gitignore",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

export function isBlockedFile(filePath: string): { blocked: true; reason: string } | { blocked: false } {
  const lowerPath = filePath.toLowerCase();
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const lowerName = fileName.toLowerCase();

  for (const pattern of BLOCKED_FILE_PATTERNS) {
    const lowerPattern = pattern.toLowerCase();
    if (lowerName === lowerPattern) {
      return { blocked: true, reason: `Blocked sensitive file: ${fileName}` };
    }
    if (lowerName.startsWith(lowerPattern + ".")) {
      return { blocked: true, reason: `Blocked sensitive file pattern: ${fileName}` };
    }
    if (lowerPattern.startsWith(".")) {
      if (lowerName.endsWith(lowerPattern) && lowerName.length > lowerPattern.length) {
        return { blocked: true, reason: `Blocked sensitive file: ${fileName}` };
      }
      if (lowerName === lowerPattern.slice(1)) {
        return { blocked: true, reason: `Blocked sensitive file: ${fileName}` };
      }
    }
  }

  if (lowerName.startsWith(".") && lowerName !== ".git" && lowerName !== ".vscode") {
    return { blocked: true, reason: `Blocked hidden file: ${fileName}` };
  }

  return { blocked: false };
}
