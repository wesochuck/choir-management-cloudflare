import { z } from "zod";

import { requestIdSchema } from "./primitives";

export const nonprofitComplianceTaskKindSchema = z.enum([
  "irs_annual_return",
  "ohio_ag_annual_report",
  "ohio_continued_existence",
]);
export type NonprofitComplianceTaskKind = z.infer<typeof nonprofitComplianceTaskKindSchema>;

export const dateOnlyStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date.");
export type DateOnlyString = z.infer<typeof dateOnlyStringSchema>;

export const nonprofitComplianceTaskSchema = z.object({
  applicable: z.boolean(),
  id: z.uuid(),
  kind: nonprofitComplianceTaskKindSchema,
  lastCompletedDate: dateOnlyStringSchema.nullable(),
  nextDueDate: dateOnlyStringSchema.nullable(),
  nextReminderAt: z.iso.datetime().nullable(),
  recurrenceMonths: z.number().int().min(1).max(120),
  reminderIntervalDays: z.number().int().min(1).max(30),
  title: z.string().trim().min(1).max(200),
});
export type NonprofitComplianceTask = z.infer<typeof nonprofitComplianceTaskSchema>;

export const nonprofitComplianceSettingsSchema = z.object({
  enabled: z.boolean(),
  tasks: z.array(nonprofitComplianceTaskSchema).max(10),
});
export type NonprofitComplianceSettings = z.infer<typeof nonprofitComplianceSettingsSchema>;

export const nonprofitComplianceSettingsResponseSchema = nonprofitComplianceSettingsSchema.extend({
  requestId: requestIdSchema,
});
export type NonprofitComplianceSettingsResponse = z.infer<
  typeof nonprofitComplianceSettingsResponseSchema
>;

export const nonprofitComplianceToggleRequestSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type NonprofitComplianceToggleRequest = z.infer<
  typeof nonprofitComplianceToggleRequestSchema
>;

export const nonprofitComplianceTaskUpdateRequestSchema = z
  .object({
    applicable: z.boolean().optional(),
    nextDueDate: dateOnlyStringSchema.nullable().optional(),
    recurrenceMonths: z.number().int().min(1).max(120).optional(),
    taskId: z.uuid(),
  })
  .strict()
  .refine(
    (value) =>
      value.applicable !== undefined ||
      value.nextDueDate !== undefined ||
      value.recurrenceMonths !== undefined,
    "At least one task field must be provided.",
  );
export type NonprofitComplianceTaskUpdateRequest = z.infer<
  typeof nonprofitComplianceTaskUpdateRequestSchema
>;

export const nonprofitComplianceCompleteRequestSchema = z
  .object({
    completedDate: dateOnlyStringSchema.optional(),
    taskId: z.uuid(),
  })
  .strict();
export type NonprofitComplianceCompleteRequest = z.infer<
  typeof nonprofitComplianceCompleteRequestSchema
>;
