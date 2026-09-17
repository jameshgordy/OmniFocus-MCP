import vm from 'vm';
import { buildOmniJsProgram } from '../../utils/omniJs.js';

/**
 * A deliberately small in-memory stand-in for the OmniJS globals the management
 * primitives touch. It exists so the generated OmniJS can be executed in tests,
 * not just string-matched: the refusal and idempotency rules live inside those
 * scripts, and only running them proves they hold.
 */

let nextId = 1;
const newId = () => `id${nextId++}`;

export const FolderStatus = { Active: 'Folder.Active', Dropped: 'Folder.Dropped' };
export const TagStatus = { Active: 'Tag.Active', OnHold: 'Tag.OnHold', Dropped: 'Tag.Dropped' };
export const TaskStatus = { Available: 'Available', Next: 'Next', Blocked: 'Blocked', DueSoon: 'DueSoon', Overdue: 'Overdue', Completed: 'Completed', Dropped: 'Dropped' };
export const ProjectStatus = { Active: 'P.Active', OnHold: 'P.OnHold', Done: 'P.Done', Dropped: 'P.Dropped' };

type Container<T> = { children: T[]; owner: any };
const ending = <T>(children: T[], owner: any): Container<T> => ({ children, owner });

export class FakeFolder {
  id = { primaryKey: newId() };
  status = FolderStatus.Active;
  folders: FakeFolder[] = [];
  projects: FakeProject[] = [];
  parent: FakeFolder | null = null;
  constructor(public name: string) {}
  get ending() { return ending(this.folders, this); }
  get flattenedFolders(): FakeFolder[] { return this.folders.flatMap(f => [f, ...f.flattenedFolders]); }
  get flattenedProjects(): FakeProject[] { return [...this.projects, ...this.folders.flatMap(f => f.flattenedProjects)]; }
}

export class FakeTag {
  id = { primaryKey: newId() };
  status = TagStatus.Active;
  allowsNextAction = true;
  tags: FakeTag[] = [];
  parent: FakeTag | null = null;
  remainingTasks: unknown[] = [];
  constructor(public name: string) {}
  get ending() { return ending(this.tags, this); }
  get flattenedTags(): FakeTag[] { return this.tags.flatMap(t => [t, ...t.flattenedTags]); }
}

export class FakeTask {
  id = { primaryKey: newId() };
  completed = false;
  taskStatus = TaskStatus.Available;
  project: FakeProject | null = null;
  containingProject: FakeProject | null = null;
  constructor(public name: string) {}
}

export class FakeProject {
  task: FakeTask;
  id = { primaryKey: newId() };
  status = ProjectStatus.Active;
  reviewInterval = { steps: 1, unit: 'weeks' };
  containsSingletonActions = false;
  completedByChildren = false;
  parentFolder: FakeFolder | null = null;
  constructor(public name: string) {
    this.task = new FakeTask(name);
    this.task.project = this;
  }
}

export function createFakeOmniFocus() {
  const topFolders: FakeFolder[] = [];
  const topTags: FakeTag[] = [];
  const allTasks: FakeTask[] = [];
  const allProjects: FakeProject[] = [];
  const deleted: unknown[] = [];

  const flattenedFolders = () => topFolders.flatMap(f => [f, ...f.flattenedFolders]);
  const flattenedTags = () => topTags.flatMap(t => [t, ...t.flattenedTags]);

  const detach = <T extends { parent: any }>(item: T, top: T[], childKey: 'folders' | 'tags') => {
    const siblings = item.parent ? item.parent[childKey] : top;
    siblings.splice(siblings.indexOf(item), 1);
  };
  const attach = <T extends { parent: any }>(item: T, dest: Container<T>) => {
    dest.children.push(item);
    item.parent = dest.owner === 'library' || dest.owner === 'tags' ? null : dest.owner;
  };

  function Folder(this: any, name: string, position: Container<FakeFolder>) {
    const folder = new FakeFolder(name);
    attach(folder, position);
    return folder;
  }
  Object.assign(Folder, {
    Status: FolderStatus,
    byIdentifier: (id: string) => flattenedFolders().find(f => f.id.primaryKey === id) ?? null,
  });

  const globals: Record<string, unknown> = {
    Folder,
    Tag: { Status: TagStatus, byIdentifier: (id: string) => flattenedTags().find(t => t.id.primaryKey === id) ?? null },
    Task: { Status: TaskStatus, byIdentifier: (id: string) => allTasks.find(t => t.id.primaryKey === id) ?? null },
    Project: { Status: ProjectStatus, byIdentifier: (id: string) => allProjects.find(p => p.id.primaryKey === id) ?? null },
    // Mirrors real OmniJS: `library` has no `folders` property; top-level
    // folders are the global `folders`.
    library: { get ending() { return ending(topFolders, 'library'); } },
    get folders() { return topFolders; },
    tags: { get ending() { return ending(topTags, 'tags'); } },
    get flattenedFolders() { return flattenedFolders(); },
    get flattenedTags() { return flattenedTags(); },
    get flattenedProjects() { return allProjects; },
    get flattenedTasks() { return allTasks; },
    moveSections: (items: FakeFolder[], dest: Container<FakeFolder>) => items.forEach(f => { detach(f, topFolders, 'folders'); attach(f, dest); }),
    moveTags: (items: FakeTag[], dest: Container<FakeTag>) => items.forEach(t => { detach(t, topTags, 'tags'); attach(t, dest); }),
    deleteObject: (obj: any) => {
      if (obj instanceof FakeFolder) detach(obj, topFolders, 'folders');
      if (obj instanceof FakeTag) detach(obj, topTags, 'tags');
      deleted.push(obj);
    },
    convertTasksToProjects: (tasks: FakeTask[], dest: any) => tasks.map(t => {
      const p = new FakeProject(t.name);
      allProjects.push(p);
      if (dest.owner instanceof FakeFolder) { p.parentFolder = dest.owner; dest.owner.projects.push(p); }
      return p;
    }),
  };

  return {
    topFolders, topTags, allTasks, allProjects, deleted,
    folder(name: string, parent?: FakeFolder) {
      return (Folder as any)(name, parent ? parent.ending : ending(topFolders, 'library')) as FakeFolder;
    },
    tag(name: string, parent?: FakeTag) {
      const t = new FakeTag(name);
      attach(t, parent ? parent.ending : ending(topTags, 'tags'));
      return t;
    },
    task(name: string) {
      const t = new FakeTask(name);
      allTasks.push(t);
      return t;
    },
    project(name: string, folder?: FakeFolder) {
      const p = new FakeProject(name);
      allProjects.push(p);
      if (folder) { p.parentFolder = folder; folder.projects.push(p); }
      return p;
    },
    /** Execute an OmniJS body exactly as runOmniJs would, and parse its result. */
    run(body: string, params: unknown): any {
      const program = buildOmniJsProgram(body, params);
      // Copy descriptors, not values, so getters stay live during the run.
      const sandbox = Object.defineProperties({}, Object.getOwnPropertyDescriptors(globals));
      return JSON.parse(vm.runInNewContext(program, sandbox));
    },
  };
}
