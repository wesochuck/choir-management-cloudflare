import { z } from "zod";

export const organizationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

export type OrganizationId = z.infer<typeof organizationIdSchema>;

export const requestIdSchema = z.uuid();

export const healthResponseSchema = z.object({
  environment: z.enum(["local", "preview", "staging", "production"]),
  requestId: requestIdSchema,
  service: z.literal("choir-management-cloudflare"),
  status: z.literal("ok"),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const organizationContextResponseSchema = z.object({
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
  role: z.enum(["owner", "administrator", "member"]),
  userId: z.string().min(1),
});

export type OrganizationContextResponse = z.infer<typeof organizationContextResponseSchema>;

export const organizationProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
});

export const organizationProfileSchema = z.object({
  createdAt: z.iso.datetime(),
  displayName: z.string().min(1).max(200),
  id: z.uuid(),
  updatedAt: z.iso.datetime(),
});

export const organizationProfileResponseSchema = organizationProfileSchema.extend({
  requestId: requestIdSchema,
});

export const organizationProfilesResponseSchema = z.object({
  profiles: z.array(organizationProfileSchema).max(500),
  requestId: requestIdSchema,
});

export type OrganizationProfileRequest = z.infer<typeof organizationProfileRequestSchema>;
export type OrganizationProfile = z.infer<typeof organizationProfileSchema>;
export type OrganizationProfileResponse = z.infer<typeof organizationProfileResponseSchema>;
export type OrganizationProfilesResponse = z.infer<typeof organizationProfilesResponseSchema>;

export const organizationVenueRequestSchema = z.object({
  address: z.string().trim().max(2_000).default(""),
  name: z.string().trim().min(1).max(500),
});

export const organizationVenueSchema = organizationVenueRequestSchema.extend({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  updatedAt: z.iso.datetime(),
});

export const organizationVenuesResponseSchema = z.object({
  requestId: requestIdSchema,
  venues: z.array(organizationVenueSchema).max(500),
});

export const organizationSetListItemSchema = z.object({
  composer: z.string().trim().max(300).optional(),
  isFeaturedNumber: z.boolean().optional(),
  performerCredits: z
    .array(z.object({ displayName: z.string().trim().max(200) }))
    .max(100)
    .optional(),
  title: z.string().trim().min(1).max(300),
  type: z.string().trim().max(100).optional(),
});

export const organizationEventRequestSchema = z.object({
  callTime: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]).default(""),
  details: z.string().max(100_000).default(""),
  durationMinutes: z.number().int().positive().max(1_440).nullable().default(null),
  location: z.string().trim().max(2_000).default(""),
  parentPerformanceId: z.uuid().nullable().default(null),
  setList: z.array(organizationSetListItemSchema).max(200).default([]),
  setListApproved: z.boolean().default(false),
  startsAt: z.iso.datetime(),
  title: z.string().trim().min(1).max(500),
  type: z.enum(["Performance", "Rehearsal"]),
  venueId: z.uuid().nullable().default(null),
});

export const organizationEventSchema = organizationEventRequestSchema.extend({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  updatedAt: z.iso.datetime(),
});

export const organizationEventsResponseSchema = z.object({
  events: z.array(organizationEventSchema).max(500),
  requestId: requestIdSchema,
});

export const organizationEventArchiveResponseSchema = z.object({
  eventId: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("archived"),
});

export const organizationRsvpRequestSchema = z.object({
  profileId: z.uuid(),
  rsvp: z.enum(["Yes", "No", "Pending"]),
});

export const organizationRsvpSchema = organizationRsvpRequestSchema.extend({
  eventId: z.uuid(),
  updatedAt: z.iso.datetime(),
});

export const singerRsvpRequestSchema = z.object({
  rsvp: z.enum(["Yes", "No", "Pending"]),
});

export const singerEventSchema = z.object({
  callTime: z.string().max(5),
  details: z.string().max(100_000),
  directRsvp: z.enum(["Yes", "No", "Pending"]),
  durationMinutes: z.number().int().positive().nullable(),
  id: z.uuid(),
  inheritedFromParent: z.boolean(),
  location: z.string().max(2_000),
  resolvedRsvp: z.enum(["Yes", "No", "Pending"]),
  startsAt: z.iso.datetime(),
  title: z.string().min(1).max(500),
  type: z.enum(["Performance", "Rehearsal"]),
  venueAddress: z.string().max(2_000),
  venueName: z.string().max(500),
});

export const singerEventsResponseSchema = z.object({
  events: z.array(singerEventSchema).max(500),
  profileId: z.uuid(),
  requestId: requestIdSchema,
  timezone: z.string().min(1).max(100),
});

export const organizationCalendarSettingsRequestSchema = z.object({
  timezone: z.string().trim().min(1).max(100),
});

export const organizationCalendarSettingsResponseSchema =
  organizationCalendarSettingsRequestSchema.extend({ requestId: requestIdSchema });

export type OrganizationVenueRequest = z.infer<typeof organizationVenueRequestSchema>;
export type OrganizationVenue = z.infer<typeof organizationVenueSchema>;
export type OrganizationEventRequest = z.infer<typeof organizationEventRequestSchema>;
export type OrganizationEvent = z.infer<typeof organizationEventSchema>;
export type OrganizationEventArchiveResponse = z.infer<
  typeof organizationEventArchiveResponseSchema
>;
export type OrganizationRsvpRequest = z.infer<typeof organizationRsvpRequestSchema>;
export type OrganizationRsvp = z.infer<typeof organizationRsvpSchema>;
export type SingerEvent = z.infer<typeof singerEventSchema>;
export type SingerEventsResponse = z.infer<typeof singerEventsResponseSchema>;
export type OrganizationCalendarSettings = z.infer<
  typeof organizationCalendarSettingsRequestSchema
>;

export const accountOrganizationSchema = z.object({
  canonicalHostname: z.string().min(1).max(253),
  canonicalStatus: z.enum(["active", "disabled", "pending"]),
  lifecycleState: z.enum(["active", "provisioning", "suspended"]),
  name: z.string().min(1).max(120),
  organizationId: organizationIdSchema,
  profileId: z.uuid().nullable(),
  role: z.enum(["owner", "administrator", "member"]),
  slug: z.string().min(1).max(63),
});

export const accountOrganizationsResponseSchema = z.object({
  organizations: z.array(accountOrganizationSchema),
});

export type AccountOrganization = z.infer<typeof accountOrganizationSchema>;
export type AccountOrganizationsResponse = z.infer<typeof accountOrganizationsResponseSchema>;

const userManagedPasswordSchema = z.string().min(12).max(128);

export const accountPasswordRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("set"), newPassword: userManagedPasswordSchema }),
  z.object({
    currentPassword: z.string().min(1).max(128),
    mode: z.literal("change"),
    newPassword: userManagedPasswordSchema,
  }),
]);

export const accountSecurityResponseSchema = z.object({
  passwordSet: z.boolean(),
  requestId: requestIdSchema,
});

export type AccountPasswordRequest = z.infer<typeof accountPasswordRequestSchema>;
export type AccountSecurityResponse = z.infer<typeof accountSecurityResponseSchema>;

const authDateSchema = z.union([z.string().min(1), z.number()]);

export const authUserSchema = z.object({
  createdAt: authDateSchema,
  email: z.email(),
  emailVerified: z.boolean(),
  id: z.string().min(1),
  image: z.string().nullable().optional(),
  name: z.string(),
  twoFactorEnabled: z.boolean().optional(),
  updatedAt: authDateSchema,
});

export const authSessionSchema = z.object({
  activeOrganizationId: z.string().nullable().optional(),
  createdAt: authDateSchema,
  expiresAt: authDateSchema,
  id: z.string().min(1),
  ipAddress: z.string().nullable().optional(),
  token: z.string().min(1),
  updatedAt: authDateSchema,
  userAgent: z.string().nullable().optional(),
  userId: z.string().min(1),
});

export const currentAuthSessionSchema = z
  .object({ session: authSessionSchema, user: authUserSchema })
  .nullable();

export const authSessionListSchema = z.array(authSessionSchema);

export type AuthSession = z.infer<typeof authSessionSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type CurrentAuthSession = z.infer<typeof currentAuthSessionSchema>;

export const organizationMfaPolicyRequestSchema = z.object({
  mfaRequired: z.boolean(),
});

export const organizationMfaVerificationRequestSchema = z.discriminatedUnion("method", [
  z.object({ code: z.string().regex(/^\d{6}$/), method: z.literal("totp") }),
  z.object({ code: z.string().min(8).max(128), method: z.literal("recovery_code") }),
]);

export const organizationAuthStatusResponseSchema = z.object({
  mfaRequired: z.boolean(),
  mfaVerifiedUntil: z.iso.datetime().nullable(),
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
  role: z.enum(["owner", "administrator", "member"]),
  twoFactorEnabled: z.boolean(),
  twoFactorVerified: z.boolean(),
});

export const organizationMfaPolicyResponseSchema = z.object({
  mfaRequired: z.boolean(),
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
});

export const organizationMfaVerificationResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
  status: z.literal("verified"),
});

export type OrganizationAuthStatusResponse = z.infer<typeof organizationAuthStatusResponseSchema>;
export type OrganizationMfaPolicyResponse = z.infer<typeof organizationMfaPolicyResponseSchema>;
export type OrganizationMfaVerificationResponse = z.infer<
  typeof organizationMfaVerificationResponseSchema
>;

export const organizationInvitationRoleSchema = z.enum(["owner", "administrator", "member"]);

export const organizationInvitationRequestSchema = z.object({
  email: z.email().max(320),
  role: organizationInvitationRoleSchema,
});

export const organizationInvitationResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  id: z.string().min(1).max(128),
  requestId: requestIdSchema,
  status: z.literal("pending"),
});

export const organizationInvitationDetailsSchema = z.object({
  email: z.email(),
  expiresAt: z.iso.datetime(),
  id: z.string().min(1).max(128),
  inviterEmail: z.email(),
  organizationId: organizationIdSchema,
  organizationName: z.string().min(1).max(120),
  organizationSlug: z.string().min(1).max(63),
  role: organizationInvitationRoleSchema,
  status: z.literal("pending"),
});

export const organizationInvitationSummarySchema = z.object({
  createdAt: z.iso.datetime(),
  email: z.email(),
  expiresAt: z.iso.datetime(),
  id: z.string().min(1).max(128),
  role: organizationInvitationRoleSchema,
  status: z.literal("pending"),
});

export const organizationInvitationsResponseSchema = z.object({
  invitations: z.array(organizationInvitationSummarySchema).max(50),
  requestId: requestIdSchema,
  truncated: z.boolean(),
});

export const organizationInvitationActionResponseSchema = z.object({
  id: z.string().min(1).max(128),
  requestId: requestIdSchema,
  status: z.enum(["accepted", "canceled", "rejected"]),
});

export type OrganizationInvitationRequest = z.infer<typeof organizationInvitationRequestSchema>;
export type OrganizationInvitationResponse = z.infer<typeof organizationInvitationResponseSchema>;
export type OrganizationInvitationDetails = z.infer<typeof organizationInvitationDetailsSchema>;
export type OrganizationInvitationSummary = z.infer<typeof organizationInvitationSummarySchema>;
export type OrganizationInvitationsResponse = z.infer<typeof organizationInvitationsResponseSchema>;
export type OrganizationInvitationActionResponse = z.infer<
  typeof organizationInvitationActionResponseSchema
>;

export const organizationProfileLinkRequestSchema = z.object({
  profileId: z.uuid(),
});

export const organizationProfileLinkResponseSchema = z.object({
  membershipId: z.string().min(1).max(128),
  organizationId: organizationIdSchema,
  profileId: z.uuid(),
  requestId: requestIdSchema,
});

export const publicWebsiteHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((hostname) => hostname.replace(/\.$/, ""))
  .refine(
    (hostname) =>
      hostname.length <= 253 &&
      hostname.includes(".") &&
      !/^\d+(?:\.\d+){3}$/.test(hostname) &&
      !/^\d+$/.test(hostname.split(".").at(-1) ?? "") &&
      hostname
        .split(".")
        .every(
          (label) =>
            label.length >= 1 &&
            label.length <= 63 &&
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
        ),
    "A valid DNS hostname is required.",
  );

export const publicDomainRegistrationRequestSchema = z.object({
  hostname: publicWebsiteHostnameSchema,
});

export const publicDomainResponseSchema = z.object({
  domainId: z.uuid(),
  hostname: publicWebsiteHostnameSchema,
  organizationId: organizationIdSchema,
  routingVersion: z.number().int().positive(),
  status: z.enum(["active", "disabled", "pending"]),
});

export type PublicDomainResponse = z.infer<typeof publicDomainResponseSchema>;

export const privateFileResponseSchema = z.object({
  contentType: z.string().min(1).max(128),
  fileName: z.string().min(1).max(255),
  id: z.uuid(),
  requestId: requestIdSchema,
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(10 * 1024 * 1024),
  uploadedAt: z.iso.datetime(),
});

export type PrivateFileResponse = z.infer<typeof privateFileResponseSchema>;

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

export const platformJobDeadLetterSummarySchema = z.object({
  firstSeenAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(256).nullable(),
  jobId: z.uuid().nullable(),
  jobKind: z
    .enum([
      "attendance_report",
      "communication_delivery",
      "organization_export",
      "projection_publish",
      "stale_checkout_cleanup",
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

export const problemDetailsSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: requestIdSchema,
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
