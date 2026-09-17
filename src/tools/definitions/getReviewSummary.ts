import { z } from 'zod';
import { getReviewSummary, ReviewItem, ReviewSection } from '../primitives/reviewSummary.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ok, fail } from './toolResult.js';

export const schema = z.object({
  limit: z.number().int().min(0).optional().describe("Max items listed per section (default 15)"),
  dueSoonDays: z.number().int().min(0).optional().describe("Due-soon window in days (default 7)")
});

function day(iso?: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

function renderSection(title: string, section: ReviewSection | undefined, line: (i: ReviewItem) => string): string {
  if (!section) return '';
  const shown = section.items.length;
  const more = section.count > shown ? `\n  …and ${section.count - shown} more` : '';
  const body = shown ? '\n' + section.items.map(i => `  - ${line(i)}`).join('\n') : '';
  return `## ${title} (${section.count})${body}${more}`;
}

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const r = await getReviewSummary(args);
    if (!r.success) return fail(`Failed to build review summary: ${r.error}`);
    const where = (i: ReviewItem) => i.project ? ` [${i.project}]` : '';
    const inFolder = (i: ReviewItem) => i.folder ? ` [${i.folder}]` : '';
    const inboxTitle = `Inbox${r.inbox?.oldestDays != null ? `, oldest ${r.inbox.oldestDays}d` : ''}`;
    const text = [
      renderSection('Overdue', r.overdue, i => `${i.name}${where(i)} due ${day(i.date)} (id: ${i.id})`),
      renderSection(`Due within ${args.dueSoonDays ?? 7} days`, r.dueSoon, i => `${i.name}${where(i)} due ${day(i.date)} (id: ${i.id})`),
      renderSection(inboxTitle, r.inbox, i => `${i.name} (${i.days}d, id: ${i.id})`),
      renderSection('Stalled projects (no available or scheduled actions)', r.stalledProjects, i => `${i.name}${inFolder(i)} (id: ${i.id})`),
      renderSection('Projects due for review', r.reviewDue, i => `${i.name}${inFolder(i)} ${i.days}d overdue (id: ${i.id})`),
      `Flagged open tasks: ${r.flaggedCount}`,
    ].filter(Boolean).join('\n\n');
    return ok(text);
  } catch (err: unknown) {
    return fail(`Error building review summary: ${(err as Error).message}`);
  }
}
