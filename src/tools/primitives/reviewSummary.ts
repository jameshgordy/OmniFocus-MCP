import { runOmniJs } from '../../utils/omniJs.js';

export interface ReviewSummaryParams {
  limit?: number;        // Max items listed per section (counts are always complete)
  dueSoonDays?: number;  // Window for the due-soon section
}

export interface ReviewItem {
  id: string;
  name: string;
  project?: string | null;
  folder?: string | null;
  date?: string | null;
  days?: number | null;
}

export interface ReviewSection {
  count: number;
  items: ReviewItem[];
}

export interface ReviewSummary {
  success: boolean;
  error?: string;
  inbox?: ReviewSection & { oldestDays: number | null };
  overdue?: ReviewSection;
  dueSoon?: ReviewSection;
  stalledProjects?: ReviewSection;
  reviewDue?: ReviewSection;
  flaggedCount?: number;
}

/**
 * One read for a weekly review. Definitions:
 * - stalled: an Active project (not inside a dropped folder) with no available
 *   action and nothing deferred to a future date — empty, or fully blocked.
 * - reviewDue: Active or OnHold project whose next review date is today or earlier.
 * Project ids are root-task ids, the form edit_item accepts.
 */
export const REVIEW_SUMMARY_BODY = `
      const DAY = 86400000;
      const now = new Date();
      const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
      const limit = params.limit;
      const iso = (d) => d ? d.toISOString() : null;
      const daysBetween = (a, b) => Math.floor((a - b) / DAY);
      const section = (arr, map) => ({ count: arr.length, items: arr.slice(0, limit).map(map) });
      const folderDropped = (p) => { let f = p.parentFolder; while (f) { if (f.status === Folder.Status.Dropped) return true; f = f.parent; } return false; };
      const isOpen = (t) => !t.completed && t.taskStatus !== Task.Status.Dropped && t.taskStatus !== Task.Status.Completed;
      const projName = (t) => t.containingProject ? t.containingProject.name : null;

      const openTasks = flattenedTasks.filter(t => isOpen(t) && !t.project);
      const liveProjects = flattenedProjects.filter(p => !folderDropped(p));

      const inboxTasks = openTasks.filter(t => t.inInbox).sort((a, b) => a.added - b.added);
      const overdue = openTasks.filter(t => t.effectiveDueDate && t.effectiveDueDate < now).sort((a, b) => a.effectiveDueDate - b.effectiveDueDate);
      const soonEnd = new Date(endOfToday.getTime() + params.dueSoonDays * DAY);
      const dueSoon = openTasks.filter(t => t.effectiveDueDate && t.effectiveDueDate >= now && t.effectiveDueDate <= soonEnd).sort((a, b) => a.effectiveDueDate - b.effectiveDueDate);
      const stalled = liveProjects.filter(p => p.status === Project.Status.Active).filter(p => {
        const remaining = p.flattenedTasks.filter(isOpen);
        const actionable = remaining.some(t => t.taskStatus === Task.Status.Available || t.taskStatus === Task.Status.Next || t.taskStatus === Task.Status.DueSoon || t.taskStatus === Task.Status.Overdue);
        // Work parked until a future date is scheduled, not stalled.
        const scheduled = remaining.some(t => t.effectiveDeferDate && t.effectiveDeferDate > now);
        return !actionable && !scheduled;
      });
      const reviewDue = liveProjects
        .filter(p => (p.status === Project.Status.Active || p.status === Project.Status.OnHold) && p.nextReviewDate && p.nextReviewDate <= endOfToday)
        .sort((a, b) => a.nextReviewDate - b.nextReviewDate);

      const taskItem = (dateOf) => (t) => ({ id: t.id.primaryKey, name: t.name, project: projName(t), date: iso(dateOf(t)) });
      const projectItem = (p) => ({ id: p.task.id.primaryKey, name: p.name, folder: p.parentFolder ? p.parentFolder.name : null });

      return {
        success: true,
        inbox: Object.assign(section(inboxTasks, t => ({ id: t.id.primaryKey, name: t.name, days: t.added ? daysBetween(now, t.added) : null })),
          { oldestDays: inboxTasks.length && inboxTasks[0].added ? daysBetween(now, inboxTasks[0].added) : null }),
        overdue: section(overdue, taskItem(t => t.effectiveDueDate)),
        dueSoon: section(dueSoon, taskItem(t => t.effectiveDueDate)),
        stalledProjects: section(stalled, p => Object.assign(projectItem(p), { days: p.task.modified ? daysBetween(now, p.task.modified) : null })),
        reviewDue: section(reviewDue, p => Object.assign(projectItem(p), { date: iso(p.nextReviewDate), days: daysBetween(now, p.nextReviewDate) })),
        flaggedCount: openTasks.filter(t => t.flagged).length,
      };
`;

export async function getReviewSummary(params: ReviewSummaryParams): Promise<ReviewSummary> {
  const limit = params.limit ?? 15;
  const dueSoonDays = params.dueSoonDays ?? 7;
  if (!Number.isInteger(limit) || limit < 0) return { success: false, error: 'limit must be a non-negative integer' };
  if (!Number.isInteger(dueSoonDays) || dueSoonDays < 0) return { success: false, error: 'dueSoonDays must be a non-negative integer' };
  try {
    return await runOmniJs<ReviewSummary>(REVIEW_SUMMARY_BODY, { limit, dueSoonDays }, { write: false });
  } catch (error: any) {
    return { success: false, error: error?.message || 'Unknown error in getReviewSummary' };
  }
}
