import { describe, it, expect, vi } from 'vitest';
import { parseRecipe } from './recipe.js';
import { runRecipe, validateRecipeSteps, registryCallTool, planRecipe } from './run.js';

const twoStep = parseRecipe(JSON.stringify({
  description: 'x',
  params: { name: { required: true } },
  steps: [
    { tool: 'create_folder', args: { name: '{{name}}' } },
    { tool: 'add_project', args: { name: '{{name}}', folderName: '{{name}}' } },
  ],
}));

describe('validateRecipeSteps', () => {
  it('names an unknown tool and an unknown argument key', () => {
    const r = parseRecipe(JSON.stringify({
      description: 'x',
      steps: [
        { tool: 'no_such_tool', args: {} },
        { tool: 'create_folder', args: { name: 'a', parentFolderNmae: 'typo' } },
      ],
    }));
    expect(validateRecipeSteps(r)).toEqual([
      'step 1: no tool named "no_such_tool"',
      'step 2 (create_folder): unknown key(s) parentFolderNmae',
    ]);
  });

  it('does not complain about a placeholder standing in for a non-string', () => {
    const r = parseRecipe(JSON.stringify({
      description: 'x',
      steps: [{ tool: 'add_omnifocus_task', args: { name: 'a', tags: '{{tags}}', flagged: '{{flag}}' } }],
    }));
    expect(validateRecipeSteps(r)).toEqual([]);
  });
});

describe('runRecipe', () => {
  it('runs steps in order and labels each result', async () => {
    const calls: string[] = [];
    const callTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push(`${name}:${args.name}`);
      return { content: [{ type: 'text' as const, text: `done ${name}` }] };
    });
    const result = await runRecipe('mk', twoStep, { name: 'Alpha' }, callTool);
    expect(calls).toEqual(['create_folder:Alpha', 'add_project:Alpha']);
    expect(result).toEqual({ ok: true, text: '[1/2 create_folder] done create_folder\n[2/2 add_project] done add_project' });
  });

  it('stops at the first failing step and says what did not run', async () => {
    const callTool = vi.fn(async (name: string) => ({
      content: [{ type: 'text' as const, text: `no ${name}` }],
      isError: name === 'create_folder',
    }));
    const result = await runRecipe('mk', twoStep, { name: 'A' }, callTool);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.text).toContain('Steps 2-2 of "mk" did not run.');
  });

  it('reports a thrown dispatch error the same way', async () => {
    const callTool = vi.fn(async () => {
      throw new Error('invalid args for create_folder: name: Required');
    });
    const result = await runRecipe('mk', twoStep, { name: 'A' }, callTool);
    expect(result.text).toMatch(/FAILED: invalid args/);
  });

  it('planRecipe surfaces param errors before anything runs', () => {
    expect(() => planRecipe(twoStep, {})).toThrow(/missing required/);
  });
});

describe('registryCallTool', () => {
  const extra = {} as any;

  it('rejects an unknown tool and strict-validates args, without reaching a handler', async () => {
    const call = registryCallTool(extra);
    await expect(call('nope', {})).rejects.toThrow(/no tool named "nope"/);
    await expect(call('create_folder', { name: 'a', bogus: 1 })).rejects.toThrow(/bogus/);
    await expect(call('create_folder', {})).rejects.toThrow(/name/);
  });
});
