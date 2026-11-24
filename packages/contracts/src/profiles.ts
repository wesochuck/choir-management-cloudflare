import { z } from "zod";
import { emailAddressSchema, requestIdSchema } from "./primitives";
export const organizationProfileRequestSchema = z.object({
  email: z.union([z.literal(""), emailAddressSchema]).optional(),
  doNotEmail: z.boolean().default(false),
  displayName: z.string().trim().min(1).max(200),
  globalStatus: z.enum(["Active", "Idle", "Inactive"]).default("Active"),
  hidden: z.boolean().default(false),
  isSectionLeader: z.boolean().default(false),
  notes: z.string().trim().max(100_000).default(""),
  phone: z.string().trim().max(50).default(""),
  receiveAdminNotifications: z.boolean().default(false),
  receiveAttendanceReports: z.boolean().default(true),
  receiveAuditionNotifications: z.boolean().optional(),
  receiveFinancialAlerts: z.boolean().default(false),
  receiveOtherEventReminders: z.boolean().optional(),
  receivePerformanceReminders: z.boolean().optional(),
  receiveRehearsalReminders: z.boolean().optional(),
  receiveRsvpDeclineNotices: z.boolean().default(false),
  showInDirectory: z.boolean().default(true),
  statusIsManual: z.boolean().default(false),
  voicePart: z.string().trim().max(100).default(""),
});

export const organizationProfileSchema = organizationProfileRequestSchema.extend({
  email: z.union([z.literal(""), emailAddressSchema]).default(""),
  showEmailInDirectory: z.boolean().default(true),
  showPhoneInDirectory: z.boolean().default(true),
  bounceReason: z.string().max(500).default(""),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  lastBounceAt: z.string().max(100).default(""),
  onBreakInactiveAt: z.iso.datetime().nullable().default(null),
  photoFileId: z.uuid().nullable().default(null),
  providerEmailSuppressed: z.boolean().default(false),
  receiveAuditionNotifications: z.boolean().default(false),
  receiveOtherEventReminders: z.boolean().default(true),
  receivePerformanceReminders: z.boolean().default(true),
  receiveRehearsalReminders: z.boolean().default(true),
  statusChangedAt: z.iso.datetime().default("1970-01-01T00:00:00.000Z"),
  statusChangeReason: z.string().max(500).default("Initial status"),
  updatedAt: z.iso.datetime(),
});

export const organizationProfileResponseSchema = organizationProfileSchema.extend({
  requestId: requestIdSchema,
});

export const organizationProfilesResponseSchema = z.object({
  profiles: z.array(organizationProfileSchema).max(500),
  requestId: requestIdSchema,
});

export const organizationProfileImportResponseSchema = z.object({
  imported: z.number().int().min(0).max(500),
  invitationCandidates: z.number().int().min(0).max(500).default(0),
  emailsPersisted: z.number().int().min(0).max(500).default(0),
  phonesPersisted: z.number().int().min(0).max(500).default(0),
  conflicts: z
    .array(z.object({ row: z.number().int().min(2), message: z.string() }))
    .max(500)
    .default([]),
  requestId: requestIdSchema,
});

export const organizationProfileDeleteRequestSchema = z.object({
  contacts: z.enum(["keep", "delete_unused"]).default("keep"),
});
export type OrganizationProfileDeleteRequest = z.infer<
  typeof organizationProfileDeleteRequestSchema
>;

export const organizationProfileDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  profileId: z.uuid(),
  requestId: requestIdSchema,
});

export type OrganizationProfileRequest = z.infer<typeof organizationProfileRequestSchema>;
export type OrganizationProfile = z.infer<typeof organizationProfileSchema>;
export type OrganizationProfileResponse = z.infer<typeof organizationProfileResponseSchema>;
export type OrganizationProfilesResponse = z.infer<typeof organizationProfilesResponseSchema>;
export type OrganizationProfileDeleteResponse = z.infer<
  typeof organizationProfileDeleteResponseSchema
>;

export const memberProfileUpdateRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).default(""),
  receiveOtherEventReminders: z.boolean().optional(),
  receivePerformanceReminders: z.boolean().optional(),
  receiveRehearsalReminders: z.boolean().optional(),
  showEmailInDirectory: z.boolean().optional(),
  showPhoneInDirectory: z.boolean().optional(),
  showInDirectory: z.boolean().default(true),
});

export const memberProfileSchema = memberProfileUpdateRequestSchema.extend({
  showEmailInDirectory: z.boolean().default(true),
  showPhoneInDirectory: z.boolean().default(true),
  email: z.union([z.literal(""), emailAddressSchema]),
  globalStatus: z.enum(["Active", "Idle", "Inactive"]),
  id: z.uuid(),
  photoFileId: z.uuid().nullable().default(null),
  receiveOtherEventReminders: z.boolean().default(true),
  receivePerformanceReminders: z.boolean().default(true),
  receiveRehearsalReminders: z.boolean().default(true),
  voicePart: z.string().max(100),
});

export const memberProfileResponseSchema = memberProfileSchema.extend({
  requestId: requestIdSchema,
});

export const organizationDirectoryProfileSchema = z.object({
  displayName: z.string().min(1).max(200),
  email: z.union([z.literal(""), emailAddressSchema]),
  id: z.uuid(),
  photoFileId: z.uuid().nullable().default(null),
  phone: z.string().max(50),
  voicePart: z.string().max(100),
});

export const organizationDirectoryResponseSchema = z.object({
  profiles: z.array(organizationDirectoryProfileSchema).max(500),
  requestId: requestIdSchema,
});

export type MemberProfileUpdateRequest = z.infer<typeof memberProfileUpdateRequestSchema>;
export type MemberProfile = z.infer<typeof memberProfileSchema>;
export type OrganizationDirectoryProfile = z.infer<typeof organizationDirectoryProfileSchema>;

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

export const organizationVenueDeleteResponseSchema = z.object({
  requestId: requestIdSchema,
  status: z.literal("deleted"),
  venueId: z.uuid(),
});

export const organizationImpersonationStartRequestSchema = z.object({
  profileId: z.uuid(),
});

export const organizationImpersonatedProfileSchema = z.object({
  displayName: z.string().min(1).max(200),
  id: z.uuid(),
  voicePart: z.string().max(100).default(""),
});

export const organizationImpersonationStatusResponseSchema = z.object({
  active: z.boolean(),
  expiresAt: z.iso.datetime().optional(),
  impersonatedProfile: organizationImpersonatedProfileSchema.optional(),
  requestId: requestIdSchema,
});

export type OrganizationImpersonationStartRequest = z.infer<
  typeof organizationImpersonationStartRequestSchema
>;
export type OrganizationImpersonatedProfile = z.infer<typeof organizationImpersonatedProfileSchema>;
export type OrganizationImpersonationStatusResponse = z.infer<
  typeof organizationImpersonationStatusResponseSchema
>;

export const organizationProfilePendingInvitationSchema = z.object({
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  role: z.enum(["owner", "administrator", "member"]),
});

export const organizationProfilePortalActivitySchema = z.object({
  emailVerified: z.boolean().nullable().default(null),
  hasGoogleAccount: z.boolean().nullable().default(null),
  hasPassword: z.boolean().nullable().default(null),
  joinedAt: z.iso.datetime().nullable().default(null),
  joinedViaInviteLink: z.boolean().default(false),
  lastActiveAt: z.iso.datetime().nullable().default(null),
  linked: z.boolean(),
  passkeyCount: z.number().int().min(0).max(100).nullable().default(null),
  pendingInvitation: organizationProfilePendingInvitationSchema.nullable().default(null),
  role: z.enum(["owner", "administrator", "member"]).nullable().default(null),
  twoFactorEnabled: z.boolean().nullable().default(null),
});

export const organizationProfileLastAttendedEventSchema = z.object({
  eventId: z.uuid(),
  eventTitle: z.string().min(1).max(500),
  eventType: z.enum(["Performance", "Rehearsal", "Other"]),
  startsAt: z.iso.datetime(),
});

export const organizationProfileRecentRehearsalsSchema = z.object({
  absentCount: z.number().int().min(0),
  pendingCount: z.number().int().min(0),
  presentCount: z.number().int().min(0),
  totalCount: z.number().int().min(0),
});

export const organizationProfileAttendanceSummarySchema = z.object({
  lastAttendedEvent: organizationProfileLastAttendedEventSchema.nullable().default(null),
  recentRehearsals: organizationProfileRecentRehearsalsSchema,
});

export const organizationProfileEmailHealthSchema = z.object({
  bounceReason: z.string().max(500).default(""),
  doNotEmail: z.boolean().default(false),
  lastBounceAt: z.iso.datetime().nullable().default(null),
  lastDeliveredAt: z.iso.datetime().nullable().default(null),
  providerEmailSuppressed: z.boolean().default(false),
});

export const organizationProfileActivityKindSchema = z.enum([
  "attendance",
  "dues_payment",
  "poll_response",
  "portal_joined",
  "profile_created",
  "rsvp_change",
  "status_change",
]);

export const organizationProfileActivityActorSchema = z.enum(["member", "administrator", "system"]);

export const organizationProfileActivityEventSchema = z.object({
  actorType: organizationProfileActivityActorSchema.nullable().default(null),
  detail: z.string().max(1_000).default(""),
  id: z.string().min(1).max(200),
  kind: organizationProfileActivityKindSchema,
  occurredAt: z.iso.datetime(),
  title: z.string().min(1).max(500),
});

export const organizationProfileActivityResponseSchema = z.object({
  attendance: organizationProfileAttendanceSummarySchema,
  emailHealth: organizationProfileEmailHealthSchema,
  lastPollResponseAt: z.iso.datetime().nullable().default(null),
  lastRsvpResponseAt: z.iso.datetime().nullable().default(null),
  portal: organizationProfilePortalActivitySchema,
  profileCreatedAt: z.iso.datetime(),
  profileId: z.uuid(),
  profileUpdatedAt: z.iso.datetime(),
  requestId: requestIdSchema,
  timeline: z.array(organizationProfileActivityEventSchema).max(50),
});

export type OrganizationProfilePendingInvitation = z.infer<
  typeof organizationProfilePendingInvitationSchema
>;
export type OrganizationProfilePortalActivity = z.infer<
  typeof organizationProfilePortalActivitySchema
>;
export type OrganizationProfileLastAttendedEvent = z.infer<
  typeof organizationProfileLastAttendedEventSchema
>;
export type OrganizationProfileRecentRehearsals = z.infer<
  typeof organizationProfileRecentRehearsalsSchema
>;
export type OrganizationProfileAttendanceSummary = z.infer<
  typeof organizationProfileAttendanceSummarySchema
>;
export type OrganizationProfileEmailHealth = z.infer<typeof organizationProfileEmailHealthSchema>;
export type OrganizationProfileActivityKind = z.infer<typeof organizationProfileActivityKindSchema>;
export type OrganizationProfileActivityActor = z.infer<
  typeof organizationProfileActivityActorSchema
>;
export type OrganizationProfileActivityEvent = z.infer<
  typeof organizationProfileActivityEventSchema
>;
export type OrganizationProfileActivityResponse = z.infer<
  typeof organizationProfileActivityResponseSchema
>;
