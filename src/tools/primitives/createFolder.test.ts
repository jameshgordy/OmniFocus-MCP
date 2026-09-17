import { describe, it, expect } from 'vitest';
import { generateAppleScript } from './createFolder.js';

describe('createFolder generateAppleScript', () => {
  it('creates a top-level folder', () => {
    const script = generateAppleScript({ name: 'Personal' });
    expect(script).toContain('make new folder with properties {name:"Personal"}');
    expect(script).not.toContain('at end of folders of parentFolder');
    expect(script).not.toContain('Parent folder not found');
  });

  it('nests under a parent folder by name', () => {
    const script = generateAppleScript({ name: 'Engineering', parentFolderName: 'Work' });
    expect(script).toContain('first flattened folder where name = "Work"');
    expect(script).toContain('make new folder with properties {name:"Engineering"} at end of folders of parentFolder');
    expect(script).toContain('Parent folder not found: Work');
  });

  it('nests under a parent folder by path', () => {
    const script = generateAppleScript({ name: 'Backend', parentFolderName: 'Work/Engineering' });
    expect(script).toContain('set pathComponents to {"Work", "Engineering"}');
    expect(script).toContain('make new folder with properties {name:"Backend"} at end of folders of parentFolder');
    expect(script).toContain('Parent folder not found: Work/Engineering');
  });

  it('nests under a parent folder by id', () => {
    const script = generateAppleScript({ name: 'Engineering', parentFolderID: 'abc123' });
    expect(script).toContain('first flattened folder whose id is "abc123"');
    expect(script).toContain('make new folder with properties {name:"Engineering"} at end of folders of parentFolder');
    expect(script).toContain('Parent folder not found: abc123');
  });

  it('prefers parentFolderID over parentFolderName when both are given', () => {
    const script = generateAppleScript({ name: 'X', parentFolderID: 'id99', parentFolderName: 'ByName' });
    expect(script).toContain('first flattened folder whose id is "id99"');
    expect(script).not.toContain('first flattened folder where name = "ByName"');
  });

  it('fails loudly on a component-less parent path', () => {
    const script = generateAppleScript({ name: 'X', parentFolderName: '/' });
    expect(script).toContain('Parent folder not found: /');
  });

  it('escapes special characters in the folder name', () => {
    const script = generateAppleScript({ name: 'My "Folder"' });
    expect(script).toContain('My \\"Folder\\"');
  });

  it('escapes special characters in the parent name', () => {
    const script = generateAppleScript({ name: 'Child', parentFolderName: 'Pa "rent"' });
    expect(script).toContain('Pa \\"rent\\"');
  });

  it('returns success JSON shape with folderId', () => {
    const script = generateAppleScript({ name: 'F' });
    expect(script).toContain('set folderId to id of newFolder as string');
    expect(script).toContain('\\"success\\":true');
    expect(script).toContain('\\"folderId\\":');
  });
});
