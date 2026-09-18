import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Make every registered tool refuse unrecognized argument keys.
 *
 * `server.tool()` wraps each shape in a plain `z.object`, which silently strips
 * unknown keys before the handler runs. That is how `edit_item` called with
 * `note` instead of `newNote` reported "updated successfully" for a write that
 * never happened: the typo was dropped and the handler saw nothing to change.
 * A wrong field name should fail loudly, with the key named in the error, on
 * every tool — not only on the one that happened to bite.
 *
 * The SDK offers no public way to pass a strict object to `tool()`, so this
 * reaches into `_registeredTools` and swaps each `inputSchema` for its
 * `.strict()` form. `buildServer.test.ts` drives a real client through the
 * result; an SDK bump that renames the field turns the test red rather than
 * quietly restoring the silent-strip behavior.
 */
export function rejectUnknownArguments(server: McpServer): void {
  const registered = (server as unknown as { _registeredTools?: Record<string, { inputSchema?: unknown }> })._registeredTools;
  if (!registered) return;
  for (const tool of Object.values(registered)) {
    if (tool.inputSchema instanceof z.ZodObject) {
      tool.inputSchema = deepStrict(tool.inputSchema);
    }
  }
}

/**
 * `.strict()` does not recurse. A typo inside a nested object — `filters:
 * {inInbox: true}` where the filter is named `inbox` — was still stripped
 * after the top-level patch, and the query ran unfiltered and reported the
 * whole database as the answer. Rebuild the schema so every object at any
 * depth (through optional/nullable/default wrappers, arrays, and unions) is
 * strict.
 */
export function deepStrict<T extends z.ZodTypeAny>(schema: T): T {
  // Each branch rebuilds from the existing `_def` so descriptions, defaults and
  // constraints (array min/max, etc.) ride along unchanged; only the shape or
  // inner type is replaced.
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      shape[key] = deepStrict(value);
    }
    return new z.ZodObject({ ...schema._def, shape: () => shape, unknownKeys: 'strict' }) as unknown as T;
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
    const Ctor = schema.constructor as new (def: any) => T;
    return new Ctor({ ...schema._def, innerType: deepStrict(schema._def.innerType) });
  }
  if (schema instanceof z.ZodArray) {
    return new z.ZodArray({ ...schema._def, type: deepStrict(schema._def.type) }) as unknown as T;
  }
  if (schema instanceof z.ZodUnion) {
    const options = (schema._def.options as z.ZodTypeAny[]).map(deepStrict);
    return new z.ZodUnion({ ...schema._def, options }) as unknown as T;
  }
  return schema;
}
