import { z } from 'zod';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

import * as dumpDatabaseTool from './definitions/dumpDatabase.js';
import * as addOmniFocusTaskTool from './definitions/addOmniFocusTask.js';
import * as addProjectTool from './definitions/addProject.js';
import * as removeItemTool from './definitions/removeItem.js';
import * as editItemTool from './definitions/editItem.js';
import * as batchAddItemsTool from './definitions/batchAddItems.js';
import * as batchRemoveItemsTool from './definitions/batchRemoveItems.js';
import * as queryOmniFocusTool from './definitions/queryOmnifocus.js';
import * as listPerspectivesTool from './definitions/listPerspectives.js';
import * as getPerspectiveViewTool from './definitions/getPerspectiveView.js';
import * as listTagsTool from './definitions/listTags.js';
import * as createTagTool from './definitions/createTag.js';
import * as createFolderTool from './definitions/createFolder.js';
import * as editFolderTool from './definitions/editFolder.js';
import * as removeFolderTool from './definitions/removeFolder.js';
import * as editTagTool from './definitions/editTag.js';
import * as removeTagTool from './definitions/removeTag.js';
import * as batchEditItemsTool from './definitions/batchEditItems.js';
import * as convertTaskToProjectTool from './definitions/convertTaskToProject.js';
import * as getReviewSummaryTool from './definitions/getReviewSummary.js';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolEntry {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (args: any, extra: RequestHandlerExtra) => Promise<ToolResult>;
}

/**
 * The one list of OmniFocus tools. `buildServer` registers every entry with the
 * MCP server; recipe automations dispatch through the same entries, so a recipe
 * step can call exactly what a client can call, validated the same way. Adding a
 * tool here is the whole job — there is no second list to keep in sync.
 *
 * The automation tools themselves are registered separately in `buildServer`
 * and are deliberately absent: a recipe cannot run another recipe.
 */
export const TOOL_TABLE: ToolEntry[] = [
  {
    name: 'dump_database',
    description: 'Gets the current state of your OmniFocus database',
    schema: dumpDatabaseTool.schema,
    handler: dumpDatabaseTool.handler,
  },
  {
    name: 'add_omnifocus_task',
    description:
      'Create a NEW task. If a matching task already exists (e.g. in the Inbox), do NOT create a duplicate — MOVE it with edit_item + newProjectName. When unsure, check with query_omnifocus first.',
    schema: addOmniFocusTaskTool.schema,
    handler: addOmniFocusTaskTool.handler,
  },
  {
    name: 'add_project',
    description: 'Add a new project to OmniFocus',
    schema: addProjectTool.schema,
    handler: addProjectTool.handler,
  },
  {
    name: 'remove_item',
    description: 'Remove a task or project from OmniFocus',
    schema: removeItemTool.schema,
    handler: removeItemTool.handler,
  },
  {
    name: 'edit_item',
    description:
      'Edit an existing task or project. Also how you MOVE a task: set newProjectName (or "" / "inbox"). Prefer moving an existing task over re-creating it — never make duplicates.',
    schema: editItemTool.schema,
    handler: editItemTool.handler,
  },
  {
    name: 'batch_add_items',
    description: 'Add multiple tasks or projects to OmniFocus in a single operation',
    schema: batchAddItemsTool.schema,
    handler: batchAddItemsTool.handler,
  },
  {
    name: 'batch_remove_items',
    description: 'Remove multiple tasks or projects from OmniFocus in a single operation',
    schema: batchRemoveItemsTool.schema,
    handler: batchRemoveItemsTool.handler,
  },
  {
    name: 'query_omnifocus',
    description:
      'Query tasks, projects, or folders with filters (project, folder, tags, status, dates). Much faster and lighter than dump_database for targeted lookups.',
    schema: queryOmniFocusTool.schema,
    handler: queryOmniFocusTool.handler,
  },
  {
    name: 'list_perspectives',
    description: 'List built-in and custom perspectives (custom is a Pro feature)',
    schema: listPerspectivesTool.schema,
    handler: listPerspectivesTool.handler,
  },
  {
    name: 'get_perspective_view',
    description: 'Get the items visible in a named OmniFocus perspective',
    schema: getPerspectiveViewTool.schema,
    handler: getPerspectiveViewTool.handler,
  },
  {
    name: 'list_tags',
    description: 'List all tags with their hierarchy',
    schema: listTagsTool.schema,
    handler: listTagsTool.handler,
  },
  {
    name: 'create_tag',
    description: 'Create a new tag in OmniFocus, optionally nested under an existing parent tag',
    schema: createTagTool.schema,
    handler: createTagTool.handler,
  },
  {
    name: 'create_folder',
    description: 'Create a folder; returns an existing same-named sibling instead',
    schema: createFolderTool.schema,
    handler: createFolderTool.handler,
  },
  {
    name: 'edit_folder',
    description: 'Rename, move, or drop/reactivate a folder',
    schema: editFolderTool.schema,
    handler: editFolderTool.handler,
  },
  {
    name: 'remove_folder',
    description: 'Delete an empty folder',
    schema: removeFolderTool.schema,
    handler: removeFolderTool.handler,
  },
  {
    name: 'edit_tag',
    description: 'Rename, nest, or change the status of a tag',
    schema: editTagTool.schema,
    handler: editTagTool.handler,
  },
  {
    name: 'remove_tag',
    description: 'Delete a tag; refuses if in use unless force',
    schema: removeTagTool.schema,
    handler: removeTagTool.handler,
  },
  {
    name: 'batch_edit_items',
    description: 'Apply several edit_item edits in one call',
    schema: batchEditItemsTool.schema,
    handler: batchEditItemsTool.handler,
  },
  {
    name: 'convert_task_to_project',
    description: 'Convert a task into a project',
    schema: convertTaskToProjectTool.schema,
    handler: convertTaskToProjectTool.handler,
  },
  {
    name: 'get_review_summary',
    description: 'Weekly review digest: overdue, inbox, stalled, reviews due',
    schema: getReviewSummaryTool.schema,
    handler: getReviewSummaryTool.handler,
  },
];

export const TOOL_NAMES: string[] = TOOL_TABLE.map((t) => t.name);

export function findTool(name: string): ToolEntry | undefined {
  return TOOL_TABLE.find((t) => t.name === name);
}
