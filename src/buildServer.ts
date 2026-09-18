import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SetLevelRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Logger } from './utils/logger.js';
import { setScriptLogger } from './utils/scriptExecution.js';
import { registerResources } from './resources/index.js';
import { withUpgradeNudge } from './daemon/upgradeNudge.js';

import { TOOL_TABLE } from './tools/registry.js';
import * as automationsTool from './tools/definitions/automations.js';
import { rejectUnknownArguments } from './utils/strictSchema.js';
export { rejectUnknownArguments, deepStrict } from './utils/strictSchema.js';

/**
 * Server construction, factored out of `server.ts` (issue #80).
 *
 * The stdio entrypoint needs exactly one server for the life of the process, but
 * the daemon needs a fresh one **per client connection**: an MCP session is
 * stateful (initialize handshake, negotiated capabilities, per-client log level),
 * so two clients cannot share one `McpServer`. What they *do* share — and the
 * reason the daemon is worth having — is the module-level osascript semaphore in
 * `scriptExecution.ts`. That bound is per-process, so N stdio servers allow N×4
 * concurrent osascript children against the single-threaded OmniFocus.app; one
 * daemon hosting N sessions holds it to 4 globally.
 */

// Single-source the version from package.json — the hardcoded string here
// drifted out of sync with the published version more than once. Re-exported
// from version.ts, which the daemon socket path also depends on (#99).
export { SERVER_VERSION } from "./version.js";
import { SERVER_VERSION } from "./version.js";

const INSTRUCTIONS = `OmniFocus MCP server for macOS task management.

TOOL GUIDANCE:
- Prefer query_omnifocus over dump_database for targeted lookups (85-95% context savings)
- Use the "fields" parameter to request only needed fields
- Use "summary: true" for quick counts without full data
- For batch operations, prefer batch_add_items/batch_edit_items/batch_remove_items over repeated single calls
- Use edit_item appendNote to add to a note; newNote replaces it
- For a weekly review, start with get_review_summary
- Check list_automations first for repeated actions; run_automation with a name and params is far cheaper than composing the full call. Save a recipe with save_automation when you notice yourself repeating one.

RESOURCES:
- omnifocus://inbox — current inbox items
- omnifocus://today — today's agenda (due, planned, overdue)
- omnifocus://flagged — all flagged items
- omnifocus://stats — quick database statistics
- omnifocus://project/{name} — tasks in a specific project
- omnifocus://perspective/{name} — items in a named perspective

QUERY FILTER TIPS:
- Tags filter is case-sensitive and exact match
- projectName filter is case-insensitive partial match
- Status values for tasks: Next, Available, Blocked, DueSoon, Overdue
- Status values for projects: Active, OnHold, Done, Dropped
- Use reviewDue: true filter on projects to find projects needing review
- Use edit_item with markReviewed: true to mark a project as reviewed
- Combine filters with AND logic; within arrays, OR logic applies`;

export interface BuiltServer {
  server: McpServer;
  logger: Logger;
}

/**
 * Build a fully-registered OmniFocus MCP server (tools + resources + logging).
 *
 * Caller owns the transport. Note the logger side-effect below.
 */
export function createOmniFocusServer(): BuiltServer {
  const server = new McpServer(
    { name: "OmniFocus MCP", version: SERVER_VERSION },
    { instructions: INSTRUCTIONS }
  );

  const logger = new Logger(server.server);

  // `setScriptLogger` is process-global, so with multiple concurrent daemon
  // sessions the last connection wins and script-level logs are routed to that
  // client. Acceptable: these are debug/error traces, not protocol data, and the
  // alternative (threading a logger through every script call) is a large change
  // for little gain. Per-session tool output is unaffected — it flows back
  // through each session's own transport.
  setScriptLogger(logger);

  server.server.registerCapabilities({ logging: {} });

  server.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
    logger.setLevel(request.params.level);
    logger.info("server", `Log level set to ${request.params.level}`);
    return {};
  });

  registerResources(server, logger);

  for (const tool of TOOL_TABLE) {
    server.tool(tool.name, tool.description, tool.schema.shape, withUpgradeNudge(tool.handler));
  }

  // Automations are registered outside TOOL_TABLE so a recipe cannot invoke one.
  server.tool(
    "list_automations",
    "List saved automations (recipes and scripts) and their params",
    automationsTool.listSchema.shape,
    withUpgradeNudge(automationsTool.listHandler)
  );
  server.tool(
    "run_automation",
    "Run a saved automation by name. Cheapest way to do a repeated action.",
    automationsTool.runSchema.shape,
    withUpgradeNudge(automationsTool.runHandler)
  );
  server.tool(
    "save_automation",
    "Save a recipe (JSON) or OmniJS script as a reusable automation",
    automationsTool.saveSchema.shape,
    withUpgradeNudge(automationsTool.saveHandler)
  );

  rejectUnknownArguments(server);

  return { server, logger };
}

