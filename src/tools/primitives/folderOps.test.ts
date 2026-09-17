import { describe, it, expect } from 'vitest';
import { EDIT_FOLDER_BODY, REMOVE_FOLDER_BODY, editFolder, removeFolder } from './folderOps.js';
import { createFakeOmniFocus, FolderStatus } from '../../tests/fakes/fakeOmniFocus.js';

describe('edit_folder OmniJS', () => {
  it('renames and drops a folder found by path', () => {
    const of = createFakeOmniFocus();
    const f = of.folder('Old', of.folder('Parent'));
    const r = of.run(EDIT_FOLDER_BODY, { path: 'Parent/Old', newName: 'New', newStatus: 'dropped' });
    expect(r).toMatchObject({ success: true, name: 'New', changed: ['name', 'status (dropped)'] });
    expect(f.status).toBe(FolderStatus.Dropped);
  });

  it('moves a folder under another and back to the top level', () => {
    const of = createFakeOmniFocus();
    const dest = of.folder('Dest');
    const f = of.folder('Mover');
    of.run(EDIT_FOLDER_BODY, { id: f.id.primaryKey, newParentFolder: 'Dest' });
    expect(dest.folders).toContain(f);
    expect(of.topFolders).not.toContain(f);
    of.run(EDIT_FOLDER_BODY, { id: f.id.primaryKey, newParentFolder: '' });
    expect(of.topFolders).toContain(f);
    expect(f.parent).toBeNull();
  });

  it('refuses to move a folder into its own descendant', () => {
    const of = createFakeOmniFocus();
    const top = of.folder('Top');
    of.folder('Inner', top);
    const r = of.run(EDIT_FOLDER_BODY, { path: 'Top', newParentFolder: 'Top/Inner' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('into itself');
    expect(of.topFolders).toContain(top);
  });

  it('validates before reaching OmniFocus', async () => {
    expect((await editFolder({ newName: 'x' })).error).toContain('id or path');
    expect((await editFolder({ path: 'A' })).error).toContain('Nothing to update');
    expect((await editFolder({ path: 'A', newName: '' })).error).toContain('must not be empty');
  });
});

describe('remove_folder OmniJS', () => {
  it('deletes an empty folder', () => {
    const of = createFakeOmniFocus();
    const f = of.folder('Empty');
    const r = of.run(REMOVE_FOLDER_BODY, { id: f.id.primaryKey });
    expect(r).toMatchObject({ success: true, name: 'Empty' });
    expect(of.deleted).toEqual([f]);
  });

  it('refuses a folder that contains a project', () => {
    const of = createFakeOmniFocus();
    const f = of.folder('Full');
    of.project('P', f);
    const r = of.run(REMOVE_FOLDER_BODY, { path: 'Full' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('not empty (1 projects, 0 subfolders)');
    expect(of.deleted).toEqual([]);
  });

  it('refuses a folder that only contains an empty subfolder', () => {
    const of = createFakeOmniFocus();
    of.folder('Sub', of.folder('Outer'));
    const r = of.run(REMOVE_FOLDER_BODY, { path: 'Outer' });
    expect(r.success).toBe(false);
    expect(of.deleted).toEqual([]);
  });

  it('requires a reference', async () => {
    expect((await removeFolder({})).error).toContain('id or path');
  });
});
