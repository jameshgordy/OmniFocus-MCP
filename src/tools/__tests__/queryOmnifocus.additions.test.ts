import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/scriptExecution.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/scriptExecution.js')>();
  return { ...actual, executeOmniFocusScript: vi.fn(async () => { throw new Error('test reached osascript'); }) };
});

import { _testExports, invalidIdentifiers, queryOmnifocus } from '../primitives/queryOmnifocus.js';

const { generateFilterConditions } = _testExports;

describe('query_omnifocus field and sort name validation', () => {
  it('accepts plain identifiers', () => {
    expect(invalidIdentifiers({ fields: ['id', 'name', 'effectiveDueDate', 'x_1'], sortBy: 'dueDate' })).toEqual([]);
  });

  it('rejects anything that would be evaluated as code', () => {
    const bad = ['name: (deleteObject(flattenedTasks[0]), 1)', 'a.b', 'x[0]', '', '1abc', 'constructor()'];
    expect(invalidIdentifiers({ fields: bad })).toEqual(bad);
    expect(invalidIdentifiers({ sortBy: 'name; deleteObject(x)' })).toEqual(['name; deleteObject(x)']);
  });

  it('refuses the query without running a script', async () => {
    const r = await queryOmnifocus({ entity: 'tasks', fields: ['id', 'x: evil()'] });
    expect(r.success).toBe(false);
    expect(r.error).toContain('"x: evil()"');
  });
});

describe('query_omnifocus new filters', () => {
  it('untagged applies to tasks and projects in both directions', () => {
    expect(generateFilterConditions('tasks', { untagged: true })).toContain('.length === 0) !== true');
    expect(generateFilterConditions('projects', { untagged: false })).toContain('.length === 0) !== false');
  });

  it('hasAttachments is task-only', () => {
    expect(generateFilterConditions('tasks', { hasAttachments: true })).toContain('attachments');
    expect(generateFilterConditions('projects', { hasAttachments: true }).trim()).toBe('');
  });

  it('stalled and topLevel are project-only', () => {
    expect(generateFilterConditions('projects', { stalled: true })).toContain('isStalledProject(item) !== true');
    expect(generateFilterConditions('projects', { topLevel: true })).toContain('(!item.parentFolder) !== true');
    expect(generateFilterConditions('tasks', { stalled: true, topLevel: true }).trim()).toBe('');
  });

  it('coerces non-boolean filter values instead of splicing them', () => {
    const out = generateFilterConditions('tasks', { untagged: '1); evil(' as any });
    expect(out).not.toContain('evil');
  });
});
