import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  escapeAppleScriptString,
  escapeForJsonInAppleScript,
  generateFolderLookupScript,
  JSON_ESCAPE_HANDLER,
} from '../../utils/appleScriptHelpers.js';
import { runOsascriptFile } from '../../utils/scriptExecution.js';

export interface CreateFolderParams {
  name: string;
  parentFolderName?: string; // Name or path (e.g. "Work/Engineering") of an existing folder to nest the new folder under
  parentFolderID?: string;   // ID of an existing folder to nest the new folder under (takes precedence over parentFolderName)
}

/**
 * Generate pure AppleScript for folder creation
 */
export function generateAppleScript(params: CreateFolderParams): string {
  const name = escapeAppleScriptString(params.name);

  // Resolve the parent folder (by id or name/path) when nesting is requested.
  let parentLookup = '';
  let creationTarget = 'make new folder with properties {name:"' + name + '"}';

  if (params.parentFolderID) {
    const parentId = escapeAppleScriptString(params.parentFolderID);
    // escapeForJsonInAppleScript for the JSON payload — an AppleScript-escaped
    // quote would re-materialize raw inside the JSON and corrupt it (#103).
    const errorJson = `{\\\"success\\\":false,\\\"error\\\":\\\"Parent folder not found: ${escapeForJsonInAppleScript(params.parentFolderID)}\\\"}`;
    parentLookup = `
        set parentFolder to missing value
        try
          set parentFolder to first flattened folder whose id is "${parentId}"
        end try
        if parentFolder is missing value then
          return "${errorJson}"
        end if`;
    creationTarget = 'make new folder with properties {name:"' + name + '"} at end of folders of parentFolder';
  } else if (params.parentFolderName) {
    const errorJson = `{\\\"success\\\":false,\\\"error\\\":\\\"Parent folder not found: ${escapeForJsonInAppleScript(params.parentFolderName)}\\\"}`;
    parentLookup = `
        ${generateFolderLookupScript(params.parentFolderName, 'parentFolder', errorJson)}`;
    creationTarget = 'make new folder with properties {name:"' + name + '"} at end of folders of parentFolder';
  }

  const script = JSON_ESCAPE_HANDLER + `
  try
    tell application "OmniFocus"
      tell front document
        ${parentLookup}
        set newFolder to ${creationTarget}
        set folderId to id of newFolder as string
        -- The name is deliberately NOT echoed: the caller already knows it, and
        -- splicing it into hand-built JSON is how quotes corrupted payloads (#103).
        return "{\\\"success\\\":true,\\\"folderId\\\":\\"" & folderId & "\\"}"
      end tell
    end tell
  on error errorMessage
    return "{\\\"success\\\":false,\\\"error\\\":\\"" & my jsonEscape(errorMessage) & "\\"}"
  end try
  `;

  return script;
}

/**
 * Create a folder in OmniFocus
 */
export async function createFolder(params: CreateFolderParams): Promise<{success: boolean, folderId?: string, name?: string, error?: string}> {
  let tempFile: string | undefined;

  try {
    const script = generateAppleScript(params);

    tempFile = join(tmpdir(), `create_folder_${crypto.randomUUID()}.applescript`);
    writeFileSync(tempFile, script, { encoding: 'utf8' });

    const { stdout, stderr } = await runOsascriptFile(tempFile);

    try { unlinkSync(tempFile); } catch {}

    if (stderr) {
      console.error("AppleScript stderr:", stderr);
    }

    try {
      const result = JSON.parse(stdout);
      return {
        success: result.success,
        folderId: result.folderId,
        // The script does not echo the name (#103); the caller's input is the
        // authoritative value anyway.
        name: result.success ? params.name : undefined,
        error: result.error
      };
    } catch (parseError) {
      console.error("Error parsing AppleScript result:", parseError);
      return {
        success: false,
        error: `Failed to parse result: ${stdout}`
      };
    }
  } catch (error: any) {
    if (tempFile) {
      try { unlinkSync(tempFile); } catch {}
    }

    console.error("Error in createFolder:", error);
    return {
      success: false,
      error: error?.message || "Unknown error in createFolder"
    };
  }
}
