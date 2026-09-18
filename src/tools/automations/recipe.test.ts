import { describe, it, expect } from 'vitest';
import { parseRecipe, resolveParams, resolveSteps, referencedParams } from './recipe.js';

const capture = parseRecipe(JSON.stringify({
  description: 'Capture into Inbox',
  params: {
    name: { description: 'Task name', required: true },
    due: { description: 'Due date' },
    tags: { default: ['quick'] },
  },
  steps: [
    { tool: 'add_omnifocus_task', args: { name: '{{name}}', dueDate: '{{due}}', tags: '{{tags}}', note: 'via {{source}}' } },
  ],
}));

describe('parseRecipe', () => {
  it('rejects non-JSON with a readable message', () => {
    expect(() => parseRecipe('{nope')).toThrow(/not valid JSON/);
  });

  it('names the malformed field', () => {
    expect(() => parseRecipe(JSON.stringify({ description: 'x', steps: [] }))).toThrow(/steps/);
    expect(() => parseRecipe(JSON.stringify({ description: 'x', steps: [{ tool: 'a', args: {}, extra: 1 }] }))).toThrow(/extra/);
  });

  it('defaults missing step args to an empty object', () => {
    const r = parseRecipe(JSON.stringify({ description: 'x', steps: [{ tool: 'list_tags' }] }));
    expect(r.steps[0].args).toEqual({});
  });
});

describe('resolveParams', () => {
  it('finds every placeholder, declared or not', () => {
    expect([...referencedParams(capture)].sort()).toEqual(['due', 'name', 'source', 'tags']);
  });

  it('applies defaults and reports missing required params', () => {
    expect(resolveParams(capture, { name: 'Buy milk' })).toEqual({ name: 'Buy milk', tags: ['quick'] });
    expect(() => resolveParams(capture, {})).toThrow(/missing required param\(s\): name/);
  });

  it('rejects unknown params rather than ignoring them', () => {
    expect(() => resolveParams(capture, { name: 'x', nmae: 'typo' })).toThrow(/unknown param\(s\): nmae/);
  });

  it('treats null as absent so a default still applies', () => {
    expect(resolveParams(capture, { name: 'x', tags: null })).toEqual({ name: 'x', tags: ['quick'] });
  });
});

describe('resolveSteps', () => {
  it('substitutes whole-string placeholders keeping their type, and drops absent ones', () => {
    const [step] = resolveSteps(capture, resolveParams(capture, { name: 'Buy milk' }));
    expect(step).toEqual({ tool: 'add_omnifocus_task', args: { name: 'Buy milk', tags: ['quick'] } });
  });

  it('interpolates inline placeholders when present', () => {
    const [step] = resolveSteps(capture, resolveParams(capture, { name: 'x', source: 'email', due: '2026-09-20' }));
    expect(step.args).toMatchObject({ note: 'via email', dueDate: '2026-09-20' });
  });

  it('drops array elements whose placeholder is absent', () => {
    const r = parseRecipe(JSON.stringify({
      description: 'x',
      steps: [{ tool: 'add_omnifocus_task', args: { tags: ['always', '{{extra}}'] } }],
    }));
    expect(resolveSteps(r, {})[0].args).toEqual({ tags: ['always'] });
    expect(resolveSteps(r, { extra: 'more' })[0].args).toEqual({ tags: ['always', 'more'] });
  });

  it('substitutes inside nested objects and passes non-string values through', () => {
    const r = parseRecipe(JSON.stringify({
      description: 'x',
      steps: [{ tool: 'query_omnifocus', args: { entity: 'tasks', filters: { projectName: '{{project}}', flagged: true }, limit: 5 } }],
    }));
    expect(resolveSteps(r, { project: 'Home' })[0].args).toEqual({
      entity: 'tasks', filters: { projectName: 'Home', flagged: true }, limit: 5,
    });
  });
});
