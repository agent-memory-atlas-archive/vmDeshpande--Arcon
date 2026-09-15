import type { Logger } from "./tool.js";

export { Logger };

const NO_OP_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export class ConsoleLogger implements Logger {
  info(message: string, metadata?: Record<string, unknown>): void {
    if (metadata) {
      console.info(`[INFO] ${message}`, metadata);
    } else {
      console.info(`[INFO] ${message}`);
    }
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    if (metadata) {
      console.warn(`[WARN] ${message}`, metadata);
    } else {
      console.warn(`[WARN] ${message}`);
    }
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    if (metadata) {
      console.error(`[ERROR] ${message}`, metadata);
    } else {
      console.error(`[ERROR] ${message}`);
    }
  }
}

export function createLogger(enabled: boolean): Logger {
  return enabled ? new ConsoleLogger() : NO_OP_LOGGER;
}
