import { z } from 'zod';

/** Review cadence for projects, shared by add_project, edit_item and the batch tools. */
export const reviewIntervalShape = z.object({
  steps: z.number().int().min(1).describe("Every N units"),
  unit: z.enum(['day', 'week', 'month', 'year']),
}).describe("Review interval");
