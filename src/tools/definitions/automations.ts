import { z } from 'zod';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ok, fail } from './toolResult.js';
import {
  listAutomations as listStored,
  loadAutomation,
  saveAutomation as saveStored,
  resolveAutomationDirs,
  type AutomationSummary,
} from '../automations/store.js';
import { parseRecipe } from '../automations/recipe.js';
import { planRecipe, registryCallTool, runRecipe, runScript, validateRecipeSteps } from '../automations/run.js';

/**
 * Automations: user-owned files that package repeated OmniFocus operations.
 * See `automations/store.ts` for the file layout and `automations/recipe.ts`
 * for the recipe format. These three tools are the whole surface: list, run,
 * save. Deleting or editing by hand is a file operation.
 */

const RECIPE_FORMAT_HINT =
  'Recipe JSON: {"description": "...", "params": {"p": {"description": "...", "required": true, "default": ...}}, ' +
  '"steps": [{"tool": "<tool name>", "args": {...}}]}. Use "{{p}}" in args; a field whose param is absent is dropped. ' +
  'Script: OmniJS source; a `params` object is in scope; the final expression is returned. ' +
  'Describe with leading `// @description ...` and `// @param name ...` lines.';

export const listSchema = z.object({});

export async function listHandler(_args: z.infer<typeof listSchema>, _extra: RequestHandlerExtra) {
  const dirs = resolveAutomationDirs();
  const items = listStored(dirs);
  const header = `Automation folder${dirs.length > 1 ? 's' : ''}: ${dirs.join(', ')}`;
  if (items.length === 0) {
    return ok(`${header}\nNo automations yet. Create one with save_automation.\n${RECIPE_FORMAT_HINT}`);
  }
  return ok([header, ...items.map(describe)].join('\n'));
}

function describe(a: AutomationSummary): string {
  const params = Object.entries(a.params).map(([name, spec]) => {
    const bits: string[] = [];
    if (spec.required) bits.push('required');
    if (spec.default !== undefined) bits.push(`default ${JSON.stringify(spec.default)}`);
    const tail = bits.length ? ` (${bits.join(', ')})` : '';
    return spec.description ? `${name}${tail}: ${spec.description}` : `${name}${tail}`;
  });
  const paramText = params.length ? `\n    params: ${params.join('; ')}` : '';
  return `- ${a.name} [${a.kind}] ${a.description}${paramText}`;
}

export const runSchema = z.object({
  name: z.string().describe('Automation name, as listed by list_automations'),
  params: z.record(z.unknown()).optional().describe('Parameter values'),
  dryRun: z.boolean().optional().describe('Show the resolved tool calls without running them (recipes only)'),
});

export async function runHandler(args: z.infer<typeof runSchema>, extra: RequestHandlerExtra) {
  let loaded;
  try {
    loaded = loadAutomation(args.name);
  } catch (err) {
    return fail(`Cannot load automation "${args.name}": ${(err as Error).message}`);
  }
  if (!loaded) {
    return fail(`No automation named "${args.name}". Run list_automations to see what exists.`);
  }
  const params = args.params ?? {};
  try {
    if (loaded.kind === 'script') {
      if (args.dryRun) return ok(`Script "${args.name}" would run with params ${JSON.stringify(params)}.`);
      const out = await runScript(loaded.source, params);
      return ok(out);
    }
    if (args.dryRun) {
      const steps = planRecipe(loaded.recipe, params);
      return ok(`Dry run of "${args.name}":\n${JSON.stringify(steps, null, 2)}`);
    }
    const result = await runRecipe(args.name, loaded.recipe, params, registryCallTool(extra));
    return result.ok ? ok(result.text) : fail(result.text);
  } catch (err) {
    return fail(`Automation "${args.name}" failed: ${(err as Error).message}`);
  }
}

export const saveSchema = z.object({
  name: z.string().describe('File-safe name: letters, digits, - and _'),
  kind: z.enum(['recipe', 'script']),
  content: z.string().describe('Recipe JSON or OmniJS source. Call list_automations for the format.'),
  overwrite: z.boolean().optional(),
});

export async function saveHandler(args: z.infer<typeof saveSchema>, _extra: RequestHandlerExtra) {
  if (args.kind === 'recipe') {
    let recipe;
    try {
      recipe = parseRecipe(args.content);
    } catch (err) {
      return fail(`Not saved. ${(err as Error).message}\n${RECIPE_FORMAT_HINT}`);
    }
    const problems = validateRecipeSteps(recipe);
    if (problems.length > 0) return fail(`Not saved. ${problems.join('; ')}`);
  }
  try {
    const path = saveStored(args.name, args.kind, args.content, { overwrite: args.overwrite });
    return ok(`Saved ${args.kind} "${args.name}" to ${path}`);
  } catch (err) {
    return fail(`Not saved. ${(err as Error).message}`);
  }
}
