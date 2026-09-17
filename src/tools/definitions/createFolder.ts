import { z } from 'zod';
import { createFolder } from '../primitives/createFolder.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ok, fail } from './toolResult.js';

export const schema = z.object({
  name: z.string().describe("Name of the folder to create"),
  parentFolderName: z.string().optional().describe("Parent folder name or path (e.g. \"Work/Engineering\"). Ignored if parentFolderID is provided."),
  parentFolderID: z.string().optional().describe("Parent folder ID. Takes precedence over parentFolderName."),
  allowDuplicate: z.boolean().optional().describe("Create even if a sibling folder has this name (default: return the existing one)")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await createFolder(args);
    if (!result.success) return fail(`Failed to create folder: ${result.error}`);
    const parent = args.parentFolderID ?? args.parentFolderName;
    const location = parent ? ` under "${parent}"` : '';
    return result.existed
      ? ok(`Folder "${result.name}"${location} already exists; nothing created (id: ${result.folderId})`)
      : ok(`Created folder "${result.name}"${location} (id: ${result.folderId})`);
  } catch (err: unknown) {
    return fail(`Error creating folder: ${(err as Error).message}`);
  }
}
