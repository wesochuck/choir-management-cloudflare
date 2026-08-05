import { z } from "zod";
import { organizationIdSchema, requestIdSchema } from "./primitives";
import { publicDomainResponseSchema } from "./exports";
export const calendarFeedUrlsResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  httpsUrl: z.url(),
  requestId: requestIdSchema,
  webcalUrl: z.string().startsWith("webcal://"),
});

export type CalendarFeedUrlsResponse = z.infer<typeof calendarFeedUrlsResponseSchema>;

export const organizationProvisionRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
});

export type OrganizationProvisionRequest = z.infer<typeof organizationProvisionRequestSchema>;

export const organizationProvisionResponseSchema = z.object({
  canonicalHostname: z.string().min(1).max(253),
  canonicalStatus: z.enum(["active", "pending"]),
  lifecycleState: z.literal("provisioning"),
  organizationId: z.uuid(),
  requestId: requestIdSchema,
  workflowId: z.string().min(1).max(128),
});

export type OrganizationProvisionResponse = z.infer<typeof organizationProvisionResponseSchema>;

export const platformOrganizationSummarySchema = z.object({
  canonicalHostname: z.string().min(1).max(253),
  canonicalStatus: z.enum(["active", "disabled", "pending"]),
  lifecycleState: z.enum(["active", "provisioning", "suspended"]),
  name: z.string().min(1).max(120),
  operationalSchemaVersion: z.number().int().nonnegative(),
  organizationId: organizationIdSchema,
  provisionedAt: z.iso.datetime().nullable(),
  slug: z.string().min(2).max(63),
});

export const platformOrganizationsResponseSchema = z.object({
  nextCursor: z.string().min(1).max(128).nullable(),
  organizations: z.array(platformOrganizationSummarySchema).max(25),
  requestId: requestIdSchema,
});

export type PlatformOrganizationSummary = z.infer<typeof platformOrganizationSummarySchema>;
export type PlatformOrganizationsResponse = z.infer<typeof platformOrganizationsResponseSchema>;

export const platformOrganizationPublicDomainsResponseSchema = z.object({
  domains: z.array(publicDomainResponseSchema),
  requestId: requestIdSchema,
});

export type PlatformOrganizationPublicDomainsResponse = z.infer<
  typeof platformOrganizationPublicDomainsResponseSchema
>;

export const platformJobDeadLetterSummarySchema = z.object({
  firstSeenAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(256).nullable(),
  jobId: z.uuid().nullable(),
  jobKind: z
    .enum([
      "attendance_report",
      "audition_notification",
      "communication_delivery",
      "organization_export",
      "payment_notification",
      "stale_checkout_cleanup",
      "ticket_notification",
    ])
    .nullable(),
  lastSeenAt: z.iso.datetime(),
  messageId: z.string().min(1).max(256),
  messageValid: z.boolean(),
  observationCount: z.number().int().positive(),
  observedAttempt: z.number().int().nonnegative(),
  organizationId: organizationIdSchema.nullable(),
  queueName: z.string().min(1).max(128),
});

export const platformJobDeadLettersResponseSchema = z.object({
  deadLetters: z.array(platformJobDeadLetterSummarySchema).max(25),
  nextCursor: z.string().min(1).max(512).nullable(),
  requestId: requestIdSchema,
});

export type PlatformJobDeadLetterSummary = z.infer<typeof platformJobDeadLetterSummarySchema>;
export type PlatformJobDeadLettersResponse = z.infer<typeof platformJobDeadLettersResponseSchema>;

export const platformFleetSchemaPreparationSchema = z.object({
  completedAt: z.iso.datetime().nullable(),
  processedCount: z.number().int().nonnegative(),
  runId: z.uuid(),
  startedAt: z.iso.datetime(),
  status: z.enum(["running", "completed", "failed"]),
  targetVersion: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  workflowId: z.string().min(1).max(100).optional(),
});

export const platformFleetSchemaStatusResponseSchema = z.object({
  currentVersion: z.number().int().positive(),
  preparation: platformFleetSchemaPreparationSchema.nullable(),
  requestId: requestIdSchema,
});

export type PlatformFleetSchemaPreparation = z.infer<typeof platformFleetSchemaPreparationSchema>;
export type PlatformFleetSchemaStatusResponse = z.infer<
  typeof platformFleetSchemaStatusResponseSchema
>;

export const platformElevationRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export type PlatformElevationRequest = z.infer<typeof platformElevationRequestSchema>;

export const platformOrganizationContextResponseSchema = z.object({
  canEdit: z.boolean(),
  elevationExpiresAt: z.iso.datetime().nullable(),
  elevationId: z.uuid().nullable(),
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
  userId: z.string().min(1),
});

export type PlatformOrganizationContextResponse = z.infer<
  typeof platformOrganizationContextResponseSchema
>;

export const platformElevationRevocationResponseSchema = z.object({
  elevationId: z.uuid(),
  status: z.literal("revoked"),
});

export type PlatformElevationRevocationResponse = z.infer<
  typeof platformElevationRevocationResponseSchema
>;

export const platformMfaStatusResponseSchema = z.object({
  activePlatformAdministrator: z.boolean(),
  enrollmentComplete: z.boolean(),
  requestId: requestIdSchema,
  twoFactorEnabled: z.boolean(),
});

export const platformMfaEnrollmentResponseSchema = z.object({
  backupCodes: z.array(z.string().min(8)).min(1),
  totpURI: z.url(),
});

export const platformRecoveryCodesResponseSchema = z.object({
  backupCodes: z.array(z.string().min(8)).min(1),
  status: z.literal(true),
});

export const platformContextResponseSchema = z.object({
  mfaMethod: z.enum(["recovery_code", "totp"]),
  mfaVerifiedUntil: z.iso.datetime(),
  requestId: requestIdSchema,
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("product_base") }),
    z.object({ kind: z.literal("organization"), organizationId: organizationIdSchema }),
  ]),
  userId: z.string().min(1),
});

export type PlatformMfaStatusResponse = z.infer<typeof platformMfaStatusResponseSchema>;
export type PlatformMfaEnrollmentResponse = z.infer<typeof platformMfaEnrollmentResponseSchema>;
export type PlatformRecoveryCodesResponse = z.infer<typeof platformRecoveryCodesResponseSchema>;
export type PlatformContextResponse = z.infer<typeof platformContextResponseSchema>;
