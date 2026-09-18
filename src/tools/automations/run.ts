import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { z } from 'zod';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { findTool, type ToolResult } from '../registry.js';
import { deepStrict } from '../../utils/strictSchema.js';
import { executeOmniFocusScript } from '../../utils/scriptExecution.js';
import { resolveParams, resolveSteps, type Recipe, type ResolvedStep } from './recipe.js';

export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

/**
 * Dispatch a recipe step to a registered tool, validated exactly as a client
 * call would be — strict at every depth — so a recipe with a stale or misspelled
 * field fails loudly instead of running a silently narrower call.
 */
export function registryCallTool(extra: RequestHandlerExtra): CallTool {
  return async (name, args) => {
    const entry = findTool(name);
    if (!entry) throw new Error(`no tool named "${name}"`);
    const parsed = deepStrict(entry.schema).safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
      throw new Error(`invalid args for ${name}: ${issues.join('; ')}`);
    }
    return entry.handler(parsed.data, extra);
  };
}

/** Check every step names a real tool and its args pass that tool's schema (with placeholders left as-is). */
export function validateRecipeSteps(recipe: Recipe): string[] {
  const problems: string[] = [];
  recipe.steps.forEach((step, i) => {
    const entry = findTool(step.tool);
    if (!entry) {
      problems.push(`step ${i + 1}: no tool named "${step.tool}"`);
      return;
    }
    // Unknown keys are the useful check here; placeholder strings may legitimately
    // fail type checks (e.g. "{{tags}}" standing in for an array), so only report
    // unrecognized-key issues at validation time.
    const parsed = deepStrict(entry.schema).safeParse(step.args);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.code === z.ZodIssueCode.unrecognized_keys) {
          problems.push(`step ${i + 1} (${step.tool}): unknown key(s) ${issue.keys.join(', ')}`);
        }
      }
    }
  });
  return problems;
}

export interface RunRecipeResult {
  ok: boolean;
  text: string;
}

/** Resolve params and steps; returns the concrete calls without executing them. */
export function planRecipe(recipe: Recipe, given: Record<string, unknown>): ResolvedStep[] {
  const params = resolveParams(recipe, given);
  return resolveSteps(recipe, params);
}

/**
 * Run a recipe's steps in order, stopping at the first failure. The output
 * names each step so the caller can tell which part of a multi-step recipe
 * did what — and, on failure, which steps never ran.
 */
export async function runRecipe(
  name: string,
  recipe: Recipe,
  given: Record<string, unknown>,
  callTool: CallTool
): Promise<RunRecipeResult> {
  const steps = planRecipe(recipe, given);
  const lines: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = steps.length > 1 ? `[${i + 1}/${steps.length} ${step.tool}] ` : '';
    let result: ToolResult;
    try {
      result = await callTool(step.tool, step.args);
    } catch (err) {
      lines.push(`${label}FAILED: ${(err as Error).message}`);
      if (i < steps.length - 1) lines.push(`Steps ${i + 2}-${steps.length} of "${name}" did not run.`);
      return { ok: false, text: lines.join('\n') };
    }
    const text = result.content.map((c) => c.text).join('\n');
    lines.push(`${label}${text}`);
    if (result.isError) {
      if (i < steps.length - 1) lines.push(`Steps ${i + 2}-${steps.length} of "${name}" did not run.`);
      return { ok: false, text: lines.join('\n') };
    }
  }
  return { ok: true, text: lines.join('\n') };
}

/**
 * Run an OmniJS script inside OmniFocus with `params` in scope. The script's
 * final expression is its output (a JSON string by convention, as with the
 * built-in scripts). No -1712 retry: a user script may write.
 */
export async function runScript(source: string, params: Record<string, unknown>): Promise<string> {
  const wrapped = `const params = ${JSON.stringify(params)};\n${source}`;
  const tempFile = join(tmpdir(), `omnifocus_automation_${crypto.randomUUID()}.js`);
  writeFileSync(tempFile, wrapped, 'utf8');
  try {
    const result = await executeOmniFocusScript(tempFile, undefined, { retryOnTimeout: false });
    if (typeof result === 'string') return result;
    if (result === undefined || result === null) return '(script returned nothing)';
    return JSON.stringify(result, null, 2);
  } finally {
    try {
      unlinkSync(tempFile);
    } catch {
      /* already gone */
    }
  }
}
