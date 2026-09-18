import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, delimiter } from 'path';
import {
  listAutomations, loadAutomation, saveAutomation, resolveAutomationDirs, parseScriptHeader, DEFAULT_AUTOMATIONS_DIR,
} from './store.js';

const recipeText = JSON.stringify({
  description: 'Capture', params: { name: { required: true } },
  steps: [{ tool: 'add_omnifocus_task', args: { name: '{{name}}' } }],
});
const scriptText = `// @description Count inbox items
// @param limit  How many to report
(() => JSON.stringify({ count: inbox.length }))()
`;

describe('resolveAutomationDirs', () => {
  it('defaults to a user-owned directory, not a client-specific one', () => {
    expect(resolveAutomationDirs(undefined)).toEqual([DEFAULT_AUTOMATIONS_DIR]);
    expect(resolveAutomationDirs('  ')).toEqual([DEFAULT_AUTOMATIONS_DIR]);
  });

  it('accepts several directories and expands ~', () => {
    const dirs = resolveAutomationDirs(['/a/b', '~/c'].join(delimiter));
    expect(dirs[0]).toBe('/a/b');
    expect(dirs[1]).toMatch(/\/c$/);
    expect(dirs[1]).not.toContain('~');
  });
});

describe('automation files', () => {
  let primary: string;
  let secondary: string;
  beforeEach(() => {
    primary = mkdtempSync(join(tmpdir(), 'of-auto-1-'));
    secondary = mkdtempSync(join(tmpdir(), 'of-auto-2-'));
  });
  afterEach(() => {
    rmSync(primary, { recursive: true, force: true });
    rmSync(secondary, { recursive: true, force: true });
  });

  it('lists recipes and scripts with their metadata', () => {
    writeFileSync(join(primary, 'capture.json'), recipeText);
    writeFileSync(join(primary, 'inbox-count.js'), scriptText);
    writeFileSync(join(primary, 'notes.txt'), 'ignored');
    const items = listAutomations([primary]);
    expect(items.map((i) => [i.name, i.kind, i.description])).toEqual([
      ['capture', 'recipe', 'Capture'],
      ['inbox-count', 'script', 'Count inbox items'],
    ]);
    expect(items[1].params).toEqual({ limit: { description: 'How many to report' } });
  });

  it('surfaces a broken recipe instead of hiding it', () => {
    writeFileSync(join(primary, 'broken.json'), '{not json');
    const [item] = listAutomations([primary]);
    expect(item.description).toMatch(/^INVALID:/);
  });

  it('earlier directories win on a name clash; a missing directory is fine', () => {
    writeFileSync(join(primary, 'capture.json'), recipeText);
    writeFileSync(join(secondary, 'capture.json'), recipeText.replace('Capture', 'Shadowed'));
    writeFileSync(join(secondary, 'other.json'), recipeText);
    const items = listAutomations([primary, join(primary, 'absent'), secondary]);
    expect(items.map((i) => `${i.name}:${i.description}`)).toEqual(['capture:Capture', 'other:Capture']);
    expect(loadAutomation('capture', [primary, secondary])!.path).toBe(join(primary, 'capture.json'));
  });

  it('refuses names that could escape the folder', () => {
    expect(() => loadAutomation('../etc/passwd', [primary])).toThrow(/Invalid automation name/);
    expect(() => saveAutomation('a/b', 'recipe', recipeText, { dirs: [primary] })).toThrow(/Invalid automation name/);
    expect(loadAutomation('nope', [primary])).toBeNull();
  });

  it('saves into the first directory, creating it, and formats recipes', () => {
    const target = join(primary, 'nested', 'automations');
    const path = saveAutomation('capture', 'recipe', recipeText, { dirs: [target, secondary] });
    expect(path).toBe(join(target, 'capture.json'));
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(JSON.parse(recipeText), null, 2) + '\n');
    expect(saveAutomation('count', 'script', scriptText.trimEnd(), { dirs: [target] })).toBe(join(target, 'count.js'));
    expect(readFileSync(join(target, 'count.js'), 'utf8').endsWith('\n')).toBe(true);
  });

  it('does not overwrite without being told to, even across directories', () => {
    mkdirSync(secondary, { recursive: true });
    writeFileSync(join(secondary, 'capture.js'), scriptText);
    expect(() => saveAutomation('capture', 'recipe', recipeText, { dirs: [primary, secondary] })).toThrow(/already exists/);
    saveAutomation('capture', 'recipe', recipeText, { dirs: [primary, secondary], overwrite: true });
    expect(loadAutomation('capture', [primary, secondary])!.kind).toBe('recipe');
  });

  it('never writes an invalid recipe', () => {
    expect(() => saveAutomation('bad', 'recipe', '{"description": "x"}', { dirs: [primary] })).toThrow(/malformed/);
    expect(listAutomations([primary])).toEqual([]);
  });
});

describe('parseScriptHeader', () => {
  it('stops at the first non-comment line', () => {
    const meta = parseScriptHeader(`// @description First\nconst x = 1;\n// @description Second\n`);
    expect(meta.description).toBe('First');
  });

  it('tolerates a block comment before the tags', () => {
    const meta = parseScriptHeader(`/* licence */\n\n// @param a\n// @param b  With text\n`);
    expect(meta.params).toEqual({ a: { description: undefined }, b: { description: 'With text' } });
  });
});
