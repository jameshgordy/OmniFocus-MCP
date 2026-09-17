import { runOmniJs, OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJs.js';

export interface FolderRef {
  id?: string;   // Folder id (takes precedence)
  path?: string; // Folder name or path like "Work/Engineering"
}

export interface EditFolderParams extends FolderRef {
  newName?: string;
  newParentFolder?: string; // Path of the destination folder; "" moves to the top level
  newStatus?: 'active' | 'dropped';
}

export interface RemoveFolderParams extends FolderRef {}

export interface FolderOpResult {
  success: boolean;
  folderId?: string;
  name?: string;
  changed?: string[];
  error?: string;
}

export const EDIT_FOLDER_BODY = `${OMNIJS_LOOKUP_HELPERS}
      const folder = findFolder({ id: params.id, path: params.path });
      const changed = [];
      if (params.newParentFolder !== undefined) {
        if (params.newParentFolder === '') {
          moveSections([folder], library.ending);
        } else {
          const dest = findFolder({ path: params.newParentFolder });
          // Moving a folder into itself or a descendant would orphan the subtree.
          let cur = dest;
          while (cur) {
            if (cur.id.primaryKey === folder.id.primaryKey) throw new Error('Cannot move a folder into itself or one of its subfolders');
            cur = cur.parent;
          }
          moveSections([folder], dest.ending);
        }
        changed.push('parent');
      }
      if (params.newName !== undefined) { folder.name = params.newName; changed.push('name'); }
      if (params.newStatus !== undefined) {
        folder.status = params.newStatus === 'dropped' ? Folder.Status.Dropped : Folder.Status.Active;
        changed.push('status (' + params.newStatus + ')');
      }
      return { success: true, folderId: folder.id.primaryKey, name: folder.name, changed };
`;

/**
 * Deleting a folder deletes everything inside it. Refuse unless it is empty —
 * move or drop the contents first. There is deliberately no force flag.
 */
export const REMOVE_FOLDER_BODY = `${OMNIJS_LOOKUP_HELPERS}
      const folder = findFolder({ id: params.id, path: params.path });
      const projects = folder.flattenedProjects.length;
      const subfolders = folder.flattenedFolders.length;
      if (projects > 0 || subfolders > 0) {
        return { success: false, error: 'Folder is not empty (' + projects + ' projects, ' + subfolders + ' subfolders). Move or drop its contents first.' };
      }
      const name = folder.name;
      const folderId = folder.id.primaryKey;
      deleteObject(folder);
      return { success: true, folderId, name };
`;

function requireRef(ref: FolderRef): string | null {
  return ref.id || ref.path ? null : 'Either id or path must be provided';
}

export async function editFolder(params: EditFolderParams): Promise<FolderOpResult> {
  const refError = requireRef(params);
  if (refError) return { success: false, error: refError };
  if (params.newName === undefined && params.newParentFolder === undefined && params.newStatus === undefined) {
    return { success: false, error: 'Nothing to update: provide newName, newParentFolder, or newStatus' };
  }
  if (params.newName !== undefined && params.newName.trim() === '') {
    return { success: false, error: 'newName must not be empty' };
  }
  try {
    return await runOmniJs<FolderOpResult>(EDIT_FOLDER_BODY, params, { write: true });
  } catch (error: any) {
    return { success: false, error: error?.message || 'Unknown error in editFolder' };
  }
}

export async function removeFolder(params: RemoveFolderParams): Promise<FolderOpResult> {
  const refError = requireRef(params);
  if (refError) return { success: false, error: refError };
  try {
    return await runOmniJs<FolderOpResult>(REMOVE_FOLDER_BODY, params, { write: true });
  } catch (error: any) {
    return { success: false, error: error?.message || 'Unknown error in removeFolder' };
  }
}
