import type { Tool, ToolInputSchema, ToolResult, ToolResultStatus } from "./tool.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

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
