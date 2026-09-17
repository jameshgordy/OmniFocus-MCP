import { describe, it, expect } from 'vitest';
import { APPLY_PROJECT_SETTINGS_BODY, validateProjectSettings, hasProjectSettings } from './projectSettings.js';
import { CONVERT_TASK_TO_PROJECT_BODY } from './convertTaskToProject.js';
import { createFakeOmniFocus, TaskStatus } from '../../tests/fakes/fakeOmniFocus.js';

describe('project settings', () => {
  it('applies review interval, single-action list and complete-with-last-action', () => {
    const of = createFakeOmniFocus();
    const p = of.project('P');
    const r = of.run(APPLY_PROJECT_SETTINGS_BODY, {
      projectId: p.task.id.primaryKey,
      settings: { reviewInterval: { steps: 2, unit: 'month' }, singleActionList: true, completedByChildren: true },
    });
    expect(r).toEqual({ success: true, changed: ['review interval', 'single-action list', 'complete with last action'] });
    expect(p.reviewInterval).toEqual({ steps: 2, unit: 'months' });
    expect(p.containsSingletonActions).toBe(true);
    expect(p.completedByChildren).toBe(true);
  });

  it('accepts the OmniJS project id as well as the root-task id', () => {
    const of = createFakeOmniFocus();
    const p = of.project('P');
    of.run(APPLY_PROJECT_SETTINGS_BODY, { projectId: p.id.primaryKey, settings: { singleActionList: true } });
    expect(p.containsSingletonActions).toBe(true);
  });

  it('reports a missing project', () => {
    const of = createFakeOmniFocus();
    expect(of.run(APPLY_PROJECT_SETTINGS_BODY, { projectId: 'nope', settings: {} }))
      .toEqual({ success: false, error: 'Project not found: nope' });
  });

  it('validates combinations', () => {
    expect(validateProjectSettings({ singleActionList: true }, true)).toContain('both sequential and a single-action list');
    expect(validateProjectSettings({ reviewInterval: { steps: 0, unit: 'week' } })).toContain('positive integer');
    expect(validateProjectSettings({ singleActionList: true }, false)).toBeNull();
    expect(hasProjectSettings({})).toBe(false);
    expect(hasProjectSettings({ completedByChildren: false })).toBe(true);
  });
});

describe('convert_task_to_project OmniJS', () => {
  it('converts into a folder and returns the root-task id', () => {
    const of = createFakeOmniFocus();
    const folder = of.folder('Work');
    const t = of.task('Big thing');
    const r = of.run(CONVERT_TASK_TO_PROJECT_BODY, { taskId: t.id.primaryKey, folderName: 'Work' });
    expect(r.success).toBe(true);
    expect(folder.projects.map(p => p.name)).toEqual(['Big thing']);
    expect(r.projectId).toBe(folder.projects[0].task.id.primaryKey);
  });

  it('refuses completed tasks and existing projects', () => {
    const of = createFakeOmniFocus();
    const done = of.task('Done');
    done.completed = true;
    done.taskStatus = TaskStatus.Completed;
    expect(of.run(CONVERT_TASK_TO_PROJECT_BODY, { taskId: done.id.primaryKey }).error).toContain('completed or dropped');
    const p = of.project('Already');
    of.allTasks.push(p.task);
    expect(of.run(CONVERT_TASK_TO_PROJECT_BODY, { taskId: p.task.id.primaryKey }).error).toContain('already a project');
    expect(of.allProjects).toHaveLength(1);
  });
});
