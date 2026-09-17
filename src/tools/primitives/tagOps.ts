import { runOmniJs, OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJs.js';

export interface TagRef {
  id?: string;   // Tag id (takes precedence)
  path?: string; // Tag name or path like "Areas/Home"
}

export interface EditTagParams extends TagRef {
  newName?: string;
  newParentTag?: string; // Path of the destination tag; "" moves to the top level
  newStatus?: 'active' | 'onHold' | 'dropped';
  newAllowsNextAction?: boolean;
}

export interface RemoveTagParams extends TagRef {
  force?: boolean; // Required when the tag (or a child tag) is still assigned to remaining items
}

export interface TagOpResult {
  success: boolean;
  tagId?: string;
  name?: string;
  changed?: string[];
  untagged?: number;
  error?: string;
}

export const EDIT_TAG_BODY = `${OMNIJS_LOOKUP_HELPERS}
      const tag = findTag({ id: params.id, path: params.path });
      const changed = [];
      if (params.newParentTag !== undefined) {
        if (params.newParentTag === '') {
          moveTags([tag], tags.ending);
        } else {
          const dest = findTag({ path: params.newParentTag });
          let cur = dest;
          while (cur) {
            if (cur.id.primaryKey === tag.id.primaryKey) throw new Error('Cannot move a tag into itself or one of its child tags');
            cur = cur.parent;
          }
          moveTags([tag], dest.ending);
        }
        changed.push('parent');
      }
      if (params.newName !== undefined) { tag.name = params.newName; changed.push('name'); }
      if (params.newStatus !== undefined) {
        tag.status = params.newStatus === 'dropped' ? Tag.Status.Dropped
          : params.newStatus === 'onHold' ? Tag.Status.OnHold
          : Tag.Status.Active;
        changed.push('status (' + params.newStatus + ')');
      }
      if (params.newAllowsNextAction !== undefined) {
        tag.allowsNextAction = params.newAllowsNextAction;
        changed.push('allowsNextAction');
      }
      return { success: true, tagId: tag.id.primaryKey, name: tag.name, changed };
`;

/**
 * Deleting a tag never deletes tasks, but it silently strips the tag from every
 * item carrying it (and deletes child tags). Refuse while it is in use unless
 * the caller passes force, and report how many items lost it.
 */
export const REMOVE_TAG_BODY = `${OMNIJS_LOOKUP_HELPERS}
      const tag = findTag({ id: params.id, path: params.path });
      const inUse = tag.remainingTasks.length + tag.flattenedTags.reduce((n, t) => n + t.remainingTasks.length, 0);
      if (inUse > 0 && !params.force) {
        return { success: false, error: 'Tag is assigned to ' + inUse + ' remaining items (including child tags). Pass force: true to remove it anyway.' };
      }
      const name = tag.name;
      const tagId = tag.id.primaryKey;
      deleteObject(tag);
      return { success: true, tagId, name, untagged: inUse };
`;

function requireRef(ref: TagRef): string | null {
  return ref.id || ref.path ? null : 'Either id or path must be provided';
}

export async function editTag(params: EditTagParams): Promise<TagOpResult> {
  const refError = requireRef(params);
  if (refError) return { success: false, error: refError };
  if (params.newName === undefined && params.newParentTag === undefined &&
      params.newStatus === undefined && params.newAllowsNextAction === undefined) {
    return { success: false, error: 'Nothing to update: provide newName, newParentTag, newStatus, or newAllowsNextAction' };
  }
  if (params.newName !== undefined && params.newName.trim() === '') {
    return { success: false, error: 'newName must not be empty' };
  }
  try {
    return await runOmniJs<TagOpResult>(EDIT_TAG_BODY, params, { write: true });
  } catch (error: any) {
    return { success: false, error: error?.message || 'Unknown error in editTag' };
  }
}

export async function removeTag(params: RemoveTagParams): Promise<TagOpResult> {
  const refError = requireRef(params);
  if (refError) return { success: false, error: refError };
  try {
    return await runOmniJs<TagOpResult>(REMOVE_TAG_BODY, params, { write: true });
  } catch (error: any) {
    return { success: false, error: error?.message || 'Unknown error in removeTag' };
  }
}
