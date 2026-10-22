import { z } from "zod";
import { emailAddressSchema, requestIdSchema } from "./primitives";
export const organizationProfileRequestSchema = z.object({
  doNotEmail: z.boolean().default(false),
  displayName: z.string().trim().min(1).max(200),
  globalStatus: z.enum(["Active", "Idle", "Inactive"]).default("Active"),
  hidden: z.boolean().default(false),
  isSectionLeader: z.boolean().default(false),
  notes: z.string().trim().max(100_000).default(""),
  phone: z.string().trim().max(50).default(""),
  receiveAdminNotifications: z.boolean().default(false),
  receiveAttendanceReports: z.boolean().default(true),
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
  showEmailInDirectory: z.boolean().default(true),
  showPhoneInDirectory: z.boolean().default(true),
  bounceReason: z.string().max(500).default(""),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  lastBounceAt: z.string().max(100).default(""),
  onBreakInactiveAt: z.iso.datetime().nullable().default(null),
  photoFileId: z.uuid().nullable().default(null),
  providerEmailSuppressed: z.boolean().default(false),
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
  invitationCandidates: z.number().int().min(0).max(500),
  requestId: requestIdSchema,
});

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
