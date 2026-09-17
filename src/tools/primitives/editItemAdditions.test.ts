import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/scriptExecution.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/scriptExecution.js')>();
  return { ...actual, runOsascriptFile: vi.fn(async () => { throw new Error('test reached osascript'); }) };
});

import { generateAppleScript, validateEditParams, editItem, EditItemParams } from './editItem.js';

const task = (o: Partial<EditItemParams>): EditItemParams => ({ itemType: 'task', id: 't1', ...o });
const project = (o: Partial<EditItemParams>): EditItemParams => ({ itemType: 'project', id: 'p1', ...o });

describe('edit_item appendNote', () => {
  it('appends on a new line, or sets the note when it is empty', () => {
    const script = generateAppleScript(task({ appendNote: 'more' }));
    expect(script).toContain('if existingNote is missing value or existingNote is "" then');
    expect(script).toContain('set note of foundItem to "more"');
    expect(script).toContain('set note of foundItem to existingNote & linefeed & "more"');
    expect(script).toContain('note (appended)');
    expect(script).not.toContain('-- Update note');
  });

  it('escapes quotes and keeps newlines in appended text', () => {
    const script = generateAppleScript(task({ appendNote: 'say "hi"\nnext' }));
    expect(script).toContain('say \\"hi\\"" & linefeed & "next');
  });
});

describe('validateEditParams', () => {
  it('refuses newNote together with appendNote', () => {
    expect(validateEditParams(task({ newNote: 'a', appendNote: 'b' }))).toContain('not both');
  });

  it('refuses project-only fields on a task, naming them', () => {
    expect(validateEditParams(task({ newSingleActionList: true, newReviewInterval: { steps: 1, unit: 'week' } })))
      .toBe('Project-only fields cannot be applied to a task: newReviewInterval, newSingleActionList');
  });

  it('refuses sequential plus single-action list', () => {
    expect(validateEditParams(project({ newSequential: true, newSingleActionList: true }))).toContain('both sequential');
  });

  it('accepts valid project settings', () => {
    expect(validateEditParams(project({ newReviewInterval: { steps: 2, unit: 'month' }, newCompletedByChildren: true }))).toBeNull();
  });

  it('is enforced by editItem before any script runs', async () => {
    const r = await editItem(task({ newNote: 'a', appendNote: 'b' }));
    expect(r).toEqual({ success: false, error: 'Provide either newNote (replace) or appendNote (append), not both' });
  });
});
