import { z } from 'zod';
import { createFolder } from '../primitives/createFolder.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  name: z.string().describe("Name of the folder to create"),
  parentFolderName: z.string().optional().describe("Name or path (e.g. \"Work/Engineering\") of an existing folder to nest under. Ignored if parentFolderID is provided."),
  parentFolderID: z.string().optional().describe("ID of an existing folder to nest under. Takes precedence over parentFolderName.")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await createFolder({
      name: args.name,
      parentFolderName: args.parentFolderName,
      parentFolderID: args.parentFolderID
    });

    if (result.success) {
      const nested = args.parentFolderID || args.parentFolderName;
      const location = nested ? ` under "${args.parentFolderID ?? args.parentFolderName}"` : '';
      return {
        content: [{
          type: "text" as const,
          text: `Created folder "${result.name}"${location} (id: ${result.folderId})`
        }]
      };
    } else {
      return {
        content: [{
          type: "text" as const,
          text: `Failed to create folder: ${result.error}`
        }],
        isError: true
      };
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`Error creating folder: ${error.message}`);
    return {
      content: [{
        type: "text" as const,
        text: `Error creating folder: ${error.message}`
      }],
      isError: true
    };
  }
}
