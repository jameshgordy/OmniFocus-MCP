import { z } from 'zod';

/**
 * Recipes: templated calls to the existing tools (issue: automations).
 *
 * A recipe is a small JSON file that turns a multi-field tool call the model
 * would otherwise have to compose from scratch — project, tags, defer rule,
 * note boilerplate — into `run_automation("capture", {name: "..."})`. The
 * saving is in tokens and in mistakes: the shape is fixed once and reused.
 *
 *   {
 *     "description": "Capture a task into Inbox tagged quick",
 *     "params": {
 *       "name": { "description": "Task name", "required": true },
 *       "due":  { "description": "Due date (optional)" }
 *     },
 *     "steps": [
 *       { "tool": "add_omnifocus_task",
 *         "args": { "name": "{{name}}", "tags": ["quick"], "dueDate": "{{due}}" } }
 *     ]
 *   }
 *
 * Template rules, chosen so optional fields behave like optional tool args:
 *   - a string that is exactly `{{p}}` becomes the param's value, keeping its
 *     type (array, number, boolean, object)
 *   - a string containing `{{p}}` among other text interpolates it
 *   - if any referenced param is absent, the enclosing field (or array element)
 *     is dropped rather than sent as null or ""
 *   - `default` fills an absent param before the rules above apply
 */

export const paramSpecSchema = z.object({
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
}).strict();
export type RecipeParamSpec = z.infer<typeof paramSpecSchema>;

export const recipeSchema = z.object({
  description: z.string().min(1),
  params: z.record(paramSpecSchema).optional(),
  steps: z.array(
    z.object({
      tool: z.string().min(1),
      args: z.record(z.unknown()).default({}),
    }).strict()
  ).min(1),
}).strict();
export type Recipe = z.infer<typeof recipeSchema>;

/** Parse and validate recipe JSON text; throws a readable error on any problem. */
export function parseRecipe(text: string): Recipe {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`recipe is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = recipeSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`recipe is malformed: ${issues.join('; ')}`);
  }
  return parsed.data;
}

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Every param name referenced anywhere in the recipe's step args. */
export function referencedParams(recipe: Recipe): Set<string> {
  const names = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(PLACEHOLDER_RE)) names.add(m[1]);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  for (const step of recipe.steps) walk(step.args);
  return names;
}

/**
 * Merge caller params with declared defaults and check them. Unknown names are
 * an error, for the same reason unknown tool arguments are: a typo that is
 * silently ignored produces a confident wrong result.
 */
export function resolveParams(recipe: Recipe, given: Record<string, unknown>): Record<string, unknown> {
  const specs = recipe.params ?? {};
  const known = new Set([...Object.keys(specs), ...referencedParams(recipe)]);
  const unknown = Object.keys(given).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new Error(`unknown param(s): ${unknown.join(', ')}. This recipe accepts: ${[...known].join(', ') || '(none)'}.`);
  }
  const out: Record<string, unknown> = {};
  for (const name of known) {
    const spec = specs[name];
    if (given[name] !== undefined && given[name] !== null) out[name] = given[name];
    else if (spec && spec.default !== undefined) out[name] = spec.default;
  }
  const missing = Object.entries(specs)
    .filter(([name, spec]) => spec.required && out[name] === undefined)
    .map(([name]) => name);
  if (missing.length > 0) throw new Error(`missing required param(s): ${missing.join(', ')}`);
  return out;
}

/** Sentinel returned by `substitute` when a value should be dropped. */
const DROP = Symbol('drop');

function substitute(value: unknown, params: Record<string, unknown>): unknown | typeof DROP {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/);
    if (whole) return params[whole[1]] === undefined ? DROP : params[whole[1]];
    let dropped = false;
    const text = value.replace(PLACEHOLDER_RE, (_, name: string) => {
      const v = params[name];
      if (v === undefined) {
        dropped = true;
        return '';
      }
      return typeof v === 'string' ? v : JSON.stringify(v);
    });
    return dropped ? DROP : text;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substitute(v, params)).filter((v) => v !== DROP);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = substitute(v, params);
      if (r !== DROP) out[k] = r;
    }
    return out;
  }
  return value;
}

export interface ResolvedStep {
  tool: string;
  args: Record<string, unknown>;
}

/** The concrete tool calls a recipe makes for the given params. */
export function resolveSteps(recipe: Recipe, params: Record<string, unknown>): ResolvedStep[] {
  return recipe.steps.map((step) => ({
    tool: step.tool,
    args: substitute(step.args, params) as Record<string, unknown>,
  }));
}
