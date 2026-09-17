import { z } from 'zod';
import { removeFolder } from '../primitives/folderOps.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ok, fail } from './toolResult.js';

export const schema = z.object({
  id: z.string().optional().describe("Folder id (takes precedence over path)"),
  path: z.string().optional().describe("Folder name or path")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await removeFolder(args);
    if (!result.success) return fail(`Failed to remove folder: ${result.error}`);
    return ok(`Removed empty folder "${result.name}" (id: ${result.folderId})`);
  } catch (err: unknown) {
    return fail(`Error removing folder: ${(err as Error).message}`);
  }
}
