import { z } from 'zod';
import { removeTag } from '../primitives/tagOps.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ok, fail } from './toolResult.js';

export const schema = z.object({
  id: z.string().optional().describe("Tag id (takes precedence over path)"),
  path: z.string().optional().describe("Tag name or path"),
  force: z.boolean().optional().describe("Remove even if still assigned (items keep existing, lose the tag)")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await removeTag(args);
    if (!result.success) return fail(`Failed to remove tag: ${result.error}`);
    const untagged = result.untagged ? `; removed from ${result.untagged} items` : '';
    return ok(`Removed tag "${result.name}"${untagged} (id: ${result.tagId})`);
  } catch (err: unknown) {
    return fail(`Error removing tag: ${(err as Error).message}`);
  }
}
