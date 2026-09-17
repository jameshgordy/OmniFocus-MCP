import { z } from 'zod';
import { convertTaskToProject } from '../primitives/convertTaskToProject.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ok, fail } from './toolResult.js';

export const schema = z.object({
  taskId: z.string().describe("Task id; its subtasks become the project's actions"),
  folderName: z.string().optional().describe("Destination folder name or path (top level if omitted)")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await convertTaskToProject(args);
    if (!result.success) return fail(`Failed to convert task: ${result.error}`);
    const location = args.folderName ? ` in folder "${args.folderName}"` : ' at the top level';
    return ok(`Converted to project "${result.name}"${location} (id: ${result.projectId})`);
  } catch (err: unknown) {
    return fail(`Error converting task: ${(err as Error).message}`);
  }
}
