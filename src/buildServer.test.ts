import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/**
 * Unknown argument keys must be rejected, not silently stripped. This drives a
 * real MCP client through the server built by `createOmniFocusServer`, because
 * the strictness lives in a post-registration patch of SDK internals
 * (`rejectUnknownArguments`) — a unit test of the schema object alone would
 * pass even if the patch stopped taking effect.
 */

// Belt and braces: no test path below should reach OmniFocus, and if one does
// it must fail rather than spawn osascript against the live database.
vi.mock('./utils/scriptExecution.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/scriptExecution.js')>();
  return {
    ...actual,
    runOsascriptFile: vi.fn(async () => {
      throw new Error('test reached osascript');
    }),
    executeOmniFocusScript: vi.fn(async () => {
      throw new Error('test reached osascript');
    }),
  };
});

import { createOmniFocusServer } from './buildServer.js';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

async function connectedClient() {
  const { server } = createOmniFocusServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('tool arguments are strict', () => {
  it('edit_item rejects a misspelled field and names it', async () => {
    const client = await connectedClient();
    await expect(
      client.callTool({
        name: 'edit_item',
        arguments: { id: 'abc', itemType: 'task', note: 'typo for newNote' },
      })
    ).rejects.toThrow(/note/);
  });

  it('edit_item with nothing to change is an error result, not a success line', async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: 'edit_item',
      arguments: { id: 'abc', itemType: 'task' },
    })) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('newNote');
  });

  it('every tool advertises additionalProperties: false', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(5);
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });

  it('a well-formed call still reaches the handler', async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: 'edit_item',
      arguments: { itemType: 'task', newNote: 'x' },
    })) as any;
    // No id or name → the handler's own validation, proving strictness let
    // the recognized keys through.
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Either id or name');
  });
});

describe('nested objects are strict too', () => {
  it('query_omnifocus rejects a misspelled filter instead of running unfiltered', async () => {
    const client = await connectedClient();
    await expect(
      client.callTool({
        name: 'query_omnifocus',
        arguments: { entity: 'tasks', filters: { inInbox: true }, summary: true },
      })
    ).rejects.toThrow(/inInbox/);
  });

  it('batch_add_items rejects an unknown key inside an item, and inside its repeat', async () => {
    const client = await connectedClient();
    await expect(
      client.callTool({
        name: 'batch_add_items',
        arguments: { items: [{ type: 'task', name: 'x', note: 'ok', dueDat: 'typo' }] },
      })
    ).rejects.toThrow(/dueDat/);
    await expect(
      client.callTool({
        name: 'batch_add_items',
        arguments: { items: [{ type: 'task', name: 'x', repeat: { every: 'week', bogus: 1 } }] },
      })
    ).rejects.toThrow(/bogus/);
  });

  it('the advertised JSON schema carries additionalProperties: false at depth', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const query = tools.find(t => t.name === 'query_omnifocus')!;
    const filters = (query.inputSchema.properties as any).filters;
    expect(filters.additionalProperties).toBe(false);
    const batch = tools.find(t => t.name === 'batch_add_items')!;
    const item = (batch.inputSchema.properties as any).items.items;
    expect(item.additionalProperties).toBe(false);
  });

  it('descriptions, optionality and nullability survive the rebuild', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const edit = tools.find(t => t.name === 'edit_item')!;
    const props = edit.inputSchema.properties as any;
    expect(props.newNote.description).toBe('New note');
    expect(edit.inputSchema.required).toEqual(['itemType']);
    // newRepeat is nullable().optional(): null must still clear, not be rejected
    const r = (await client.callTool({
      name: 'edit_item',
      arguments: { itemType: 'task', newRepeat: null },
    })) as any;
    expect(r.content[0].text).toContain('Either id or name');
  });
});

describe('automations through a real client', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'of-auto-'));
    process.env.OMNIFOCUS_MCP_AUTOMATIONS_DIR = dir;
  });
  afterEach(() => {
    delete process.env.OMNIFOCUS_MCP_AUTOMATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists nothing, then saves and lists a recipe', async () => {
    const client = await connectedClient();
    const empty = (await client.callTool({ name: 'list_automations', arguments: {} })) as any;
    expect(empty.content[0].text).toContain('No automations yet');
    expect(empty.content[0].text).toContain(dir);

    const saved = (await client.callTool({
      name: 'save_automation',
      arguments: {
        name: 'capture',
        kind: 'recipe',
        content: JSON.stringify({
          description: 'Capture into Inbox',
          params: { name: { required: true, description: 'Task name' } },
          steps: [{ tool: 'add_omnifocus_task', args: { name: '{{name}}', tags: ['quick'] } }],
        }),
      },
    })) as any;
    expect(saved.isError).toBeUndefined();
    expect(saved.content[0].text).toContain(join(dir, 'capture.json'));

    const listed = (await client.callTool({ name: 'list_automations', arguments: {} })) as any;
    expect(listed.content[0].text).toContain('- capture [recipe] Capture into Inbox');
    expect(listed.content[0].text).toContain('name (required): Task name');
  });

  it('refuses to save a recipe whose step has a misspelled tool argument', async () => {
    const client = await connectedClient();
    const r = (await client.callTool({
      name: 'save_automation',
      arguments: {
        name: 'bad',
        kind: 'recipe',
        content: JSON.stringify({ description: 'x', steps: [{ tool: 'add_omnifocus_task', args: { nmae: 'x' } }] }),
      },
    })) as any;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('nmae');
  });

  it('dry-runs a recipe to show the resolved calls, and rejects bad params', async () => {
    writeFileSync(join(dir, 'capture.json'), JSON.stringify({
      description: 'x',
      params: { name: { required: true } },
      steps: [{ tool: 'add_omnifocus_task', args: { name: '{{name}}', dueDate: '{{due}}' } }],
    }));
    const client = await connectedClient();
    const dry = (await client.callTool({
      name: 'run_automation',
      arguments: { name: 'capture', params: { name: 'Milk' }, dryRun: true },
    })) as any;
    expect(dry.isError).toBeUndefined();
    expect(JSON.parse(dry.content[0].text.split('\n').slice(1).join('\n'))).toEqual([
      { tool: 'add_omnifocus_task', args: { name: 'Milk' } },
    ]);

    const bad = (await client.callTool({
      name: 'run_automation',
      arguments: { name: 'capture', params: { title: 'Milk' } },
    })) as any;
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/unknown param\(s\): title/);
  });

  it('a real run dispatches to the tool, whose osascript is mocked to fail', async () => {
    writeFileSync(join(dir, 'tags.json'), JSON.stringify({
      description: 'x', steps: [{ tool: 'list_tags', args: {} }],
    }));
    const client = await connectedClient();
    const r = (await client.callTool({ name: 'run_automation', arguments: { name: 'tags' } })) as any;
    // list_tags reached executeOmniFocusScript (mocked above to throw), which
    // proves the recipe dispatched to the real handler.
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('test reached osascript');
  });

  it('names a missing automation instead of guessing', async () => {
    const client = await connectedClient();
    const r = (await client.callTool({ name: 'run_automation', arguments: { name: 'ghost' } })) as any;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('No automation named "ghost"');
  });
});
