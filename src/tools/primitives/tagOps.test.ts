import { describe, it, expect } from 'vitest';
import { EDIT_TAG_BODY, REMOVE_TAG_BODY, editTag } from './tagOps.js';
import { createFakeOmniFocus, TagStatus } from '../../tests/fakes/fakeOmniFocus.js';

describe('edit_tag OmniJS', () => {
  it('nests a top-level tag under a parent and renames it', () => {
    const of = createFakeOmniFocus();
    const parent = of.tag('Areas');
    const t = of.tag('area-home');
    const r = of.run(EDIT_TAG_BODY, { path: 'area-home', newParentTag: 'Areas', newName: 'Home' });
    expect(r).toMatchObject({ success: true, name: 'Home', changed: ['parent', 'name'] });
    expect(parent.tags).toEqual([t]);
    expect(of.topTags).toEqual([parent]);
  });

  it('sets status and next-action behaviour', () => {
    const of = createFakeOmniFocus();
    const t = of.tag('Waiting');
    of.run(EDIT_TAG_BODY, { id: t.id.primaryKey, newStatus: 'onHold', newAllowsNextAction: false });
    expect(t.status).toBe(TagStatus.OnHold);
    expect(t.allowsNextAction).toBe(false);
  });

  it('refuses to nest a tag under its own child', () => {
    const of = createFakeOmniFocus();
    of.tag('Child', of.tag('Parent'));
    const r = of.run(EDIT_TAG_BODY, { path: 'Parent', newParentTag: 'Parent/Child' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('into itself');
  });

  it('validates before reaching OmniFocus', async () => {
    expect((await editTag({ path: 'A' })).error).toContain('Nothing to update');
  });
});

describe('remove_tag OmniJS', () => {
  it('deletes an unused tag', () => {
    const of = createFakeOmniFocus();
    const t = of.tag('Unused');
    expect(of.run(REMOVE_TAG_BODY, { path: 'Unused' })).toMatchObject({ success: true, untagged: 0 });
    expect(of.deleted).toEqual([t]);
  });

  it('refuses a tag in use, counting child tags, unless forced', () => {
    const of = createFakeOmniFocus();
    const parent = of.tag('Parent');
    of.tag('Child', parent).remainingTasks = [{}, {}];
    const refused = of.run(REMOVE_TAG_BODY, { path: 'Parent' });
    expect(refused.success).toBe(false);
    expect(refused.error).toContain('2 remaining items');
    expect(of.deleted).toEqual([]);
    expect(of.run(REMOVE_TAG_BODY, { path: 'Parent', force: true })).toMatchObject({ success: true, untagged: 2 });
    expect(of.deleted).toEqual([parent]);
  });
});
