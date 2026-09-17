import type { Tool, ToolInputSchema, ToolResult, ToolResultStatus } from "./tool.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const MAX_STRING_LENGTH = 100_000;

export function validateInput(schema: ToolInputSchema, input: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (schema.type !== "object") {
    return { valid: false, errors: [`Unsupported schema type: ${schema.type}`] };
  }

  const required = schema.required ?? [];
  for (const field of required) {
    if (!(field in input)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  for (const [key, value] of Object.entries(input)) {
    const prop = schema.properties[key];
    if (!prop) {
      errors.push(`Unknown field: ${key}`);
      continue;
    }

    if (typeof value === "string") {
      if (value.includes("\0")) {
        errors.push(`Field ${key}: contains null bytes`);
        continue;
      }
      if (value.length > MAX_STRING_LENGTH) {
        errors.push(`Field ${key}: exceeds maximum length of ${MAX_STRING_LENGTH} characters`);
        continue;
      }
    }

    const typeCheck = typeof value;
    const expected = prop.type;

    if (expected === "integer") {
      if (!Number.isInteger(value)) {
        errors.push(`Field ${key}: expected integer, got ${typeCheck}`);
      }
    } else if (expected === "array") {
      if (!Array.isArray(value)) {
        errors.push(`Field ${key}: expected array, got ${typeCheck}`);
      }
    } else if (expected !== typeCheck) {
      errors.push(`Field ${key}: expected ${expected}, got ${typeCheck}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
