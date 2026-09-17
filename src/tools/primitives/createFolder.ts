import { runOmniJs, OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJs.js';

export interface CreateFolderParams {
  name: string;
  parentFolderName?: string; // Name or path (e.g. "Work/Engineering") of an existing folder to nest the new folder under
  parentFolderID?: string;   // ID of an existing folder to nest the new folder under (takes precedence over parentFolderName)
  allowDuplicate?: boolean;  // Create even when a sibling folder already has this name
}

export interface CreateFolderResult {
  success: boolean;
  folderId?: string;
  name?: string;
  existed?: boolean;
  error?: string;
}

/**
 * OmniJS body. Idempotent by default: a retry, or a second client repeating the
 * same request, must not produce a second identically-named sibling. The
 * existing folder is returned with `existed: true` instead.
 */
export const CREATE_FOLDER_BODY = `${OMNIJS_LOOKUP_HELPERS}
      const parent = params.parentFolderID ? findFolder({ id: params.parentFolderID })
        : params.parentFolderName ? findFolder({ path: params.parentFolderName })
        : null;
      // Top-level folders are the global \`folders\`; \`library\` mixes folders and
      // projects and has no \`folders\` property.
      const siblings = parent ? parent.folders : folders;
      if (!params.allowDuplicate) {
        const existing = siblings.find(f => f.name === params.name);
        if (existing) return { success: true, existed: true, folderId: existing.id.primaryKey };
      }
      const created = new Folder(params.name, parent ? parent.ending : library.ending);
      return { success: true, existed: false, folderId: created.id.primaryKey };
`;

export async function createFolder(params: CreateFolderParams): Promise<CreateFolderResult> {
  if (!params.name || params.name.trim() === '') {
    return { success: false, error: 'Folder name must not be empty' };
  }
  try {
    const result = await runOmniJs<CreateFolderResult>(CREATE_FOLDER_BODY, params, { write: true });
    return { ...result, name: result.success ? params.name : undefined };
  } catch (error: any) {
    console.error('Error in createFolder:', error);
    return { success: false, error: error?.message || 'Unknown error in createFolder' };
  }
}
