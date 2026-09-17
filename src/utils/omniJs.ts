import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runOsascriptFile } from './scriptExecution.js';

/**
 * Run an Omni Automation (OmniJS) script inside OmniFocus with caller-supplied
 * values passed as DATA, never as source.
 *
 * The older primitives splice escaped user strings into AppleScript or JS
 * source. Every splice site is an escaping bug waiting to happen (#103), and in
 * a JS context a missed escape is code execution inside the user's database.
 * Here the params object is serialized with JSON.stringify — a JSON document is
 * a valid JS expression, so no user-controlled text is ever parsed as code —
 * and the whole OmniJS program is itself handed to `evaluateJavascript` as a
 * JSON string literal rather than a template literal.
 *
 * Contract for `body`: a static function body that reads `params` and returns
 * a plain object. It must not interpolate any runtime value. The wrapper
 * stringifies the returned object and converts thrown errors into
 * `{ success: false, error }`.
 */
export function buildOmniJsProgram(body: string, params: unknown): string {
  return `(() => {
  const params = ${JSON.stringify(params ?? {})};
  try {
    const __result = (() => {
${body}
    })();
    return JSON.stringify(__result);
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e && e.message ? e.message : e) });
  }
})()`;
}

/** The JXA launcher: evaluates the OmniJS program passed as a JSON string literal. */
export function buildJxaLauncher(program: string): string {
  return `function run() {
  const app = Application('OmniFocus');
  return app.evaluateJavascript(${JSON.stringify(program)});
}`;
}

export interface OmniJsOptions {
  /**
   * Reads may retry on an app-reported timeout. Writes must not: a timed-out
   * write may have partially applied, and retrying a create duplicates it.
   */
  write: boolean;
}

export async function runOmniJs<T = any>(body: string, params: unknown, options: OmniJsOptions): Promise<T> {
  const tempFile = join(tmpdir(), `omnijs_${crypto.randomUUID()}.js`);
  writeFileSync(tempFile, buildJxaLauncher(buildOmniJsProgram(body, params)), { encoding: 'utf8' });
  try {
    const { stdout, stderr } = await runOsascriptFile(tempFile, {
      language: 'JavaScript',
      retryOnTimeout: !options.write,
    });
    if (stderr) {
      console.error('OmniJS stderr:', stderr);
    }
    try {
      return JSON.parse(stdout) as T;
    } catch {
      return { success: false, error: `Failed to parse result: ${stdout}` } as T;
    }
  } finally {
    try { unlinkSync(tempFile); } catch {}
  }
}

/**
 * OmniJS helpers shared by the management primitives. Static source only — the
 * same no-interpolation contract as `body` applies.
 *
 * - `findFolder(ref)`: ref is `{id}` or `{path}`; path is "A/B/C" matched on the
 *   full ancestor chain, or a bare name matched anywhere. Throws a readable
 *   error when nothing (or, for a bare name, more than one folder) matches.
 * - `findTag(ref)`: same shape for tags, path separator "/".
 * - `findProject(id)`: accepts the AppleScript project id (root task id) or the
 *   OmniJS project id.
 */
export const OMNIJS_LOOKUP_HELPERS = `
      const splitPath = (p) => String(p).split('/').map(s => s.trim()).filter(s => s.length > 0);
      const chainOf = (item) => { const names = []; let cur = item; while (cur) { names.unshift(cur.name); cur = cur.parent; } return names; };
      const resolveByPath = (all, byId, ref, kind) => {
        if (ref.id) {
          const hit = byId(ref.id);
          if (!hit) throw new Error(kind + ' not found: ' + ref.id);
          return hit;
        }
        const parts = splitPath(ref.path);
        if (parts.length === 0) throw new Error(kind + ' not found: ' + ref.path);
        const leaf = parts[parts.length - 1];
        const candidates = all.filter(x => x.name === leaf);
        const matches = parts.length === 1 ? candidates : candidates.filter(x => {
          const chain = chainOf(x);
          return chain.length === parts.length && chain.every((n, i) => n === parts[i]);
        });
        if (matches.length === 0) throw new Error(kind + ' not found: ' + ref.path);
        if (matches.length > 1) throw new Error('Ambiguous ' + kind.toLowerCase() + ' name "' + ref.path + '" matches ' + matches.length + ' items; use the full path or id');
        return matches[0];
      };
      const findFolder = (ref) => resolveByPath(flattenedFolders, (id) => Folder.byIdentifier(id), ref, 'Folder');
      const findTag = (ref) => resolveByPath(flattenedTags, (id) => Tag.byIdentifier(id), ref, 'Tag');
      const findProject = (id) => {
        const direct = Project.byIdentifier(id);
        if (direct) return direct;
        const hit = flattenedProjects.find(p => p.task.id.primaryKey === id);
        if (!hit) throw new Error('Project not found: ' + id);
        return hit;
      };
`;
