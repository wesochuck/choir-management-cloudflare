import { z } from "zod";

import { requestIdSchema } from "./primitives";

export const profileReconciliationFieldChoicesSchema = z.object({
  notes: z.enum(["keep_target", "overwrite_with_source", "append_source"]).default("keep_target"),
  phone: z.enum(["keep_target", "overwrite_with_source"]).default("keep_target"),
});

export type ProfileReconciliationFieldChoices = z.infer<
  typeof profileReconciliationFieldChoicesSchema
>;

export const profileReconciliationEventConflictSchema = z.object({
  eventId: z.string(),
  eventTitle: z.string().optional(),
  reason: z.string(),
  sourceAttendance: z.string(),
  sourceRsvp: z.string(),
  targetAttendance: z.string(),
  targetRsvp: z.string(),
});

export const profileReconciliationPollConflictSchema = z.object({
  pollId: z.string(),
  pollTitle: z.string().optional(),
  reason: z.string(),
});

export const profileReconciliationDuesConflictSchema = z.object({
  reason: z.string(),
  seasonId: z.string(),
  sourceStatus: z.string(),
  targetStatus: z.string().optional(),
});

export const profileReconciliationContactConflictSchema = z.object({
  contactId: z.string(),
  reason: z.string(),
});

export const profileReconciliationDeliveryConflictSchema = z.object({
  channel: z.string(),
  messageId: z.string(),
  reason: z.string(),
});

export const profileReconciliationCountsSchema = z.object({
  duesMoved: z.number().int().nonnegative(),
  eventRostersCombined: z.number().int().nonnegative(),
  eventRostersMoved: z.number().int().nonnegative(),
  historyRowsRetained: z.number().int().nonnegative(),
  pollResponsesMoved: z.number().int().nonnegative(),
  seatingAssignmentsUpdated: z.number().int().nonnegative(),
  suppressionsMoved: z.number().int().nonnegative(),
});

export type ProfileReconciliationCounts = z.infer<typeof profileReconciliationCountsSchema>;

export const profileReconciliationConflictInventorySchema = z.object({
  blockers: z.array(z.string()),
  contactConflicts: z.array(profileReconciliationContactConflictSchema),
  deliveryConflicts: z.array(profileReconciliationDeliveryConflictSchema),
  duesConflicts: z.array(profileReconciliationDuesConflictSchema),
  eventRosterConflicts: z.array(profileReconciliationEventConflictSchema),
  noteConflict: z
    .object({
      sourceNotes: z.string(),
      targetNotes: z.string(),
    })
    .nullable()
    .optional(),
  pollConflicts: z.array(profileReconciliationPollConflictSchema),
  transferCounts: profileReconciliationCountsSchema.optional(),
  warnings: z.array(z.string()),
});

export type ProfileReconciliationConflictInventory = z.infer<
  typeof profileReconciliationConflictInventorySchema
>;

export const profileReconciliationProfileSummarySchema = z.object({
  createdAt: z.string(),
  displayName: z.string(),
  doNotEmail: z.boolean(),
  globalStatus: z.string(),
  hidden: z.boolean(),
  id: z.string(),
  isSectionLeader: z.boolean(),
  lastBounceAt: z.string().nullable().optional(),
  membershipEmail: z.string().nullable().optional(),
  notes: z.string(),
  phone: z.string(),
  photoFileId: z.string().nullable().optional(),
  providerEmailSuppressed: z.boolean().optional(),
  receiveVolunteerEmails: z.boolean().optional(),
  receiveWeeklyReminders: z.boolean().optional(),
  showInDirectory: z.boolean(),
  statusIsManual: z.boolean().optional(),
  updatedAt: z.string().optional(),
  voicePart: z.string(),
});

export type ProfileReconciliationProfileSummary = z.infer<
  typeof profileReconciliationProfileSummarySchema
>;

export const profileReconciliationPreviewRequestSchema = z.object({
  membershipId: z.string().min(1).max(128),
  targetProfileId: z.uuid(),
});

export type ProfileReconciliationPreviewRequest = z.infer<
  typeof profileReconciliationPreviewRequestSchema
>;

export const profileReconciliationPreviewStatusSchema = z.enum([
  "ready",
  "needs_conflict_resolution",
  "already_consolidated",
  "blocked",
]);

export type ProfileReconciliationPreviewStatus = z.infer<
  typeof profileReconciliationPreviewStatusSchema
>;

export const profileReconciliationPreviewResponseSchema = z.object({
  canReconcile: z.boolean(),
  conflictInventory: profileReconciliationConflictInventorySchema,
  memberEmail: z.string(),
  membershipId: z.string(),
  memberName: z.string(),
  memberRole: z.string(),
  previewRevision: z.string(),
  requestId: requestIdSchema,
  sourceProfile: profileReconciliationProfileSummarySchema,
  status: profileReconciliationPreviewStatusSchema,
  targetProfile: profileReconciliationProfileSummarySchema,
});

export type ProfileReconciliationPreviewResponse = z.infer<
  typeof profileReconciliationPreviewResponseSchema
>;

export const profileReconciliationExecuteRequestSchema = z.object({
  confirmedSamePerson: z.literal(true),
  expectedSourceProfileId: z.uuid(),
  fieldChoices: profileReconciliationFieldChoicesSchema.default({
    notes: "keep_target",
    phone: "keep_target",
  }),
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9_\-:]+$/),
  membershipId: z.string().min(1).max(128),
  previewRevision: z.string().min(1),
  targetProfileId: z.uuid(),
});

export type ProfileReconciliationExecuteRequest = z.infer<
  typeof profileReconciliationExecuteRequestSchema
>;

export const profileReconciliationStatusSchema = z.enum(["completed", "pending_repair", "failed"]);

export type ProfileReconciliationStatus = z.infer<typeof profileReconciliationStatusSchema>;

export const profileReconciliationResponseSchema = z.object({
  canonicalProfileId: z.uuid(),
  id: z.string(),
  membershipId: z.string(),
  message: z.string(),
  occurredAt: z.string(),
  requestId: requestIdSchema,
  sourceProfileId: z.uuid(),
  status: profileReconciliationStatusSchema,
  targetProfileId: z.uuid(),
});

export type ProfileReconciliationResponse = z.infer<typeof profileReconciliationResponseSchema>;

export const profileReconciliationCandidateSchema = z.object({
  displayName: z.string(),
  globalStatus: z.string(),
  id: z.uuid(),
  matchReasons: z.array(z.string()),
  phone: z.string(),
  voicePart: z.string(),
});

export type ProfileReconciliationCandidate = z.infer<typeof profileReconciliationCandidateSchema>;

export const profileReconciliationCandidatesResponseSchema = z.object({
  candidates: z.array(profileReconciliationCandidateSchema),
  requestId: requestIdSchema,
});

export type ProfileReconciliationCandidatesResponse = z.infer<
  typeof profileReconciliationCandidatesResponseSchema
>;
