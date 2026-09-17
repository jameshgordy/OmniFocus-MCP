import { z } from 'zod';
import { editTag } from '../primitives/tagOps.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ok, fail } from './toolResult.js';

export const schema = z.object({
  id: z.string().optional().describe("Tag id (takes precedence over path)"),
  path: z.string().optional().describe("Tag name or path like \"Areas/Home\""),
  newName: z.string().optional().describe("New name"),
  newParentTag: z.string().optional().describe("Nest under this tag path; \"\" moves to top level"),
  newStatus: z.enum(['active', 'onHold', 'dropped']).optional().describe("New status"),
  newAllowsNextAction: z.boolean().optional().describe("Whether tagged actions can be next actions")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await editTag(args);
    if (!result.success) return fail(`Failed to update tag: ${result.error}`);
    return ok(`Tag "${result.name}" updated (${(result.changed ?? []).join(', ')}) (id: ${result.tagId})`);
  } catch (err: unknown) {
    return fail(`Error updating tag: ${(err as Error).message}`);
  }
}
