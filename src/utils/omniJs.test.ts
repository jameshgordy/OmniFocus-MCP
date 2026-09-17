import { describe, it, expect } from 'vitest';
import vm from 'vm';
import { buildOmniJsProgram, buildJxaLauncher } from './omniJs.js';

// Strings that break naive splicing into JS or AppleScript source.
const HOSTILE = [
  'plain',
  'quote " and \' single',
  'backtick ` and ${template}',
  'backslash \\ and \\" escaped quote',
  '"); globalThis.pwned = true; ("',
  '*/ globalThis.pwned = true; /*',
  'line\nbreak\r\nand\ttab',
  'unicode   separator   and emoji 🚀',
];

describe('buildOmniJsProgram', () => {
  it.each(HOSTILE)('passes %j through as data, byte for byte, without executing it', (value) => {
    const program = buildOmniJsProgram('return { echo: params.value };', { value });
    const sandbox: Record<string, unknown> = {};
    const out = JSON.parse(vm.runInNewContext(program, sandbox));
    expect(out.echo).toBe(value);
    expect(sandbox.pwned).toBeUndefined();
  });

  it('turns a thrown error into a failure result', () => {
    const program = buildOmniJsProgram('throw new Error("boom");', {});
    expect(JSON.parse(vm.runInNewContext(program, {}))).toEqual({ success: false, error: 'boom' });
  });

  it('defaults missing params to an empty object', () => {
    const program = buildOmniJsProgram('return { keys: Object.keys(params).length };', undefined);
    expect(JSON.parse(vm.runInNewContext(program, {}))).toEqual({ keys: 0 });
  });
});

describe('buildJxaLauncher', () => {
  it.each(HOSTILE)('embeds the program as a string literal that decodes exactly (%j)', (value) => {
    const program = buildOmniJsProgram('return { echo: params.value };', { value });
    const launcher = buildJxaLauncher(program);
    let received: string | undefined;
    const sandbox = { Application: () => ({ evaluateJavascript: (src: string) => { received = src; return 'ok'; } }) };
    vm.runInNewContext(`${launcher}\nrun();`, sandbox);
    expect(received).toBe(program);
  });
});
