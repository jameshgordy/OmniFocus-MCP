import { editItem, EditItemParams } from './editItem.js';

export type BatchEditItemResult = {
  success: boolean;
  id?: string;
  name?: string;
  changedProperties?: string;
  error?: string;
};

/**
 * Apply edits one after another. OmniFocus is single-threaded, so sequential
 * calls are no slower than concurrent ones and keep each result attributable.
 * A failed item does not stop the rest; every item gets its own result.
 */
export async function batchEditItems(items: EditItemParams[]): Promise<BatchEditItemResult[]> {
  const results: BatchEditItemResult[] = [];
  for (const item of items) {
    try {
      results.push(await editItem(item));
    } catch (error: any) {
      results.push({ success: false, error: error?.message || 'Unknown error editing item' });
    }
  }
  return results;
}
