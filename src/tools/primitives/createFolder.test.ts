import { describe, it, expect } from 'vitest';
import { CREATE_FOLDER_BODY, createFolder } from './createFolder.js';
import { createFakeOmniFocus } from '../../tests/fakes/fakeOmniFocus.js';

describe('create_folder OmniJS', () => {
  it('creates a top-level folder', () => {
    const of = createFakeOmniFocus();
    const r = of.run(CREATE_FOLDER_BODY, { name: 'Work' });
    expect(r).toMatchObject({ success: true, existed: false });
    expect(of.topFolders.map(f => f.name)).toEqual(['Work']);
    expect(r.folderId).toBe(of.topFolders[0].id.primaryKey);
  });

  it('returns the existing sibling instead of creating a duplicate', () => {
    const of = createFakeOmniFocus();
    const existing = of.folder('Work');
    const r = of.run(CREATE_FOLDER_BODY, { name: 'Work' });
    expect(r).toEqual({ success: true, existed: true, folderId: existing.id.primaryKey });
    expect(of.topFolders).toHaveLength(1);
  });

  it('creates a duplicate only when allowDuplicate is set', () => {
    const of = createFakeOmniFocus();
    of.folder('Work');
    const r = of.run(CREATE_FOLDER_BODY, { name: 'Work', allowDuplicate: true });
    expect(r.existed).toBe(false);
    expect(of.topFolders).toHaveLength(2);
  });

  it('treats a same-named folder elsewhere in the tree as no conflict', () => {
    const of = createFakeOmniFocus();
    const home = of.folder('Home');
    of.folder('Admin', home);
    const r = of.run(CREATE_FOLDER_BODY, { name: 'Admin' });
    expect(r.existed).toBe(false);
    expect(of.topFolders.map(f => f.name)).toEqual(['Home', 'Admin']);
  });

  it('nests under a parent by path', () => {
    const of = createFakeOmniFocus();
    const eng = of.folder('Engineering', of.folder('Work'));
    of.run(CREATE_FOLDER_BODY, { name: 'Backend', parentFolderName: 'Work/Engineering' });
    expect(eng.folders.map(f => f.name)).toEqual(['Backend']);
  });

  it('nests under a parent by id, which wins over name', () => {
    const of = createFakeOmniFocus();
    const a = of.folder('A');
    of.folder('B');
    of.run(CREATE_FOLDER_BODY, { name: 'Child', parentFolderID: a.id.primaryKey, parentFolderName: 'B' });
    expect(a.folders.map(f => f.name)).toEqual(['Child']);
  });

  it('fails loudly when the parent is missing, and creates nothing', () => {
    const of = createFakeOmniFocus();
    const r = of.run(CREATE_FOLDER_BODY, { name: 'X', parentFolderName: 'Nope' });
    expect(r).toEqual({ success: false, error: 'Folder not found: Nope' });
    expect(of.topFolders).toHaveLength(0);
  });

  it('refuses an ambiguous bare parent name', () => {
    const of = createFakeOmniFocus();
    of.folder('Admin', of.folder('Home'));
    of.folder('Admin', of.folder('Work'));
    const r = of.run(CREATE_FOLDER_BODY, { name: 'X', parentFolderName: 'Admin' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Ambiguous');
  });

  it('rejects an empty name before reaching OmniFocus', async () => {
    expect(await createFolder({ name: '  ' })).toEqual({ success: false, error: 'Folder name must not be empty' });
  });
});
