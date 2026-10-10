import { z } from "zod";

import { requestIdSchema } from "./primitives";

export const nonprofitComplianceTaskKindSchema = z.enum([
  "irs_annual_return",
  "ohio_ag_annual_report",
  "ohio_continued_existence",
  "ohio_unclaimed_funds_annual_report",
]);
export type NonprofitComplianceTaskKind = z.infer<typeof nonprofitComplianceTaskKindSchema>;

/**
 * Bounded catalog cap: at most 50 compliance tasks per Organization, counting
 * both active and archived rows. The scheduler enumerates at most this many
 * rows, so delivery work stays bounded.
 */
export const MAX_COMPLIANCE_TASKS = 50;

export const complianceTaskSourceSchema = z.enum(["builtin", "custom"]);
export type ComplianceTaskSource = z.infer<typeof complianceTaskSourceSchema>;

export const dateOnlyStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date.");
export type DateOnlyString = z.infer<typeof dateOnlyStringSchema>;

const complianceTitleSchema = z.string().trim().min(1).max(200);
const complianceDescriptionSchema = z.string().trim().max(2000);
const complianceReferenceUrlSchema = z.string().trim().max(2048);
const complianceMembershipIdSchema = z.string().trim().min(1).max(128);

function isSafeComplianceReferenceUrl(value: string): boolean {
  if (value.length === 0) return true;
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(value);
}

const nonprofitComplianceTaskBaseSchema = z.object({
  applicable: z.boolean(),
  archived: z.boolean().optional().default(false),
  description: complianceDescriptionSchema.optional().default(""),
  id: z.uuid(),
  kind: nonprofitComplianceTaskKindSchema.nullable(),
  lastCompletedDate: dateOnlyStringSchema.nullable(),
  lastCompletedByUserId: z.string().min(1).nullable().optional(),
  lastCompletedByName: z.string().min(1).nullable().optional(),
  nextDueDate: dateOnlyStringSchema.nullable(),
  nextReminderAt: z.iso.datetime().nullable(),
  recurrenceMonths: z.number().int().min(1).max(120),
  referenceUrl: complianceReferenceUrlSchema.nullable().optional().default(null),
  reminderIntervalDays: z.number().int().min(1).max(30),
  responsibleMembershipId: complianceMembershipIdSchema.nullable().optional().default(null),
  responsibleUserId: z.string().min(1).max(128).nullable().optional().default(null),
  responsibleName: z.string().min(1).max(200).nullable().optional().default(null),
  responsibleEmail: z.string().trim().max(320).nullable().optional().default(null),
  responsibleNeedsReassignment: z.boolean().optional().default(false),
  source: complianceTaskSourceSchema.optional().default("builtin"),
  templateKey: z.string().trim().min(1).max(128).nullable().optional().default(null),
  title: complianceTitleSchema,
});

export const nonprofitComplianceTaskSchema = nonprofitComplianceTaskBaseSchema.superRefine(
  (value, ctx) => {
    if (value.source === "builtin") {
      if (value.kind === null) {
        ctx.addIssue({
          code: "custom",
          message: "Built-in tasks require a stable kind.",
          path: ["kind"],
        });
      }
      if (value.archived) {
        ctx.addIssue({
          code: "custom",
          message: "Built-in tasks cannot be archived; mark them not applicable instead.",
          path: ["archived"],
        });
      }
    }
    if (typeof value.referenceUrl === "string") {
      const url = value.referenceUrl;
      if (url.length > 0 && !isSafeComplianceReferenceUrl(url)) {
        ctx.addIssue({
          code: "custom",
          message: "Reference URL must use http or https.",
          path: ["referenceUrl"],
        });
      }
    }
    if (value.templateKey !== null) {
      if (value.source === "custom") {
        ctx.addIssue({
          code: "custom",
          message: "Custom tasks must not carry a built-in template key.",
          path: ["templateKey"],
        });
      }
    }
  },
);
export type NonprofitComplianceTask = z.infer<typeof nonprofitComplianceTaskSchema>;

/** Alias for the generic catalog naming used by issue #120. */
export const organizationComplianceTaskSchema = nonprofitComplianceTaskSchema;
export type OrganizationComplianceTask = NonprofitComplianceTask;

export const nonprofitComplianceSettingsSchema = z.object({
  enabled: z.boolean(),
  tasks: z.array(nonprofitComplianceTaskSchema).max(MAX_COMPLIANCE_TASKS),
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

const complianceTaskUpdateBaseSchema = z.object({
  applicable: z.boolean().optional(),
  description: complianceDescriptionSchema.optional(),
  nextDueDate: dateOnlyStringSchema.nullable().optional(),
  recurrenceMonths: z.number().int().min(1).max(120).optional(),
  referenceUrl: complianceReferenceUrlSchema.nullable().optional(),
  responsibleMembershipId: complianceMembershipIdSchema.nullable().optional(),
  taskId: z.uuid(),
  title: complianceTitleSchema.optional(),
});

export const nonprofitComplianceTaskUpdateRequestSchema = complianceTaskUpdateBaseSchema
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.applicable === undefined &&
      value.description === undefined &&
      value.nextDueDate === undefined &&
      value.recurrenceMonths === undefined &&
      value.referenceUrl === undefined &&
      value.responsibleMembershipId === undefined &&
      value.title === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "At least one task field must be provided.",
      });
    }
    if (
      typeof value.referenceUrl === "string" &&
      value.referenceUrl.length > 0 &&
      !isSafeComplianceReferenceUrl(value.referenceUrl)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Reference URL must use http or https.",
        path: ["referenceUrl"],
      });
    }
  });
export type NonprofitComplianceTaskUpdateRequest = z.infer<
  typeof nonprofitComplianceTaskUpdateRequestSchema
>;

const complianceTaskCreateBaseSchema = z.object({
  applicable: z.boolean().optional().default(true),
  description: complianceDescriptionSchema.optional().default(""),
  nextDueDate: dateOnlyStringSchema.nullable().optional().default(null),
  recurrenceMonths: z.number().int().min(1).max(120).optional().default(12),
  referenceUrl: complianceReferenceUrlSchema.nullable().optional().default(null),
  responsibleMembershipId: complianceMembershipIdSchema.nullable().optional().default(null),
  title: complianceTitleSchema,
});

export const complianceTaskCreateRequestSchema = complianceTaskCreateBaseSchema
  .strict()
  .superRefine((value, ctx) => {
    if (
      typeof value.referenceUrl === "string" &&
      value.referenceUrl.length > 0 &&
      !isSafeComplianceReferenceUrl(value.referenceUrl)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Reference URL must use http or https.",
        path: ["referenceUrl"],
      });
    }
  });
export type ComplianceTaskCreateRequest = z.infer<typeof complianceTaskCreateRequestSchema>;

export const complianceTaskArchiveRequestSchema = z
  .object({
    taskId: z.uuid(),
  })
  .strict();
export type ComplianceTaskArchiveRequest = z.infer<typeof complianceTaskArchiveRequestSchema>;

export const nonprofitComplianceCompleteRequestSchema = z
  .object({
    completedDate: dateOnlyStringSchema.optional(),
    taskId: z.uuid(),
  })
  .strict();
export type NonprofitComplianceCompleteRequest = z.infer<
  typeof nonprofitComplianceCompleteRequestSchema
>;

export const complianceAssigneeSchema = z.object({
  email: z.string().trim().min(1).max(320),
  membershipId: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  role: z.enum(["owner", "admin"]),
  userId: z.string().min(1).max(128),
});
export type ComplianceAssignee = z.infer<typeof complianceAssigneeSchema>;

export const complianceAssigneesResponseSchema = z.object({
  assignees: z.array(complianceAssigneeSchema).max(500),
  requestId: requestIdSchema,
});
export type ComplianceAssigneesResponse = z.infer<typeof complianceAssigneesResponseSchema>;
