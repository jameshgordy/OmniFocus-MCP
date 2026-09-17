import { z } from 'zod';
import { batchEditItems } from '../primitives/batchEditItems.js';
import { EditItemParams } from '../primitives/editItem.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { schema as editItemSchema, updateFieldsProvided, UPDATE_FIELDS } from './editItem.js';

export const MAX_BATCH_EDIT_ITEMS = 100;

export const schema = z.object({
  items: z.array(editItemSchema).min(1).max(MAX_BATCH_EDIT_ITEMS).describe("Edits, each shaped like edit_item")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  // Validate the whole batch before touching OmniFocus: a malformed item found
  // halfway through would leave the batch partially applied.
  const problems = args.items.flatMap((item, i) => {
    if (!item.id && !item.name) return [`item ${i + 1}: either id or name must be provided`];
    if (updateFieldsProvided(item).length === 0) return [`item ${i + 1}: nothing to update`];
    return [];
  });
  if (problems.length > 0) {
    return {
      content: [{
        type: "text" as const,
        text: `No changes made. ${problems.join('; ')}. Accepted update fields: ${UPDATE_FIELDS.join(', ')}.`
      }],
      isError: true
    };
  }

  try {
    const results = await batchEditItems(args.items as EditItemParams[]);
    const ok = results.filter(r => r.success).length;
    const failed = results.length - ok;
    const lines = results.map((r, i) => {
      const item = args.items[i];
      if (r.success) {
        const changed = r.changedProperties ? ` (${r.changedProperties})` : '';
        return `- ✅ ${item.itemType} "${r.name}"${changed} (id: ${r.id})`;
      }
      return `- ❌ ${item.itemType} ${item.id ?? `"${item.name}"`}: ${r.error}`;
    });
    const summary = `Updated ${ok} of ${results.length} items.` + (failed ? ` ⚠️ ${failed} failed.` : '');
    return {
      content: [{ type: "text" as const, text: `${summary}\n\n${lines.join('\n')}` }],
      isError: ok === 0
    };
  } catch (err: unknown) {
    const error = err as Error;
    return {
      content: [{ type: "text" as const, text: `Error processing batch edit: ${error.message}` }],
      isError: true
    };
  }
}
