import { z } from "zod";

import { organizationIdSchema, requestIdSchema } from "./primitives";

export const rosterInviteExpirationDaysSchema = z.union([
  z.literal(1),
  z.literal(7),
  z.literal(30),
]);

export const createRosterInviteLinkRequestSchema = z.object({
  expiresInDays: rosterInviteExpirationDaysSchema.default(7),
  label: z.string().trim().min(1).max(100),
  maxUses: z.number().int().positive().nullable().optional(),
});

export const rosterInviteLinkStatusSchema = z.enum(["active", "expired", "revoked", "exhausted"]);

export const rosterInviteLinkSummarySchema = z.object({
  activeReservations: z.number().int().nonnegative(),
  committedUses: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  createdByUserId: z.string().min(1).max(128),
  expiresAt: z.iso.datetime(),
  id: z.string().min(1).max(128),
  label: z.string().min(1).max(100),
  maxUses: z.number().int().positive().nullable(),
  organizationId: organizationIdSchema,
  revokedAt: z.iso.datetime().nullable(),
  status: rosterInviteLinkStatusSchema,
});

export const createRosterInviteLinkResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  id: z.string().min(1).max(128),
  requestId: requestIdSchema,
  shareUrl: z.string().min(1),
});

export const rosterInviteLinksResponseSchema = z.object({
  links: z.array(rosterInviteLinkSummarySchema).max(100),
  requestId: requestIdSchema,
});

export const rosterInviteLinkShareResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  id: z.string().min(1).max(128),
  requestId: requestIdSchema,
  shareUrl: z.string().min(1),
});

export const revokeRosterInviteLinkResponseSchema = z.object({
  id: z.string().min(1).max(128),
  requestId: requestIdSchema,
  revokedAt: z.iso.datetime(),
});

export const rosterInviteTokenSchema = z
  .string()
  .min(16)
  .max(4096)
  .regex(/^[A-Za-z0-9._-]+$/);

export const rosterInvitePreviewRequestSchema = z.object({
  token: rosterInviteTokenSchema,
});

export const rosterInvitePreviewResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  logoFileId: z.uuid().nullable(),
  organizationName: z.string().min(1).max(120),
  organizationSlug: z.string().min(1).max(63),
  requestId: requestIdSchema,
});

export const rosterInviteStartRequestSchema = z.object({
  email: z.email().max(320),
  token: rosterInviteTokenSchema,
});

export const rosterInviteStartResponseSchema = z.object({
  requestId: requestIdSchema,
  status: z.literal("code_sent"),
});

export const rosterInviteOptionsRequestSchema = z.object({
  token: rosterInviteTokenSchema,
});

export const rosterInviteConfiguredSectionSchema = z.object({
  code: z.string().min(1).max(32),
  color: z.string().min(1).max(32),
  name: z.string().min(1).max(100),
  trackOnly: z.boolean(),
});

export const rosterInviteConfiguredPartSchema = z.object({
  fullName: z.string().min(1).max(100),
  label: z.string().min(1).max(50),
  sectionCode: z.string().min(1).max(32),
});

export const rosterInviteOptionsResponseSchema = z.object({
  alreadyEnrolled: z.boolean(),
  existingProfile: z
    .object({
      displayName: z.string().min(1).max(200),
      voicePart: z.string().min(1).max(50),
    })
    .nullable(),
  organizationName: z.string().min(1).max(120),
  performerLabel: z.string().min(1).max(50),
  requestId: requestIdSchema,
  sections: z.array(rosterInviteConfiguredSectionSchema),
  voiceParts: z.array(rosterInviteConfiguredPartSchema),
});

export const rosterInviteRedeemRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  idempotencyKey: z.string().trim().min(1).max(128),
  phone: z.string().trim().max(50).optional().default(""),
  showInDirectory: z.boolean(),
  token: rosterInviteTokenSchema,
  voicePart: z.string().trim().min(1).max(100),
});

export const rosterInviteRedeemStatusSchema = z.enum(["completed", "already_enrolled", "pending"]);

export const rosterInviteRedeemResponseSchema = z.object({
  enrollmentId: z.string().min(1).max(128),
  membershipId: z.string().min(1).max(128),
  profileId: z.uuid(),
  requestId: requestIdSchema,
  status: rosterInviteRedeemStatusSchema,
});

export const rosterInviteEnrollmentLifecycleStatusSchema = z.enum([
  "reserved",
  "prepared",
  "admitted",
  "completed",
  "canceled",
  "needs_repair",
]);

export const rosterInviteEnrollmentStatusResponseSchema = z.object({
  enrollmentId: z.string().min(1).max(128),
  membershipId: z.string().min(1).max(128).nullable(),
  profileId: z.uuid().nullable(),
  requestId: requestIdSchema,
  status: rosterInviteEnrollmentLifecycleStatusSchema,
});

export type RosterInviteExpirationDays = z.infer<typeof rosterInviteExpirationDaysSchema>;
export type CreateRosterInviteLinkRequest = z.infer<typeof createRosterInviteLinkRequestSchema>;
export type RosterInviteLinkStatus = z.infer<typeof rosterInviteLinkStatusSchema>;
export type RosterInviteLinkSummary = z.infer<typeof rosterInviteLinkSummarySchema>;
export type CreateRosterInviteLinkResponse = z.infer<typeof createRosterInviteLinkResponseSchema>;
export type RosterInviteLinksResponse = z.infer<typeof rosterInviteLinksResponseSchema>;
export type RosterInviteLinkShareResponse = z.infer<typeof rosterInviteLinkShareResponseSchema>;
export type RevokeRosterInviteLinkResponse = z.infer<typeof revokeRosterInviteLinkResponseSchema>;
export type RosterInvitePreviewRequest = z.infer<typeof rosterInvitePreviewRequestSchema>;
export type RosterInvitePreviewResponse = z.infer<typeof rosterInvitePreviewResponseSchema>;
export type RosterInviteStartRequest = z.infer<typeof rosterInviteStartRequestSchema>;
export type RosterInviteStartResponse = z.infer<typeof rosterInviteStartResponseSchema>;
export type RosterInviteOptionsRequest = z.infer<typeof rosterInviteOptionsRequestSchema>;
export type RosterInviteConfiguredSection = z.infer<typeof rosterInviteConfiguredSectionSchema>;
export type RosterInviteConfiguredPart = z.infer<typeof rosterInviteConfiguredPartSchema>;
export type RosterInviteOptionsResponse = z.infer<typeof rosterInviteOptionsResponseSchema>;
export type RosterInviteRedeemRequest = z.infer<typeof rosterInviteRedeemRequestSchema>;
export type RosterInviteRedeemStatus = z.infer<typeof rosterInviteRedeemStatusSchema>;
export type RosterInviteRedeemResponse = z.infer<typeof rosterInviteRedeemResponseSchema>;
export type RosterInviteEnrollmentLifecycleStatus = z.infer<
  typeof rosterInviteEnrollmentLifecycleStatusSchema
>;
export type RosterInviteEnrollmentStatusResponse = z.infer<
  typeof rosterInviteEnrollmentStatusResponseSchema
>;
