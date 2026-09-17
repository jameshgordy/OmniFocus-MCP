import { describe, it, expect } from 'vitest';
import vm from 'vm';
import { buildOmniJsProgram } from '../../utils/omniJs.js';
import { REVIEW_SUMMARY_BODY } from './reviewSummary.js';

const DAY = 86400000;
const S = { Available: 'Available', Next: 'Next', Blocked: 'Blocked', DueSoon: 'DueSoon', Overdue: 'Overdue', Completed: 'Completed', Dropped: 'Dropped' };
const P = { Active: 'Active', OnHold: 'OnHold', Done: 'Done', Dropped: 'Dropped' };
const F = { Active: 'FActive', Dropped: 'FDropped' };

let n = 0;
function task(name: string, o: Record<string, unknown> = {}) {
  return { id: { primaryKey: `t${++n}` }, name, completed: false, taskStatus: S.Available, project: null,
    containingProject: null, inInbox: false, flagged: false, added: new Date(Date.now() - DAY),
    effectiveDueDate: null, effectiveDeferDate: null, ...o };
}
function project(name: string, tasks: any[], o: Record<string, unknown> = {}) {
  const p: any = { name, status: P.Active, parentFolder: null, nextReviewDate: null, flattenedTasks: tasks,
    task: { id: { primaryKey: `p${++n}` }, modified: new Date() }, ...o };
  tasks.forEach(t => { t.containingProject = p; });
  return p;
}

function run(projects: any[], looseTasks: any[], params = { limit: 10, dueSoonDays: 7 }) {
  const all = [...looseTasks, ...projects.flatMap(p => p.flattenedTasks)];
  const program = buildOmniJsProgram(REVIEW_SUMMARY_BODY, params);
  return JSON.parse(vm.runInNewContext(program, {
    flattenedTasks: all, flattenedProjects: projects,
    Task: { Status: S }, Project: { Status: P }, Folder: { Status: F },
  }));
}

describe('get_review_summary OmniJS', () => {
  it('classifies stalled projects: empty or fully blocked, but not scheduled or on hold', () => {
    const empty = project('Empty', []);
    const blocked = project('Blocked', [task('b', { taskStatus: S.Blocked })]);
    const scheduled = project('Scheduled', [task('s', { taskStatus: S.Blocked, effectiveDeferDate: new Date(Date.now() + 3 * DAY) })]);
    const healthy = project('Healthy', [task('h')]);
    const onHold = project('OnHold', [], { status: P.OnHold });
    const inDroppedFolder = project('Hidden', [], { parentFolder: { status: F.Dropped, parent: null } });
    const r = run([empty, blocked, scheduled, healthy, onHold, inDroppedFolder], []);
    expect(r.stalledProjects.items.map((i: any) => i.name)).toEqual(['Empty', 'Blocked']);
  });

  it('lists overdue and due-soon tasks by due date and ignores completed ones', () => {
    const r = run([], [
      task('later', { effectiveDueDate: new Date(Date.now() - 1 * DAY) }),
      task('earliest', { effectiveDueDate: new Date(Date.now() - 5 * DAY) }),
      task('done', { effectiveDueDate: new Date(Date.now() - 9 * DAY), completed: true }),
      task('soon', { effectiveDueDate: new Date(Date.now() + 2 * DAY) }),
      task('far', { effectiveDueDate: new Date(Date.now() + 30 * DAY) }),
    ]);
    expect(r.overdue.items.map((i: any) => i.name)).toEqual(['earliest', 'later']);
    expect(r.dueSoon.items.map((i: any) => i.name)).toEqual(['soon']);
  });

  it('reports inbox age oldest-first and full counts beyond the limit', () => {
    const inbox = [3, 40, 10].map(d => task(`age${d}`, { inInbox: true, added: new Date(Date.now() - d * DAY) }));
    const r = run([], inbox, { limit: 2, dueSoonDays: 7 });
    expect(r.inbox.count).toBe(3);
    expect(r.inbox.oldestDays).toBe(40);
    expect(r.inbox.items.map((i: any) => i.name)).toEqual(['age40', 'age10']);
  });

  it('lists projects due for review, most overdue first, excluding done ones', () => {
    const r = run([
      project('Recent', [task('x')], { nextReviewDate: new Date(Date.now() - 2 * DAY) }),
      project('Old', [task('y')], { nextReviewDate: new Date(Date.now() - 50 * DAY) }),
      project('Future', [task('z')], { nextReviewDate: new Date(Date.now() + 5 * DAY) }),
      project('Done', [], { status: P.Done, nextReviewDate: new Date(Date.now() - 90 * DAY) }),
    ], []);
    expect(r.reviewDue.items.map((i: any) => [i.name, i.days])).toEqual([['Old', 50], ['Recent', 2]]);
  });
});
