import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { delimiter, join, resolve } from 'path';
import { parseRecipe, type Recipe, type RecipeParamSpec } from './recipe.js';

/**
 * Where automations live and how they are found (recipes and scripts).
 *
 * An automation is a file in one of the configured directories. The file name
 * is the automation's name; the extension says what kind it is:
 *
 *   <name>.json          a recipe — templated calls to the existing tools
 *   <name>.js / .omnijs  a script — OmniJS run inside OmniFocus
 *
 * Directories come from OMNIFOCUS_MCP_AUTOMATIONS_DIR, which may list several
 * separated by the platform path delimiter (`:` on macOS). Earlier directories
 * win on a name clash, and `save_automation` writes to the first one. The
 * default is a directory of the user's own, not anything tied to one client,
 * because the same files should serve every MCP client on the machine.
 *
 * Nothing is cached: files are re-read on every call, so an automation edited
 * in a text editor or dropped in by another agent is live immediately.
 */

export const DEFAULT_AUTOMATIONS_DIR = join(homedir(), '.omnifocus-mcp', 'automations');

/** Names are file stems, so they must be safe as file names and free of path tricks. */
export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export type AutomationKind = 'recipe' | 'script';

export interface AutomationSummary {
  name: string;
  kind: AutomationKind;
  description: string;
  params: Record<string, RecipeParamSpec>;
  path: string;
}

export interface LoadedRecipe extends AutomationSummary {
  kind: 'recipe';
  recipe: Recipe;
}
export interface LoadedScript extends AutomationSummary {
  kind: 'script';
  source: string;
}
export type LoadedAutomation = LoadedRecipe | LoadedScript;

export function resolveAutomationDirs(raw: string | undefined = process.env.OMNIFOCUS_MCP_AUTOMATIONS_DIR): string[] {
  const dirs = (raw ?? '')
    .split(delimiter)
    .map((d) => d.trim())
    .filter(Boolean)
    .map(expandHome);
  return dirs.length > 0 ? dirs : [DEFAULT_AUTOMATIONS_DIR];
}

function expandHome(p: string): string {
  return p.startsWith('~/') || p === '~' ? join(homedir(), p.slice(1)) : resolve(p);
}

function kindOf(file: string): AutomationKind | null {
  if (file.endsWith('.json')) return 'recipe';
  if (file.endsWith('.js') || file.endsWith('.omnijs')) return 'script';
  return null;
}

function stemOf(file: string): string {
  return file.replace(/\.(json|js|omnijs)$/, '');
}

/**
 * Every automation across the configured directories, first directory winning
 * on a name clash. A file that fails to parse is still listed, with the error
 * as its description, so a broken recipe is visible rather than silently absent.
 */
export function listAutomations(dirs: string[] = resolveAutomationDirs()): AutomationSummary[] {
  const seen = new Map<string, AutomationSummary>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).sort()) {
      const kind = kindOf(file);
      if (!kind) continue;
      const name = stemOf(file);
      if (!NAME_RE.test(name) || seen.has(name)) continue;
      const path = join(dir, file);
      if (!statSync(path).isFile()) continue;
      try {
        const loaded = loadFile(name, kind, path);
        seen.set(name, summaryOf(loaded));
      } catch (err) {
        seen.set(name, { name, kind, description: `INVALID: ${(err as Error).message}`, params: {}, path });
      }
    }
  }
  return [...seen.values()];
}

function summaryOf(a: LoadedAutomation): AutomationSummary {
  const { name, kind, description, params, path } = a;
  return { name, kind, description, params, path };
}

/** Load one automation by name, or null if no directory has it. Throws if the file is invalid. */
export function loadAutomation(name: string, dirs: string[] = resolveAutomationDirs()): LoadedAutomation | null {
  if (!NAME_RE.test(name)) throw new Error(`Invalid automation name "${name}"; use letters, digits, - and _.`);
  for (const dir of dirs) {
    for (const ext of ['json', 'js', 'omnijs']) {
      const path = join(dir, `${name}.${ext}`);
      if (existsSync(path) && statSync(path).isFile()) {
        return loadFile(name, kindOf(path)!, path);
      }
    }
  }
  return null;
}

function loadFile(name: string, kind: AutomationKind, path: string): LoadedAutomation {
  const text = readFileSync(path, 'utf8');
  if (kind === 'recipe') {
    const recipe = parseRecipe(text);
    return { name, kind, path, description: recipe.description, params: recipe.params ?? {}, recipe };
  }
  const meta = parseScriptHeader(text);
  return { name, kind, path, description: meta.description, params: meta.params, source: text };
}

/**
 * Script metadata lives in leading line comments, so a script is a plain OmniJS
 * file that also runs unchanged from OmniFocus's own automation menu:
 *
 *   // @description Complete every task tagged "today" that is overdue
 *   // @param days   How far back to look (default: 7)
 *   // @param dryRun Set true to only report
 *
 * `@param` names are surfaced to the caller; the script reads them from `params`.
 */
export function parseScriptHeader(source: string): { description: string; params: Record<string, RecipeParamSpec> } {
  let description = '';
  const params: Record<string, RecipeParamSpec> = {};
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('//')) {
      if (trimmed === '' || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      break;
    }
    const body = trimmed.replace(/^\/\/\s?/, '');
    const desc = body.match(/^@description\s+(.*)$/);
    if (desc) {
      description = desc[1].trim();
      continue;
    }
    const param = body.match(/^@param\s+(\w+)\s*(.*)$/);
    if (param) params[param[1]] = { description: param[2].trim() || undefined };
  }
  return { description, params };
}

export interface SaveOptions {
  overwrite?: boolean;
  dirs?: string[];
}

/**
 * Write an automation file into the first configured directory. Recipes are
 * validated before anything touches disk, so a bad recipe is never saved.
 * Returns the path written.
 */
export function saveAutomation(
  name: string,
  kind: AutomationKind,
  content: string,
  options: SaveOptions = {}
): string {
  if (!NAME_RE.test(name)) throw new Error(`Invalid automation name "${name}"; use letters, digits, - and _.`);
  const dirs = options.dirs ?? resolveAutomationDirs();
  const dir = dirs[0];
  if (kind === 'recipe') parseRecipe(content); // throws with a useful message
  const ext = kind === 'recipe' ? 'json' : 'js';
  const path = join(dir, `${name}.${ext}`);
  const existing = loadAutomation(name, dirs);
  if (existing && !options.overwrite) {
    throw new Error(`Automation "${name}" already exists at ${existing.path}; pass overwrite: true to replace it.`);
  }
  mkdirSync(dir, { recursive: true });
  const text = kind === 'recipe' ? JSON.stringify(JSON.parse(content), null, 2) + '\n' : content.endsWith('\n') ? content : content + '\n';
  writeFileSync(path, text, 'utf8');
  return path;
}
