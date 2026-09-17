import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../primitives/batchEditItems.js', () => ({ batchEditItems: vi.fn() }));

import { batchEditItems } from '../primitives/batchEditItems.js';
import { handler, schema, MAX_BATCH_EDIT_ITEMS } from './batchEditItems.js';

const extra = {} as any;

describe('batch_edit_items handler', () => {
  beforeEach(() => vi.mocked(batchEditItems).mockReset());

  it('refuses the whole batch when any item is malformed, touching nothing', async () => {
    const r = await handler({ items: [
      { id: 'a', itemType: 'task', newFlagged: true },
      { id: 'b', itemType: 'task' },
      { itemType: 'task', newFlagged: false },
    ] } as any, extra);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('item 2: nothing to update');
    expect(r.content[0].text).toContain('item 3: either id or name');
    expect(batchEditItems).not.toHaveBeenCalled();
  });

  it('reports per-item outcomes and succeeds when any item did', async () => {
    vi.mocked(batchEditItems).mockResolvedValue([
      { success: true, id: 'a', name: 'A', changedProperties: 'status (completed)' },
      { success: false, error: 'Item not found' },
    ]);
    const r = await handler({ items: [
      { id: 'a', itemType: 'task', newStatus: 'completed' },
      { id: 'zz', itemType: 'task', newStatus: 'completed' },
    ] } as any, extra);
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('Updated 1 of 2 items. ⚠️ 1 failed.');
    expect(r.content[0].text).toContain('- ✅ task "A" (status (completed)) (id: a)');
    expect(r.content[0].text).toContain('- ❌ task zz: Item not found');
  });

  it('is an error when every item failed', async () => {
    vi.mocked(batchEditItems).mockResolvedValue([{ success: false, error: 'nope' }]);
    const r = await handler({ items: [{ id: 'a', itemType: 'task', newFlagged: true }] } as any, extra);
    expect(r.isError).toBe(true);
  });

  it('bounds the batch size', () => {
    const item = { id: 'a', itemType: 'task', newFlagged: true };
    expect(schema.safeParse({ items: [] }).success).toBe(false);
    expect(schema.safeParse({ items: Array(MAX_BATCH_EDIT_ITEMS).fill(item) }).success).toBe(true);
    expect(schema.safeParse({ items: Array(MAX_BATCH_EDIT_ITEMS + 1).fill(item) }).success).toBe(false);
  });
});
