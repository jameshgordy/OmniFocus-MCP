import { z } from 'zod';
import { editFolder } from '../primitives/folderOps.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ok, fail } from './toolResult.js';

export const schema = z.object({
  id: z.string().optional().describe("Folder id (takes precedence over path)"),
  path: z.string().optional().describe("Folder name or path like \"Work/Engineering\""),
  newName: z.string().optional().describe("New name"),
  newParentFolder: z.string().optional().describe("Move under this folder path; \"\" moves to top level"),
  newStatus: z.enum(['active', 'dropped']).optional().describe("New status")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await editFolder(args);
    if (!result.success) return fail(`Failed to update folder: ${result.error}`);
    return ok(`Folder "${result.name}" updated (${(result.changed ?? []).join(', ')}) (id: ${result.folderId})`);
  } catch (err: unknown) {
    return fail(`Error updating folder: ${(err as Error).message}`);
  }
}
