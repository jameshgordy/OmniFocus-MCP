import { runOmniJs, OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJs.js';

export type ReviewUnit = 'day' | 'week' | 'month' | 'year';

export interface ProjectSettings {
  reviewInterval?: { steps: number; unit: ReviewUnit };
  singleActionList?: boolean;
  completedByChildren?: boolean;
}

export interface ProjectSettingsResult {
  success: boolean;
  changed?: string[];
  error?: string;
}

export function hasProjectSettings(s: ProjectSettings): boolean {
  return s.reviewInterval !== undefined || s.singleActionList !== undefined || s.completedByChildren !== undefined;
}

/**
 * Settings the AppleScript path does not cover. Returns an error string for
 * combinations OmniFocus would silently resolve in an unexpected way, or null.
 */
export function validateProjectSettings(s: ProjectSettings, sequential?: boolean): string | null {
  if (s.reviewInterval !== undefined) {
    const { steps } = s.reviewInterval;
    if (!Number.isInteger(steps) || steps < 1) return 'reviewInterval.steps must be a positive integer';
  }
  // A project is either sequential, parallel, or a single-action list. Setting
  // both flags makes OmniFocus pick one and discard the other without telling us.
  if (s.singleActionList === true && sequential === true) {
    return 'A project cannot be both sequential and a single-action list';
  }
  return null;
}

export const APPLY_PROJECT_SETTINGS_BODY = `${OMNIJS_LOOKUP_HELPERS}
      const project = findProject(params.projectId);
      const s = params.settings;
      const changed = [];
      if (s.reviewInterval) {
        // ReviewInterval is a value object: mutate a copy, then assign it back.
        const ri = project.reviewInterval;
        ri.steps = s.reviewInterval.steps;
        ri.unit = s.reviewInterval.unit + 's';
        project.reviewInterval = ri;
        changed.push('review interval');
      }
      if (s.singleActionList !== undefined) {
        project.containsSingletonActions = s.singleActionList;
        changed.push('single-action list');
      }
      if (s.completedByChildren !== undefined) {
        project.completedByChildren = s.completedByChildren;
        changed.push('complete with last action');
      }
      return { success: true, changed };
`;

export async function applyProjectSettings(projectId: string, settings: ProjectSettings): Promise<ProjectSettingsResult> {
  try {
    return await runOmniJs<ProjectSettingsResult>(APPLY_PROJECT_SETTINGS_BODY, { projectId, settings }, { write: true });
  } catch (error: any) {
    return { success: false, error: error?.message || 'Unknown error applying project settings' };
  }
}
