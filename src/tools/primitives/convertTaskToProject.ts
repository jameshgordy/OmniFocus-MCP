import { runOmniJs, OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJs.js';

export interface ConvertTaskToProjectParams {
  taskId: string;
  folderName?: string; // Destination folder name or path; top level when omitted
}

export interface ConvertTaskToProjectResult {
  success: boolean;
  projectId?: string;
  name?: string;
  error?: string;
}

/**
 * The task's subtasks become the project's actions; note, dates, flag and tags
 * carry over (OmniFocus's own "Convert to Project"). The returned id is the
 * project's root-task id, the form edit_item and remove_item accept.
 */
export const CONVERT_TASK_TO_PROJECT_BODY = `${OMNIJS_LOOKUP_HELPERS}
      const task = Task.byIdentifier(params.taskId);
      if (!task) throw new Error('Task not found: ' + params.taskId);
      if (task.project) throw new Error('Item is already a project');
      if (task.completed || task.taskStatus === Task.Status.Dropped) throw new Error('Cannot convert a completed or dropped task');
      const dest = params.folderName ? findFolder({ path: params.folderName }).ending : library.ending;
      const converted = convertTasksToProjects([task], dest);
      const project = converted[0];
      return { success: true, projectId: project.task.id.primaryKey, name: project.name };
`;

export async function convertTaskToProject(params: ConvertTaskToProjectParams): Promise<ConvertTaskToProjectResult> {
  if (!params.taskId) return { success: false, error: 'taskId must be provided' };
  try {
    return await runOmniJs<ConvertTaskToProjectResult>(CONVERT_TASK_TO_PROJECT_BODY, params, { write: true });
  } catch (error: any) {
    return { success: false, error: error?.message || 'Unknown error in convertTaskToProject' };
  }
}
