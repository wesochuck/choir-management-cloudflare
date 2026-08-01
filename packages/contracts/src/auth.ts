import { z } from "zod";
import { organizationIdSchema, requestIdSchema } from "./primitives";
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

export const organizationMembershipSummarySchema = z.object({
  email: z.email(),
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  profileId: z.uuid().nullable(),
  role: organizationInvitationRoleSchema,
});

export const organizationMembershipsResponseSchema = z.object({
  memberships: z.array(organizationMembershipSummarySchema).max(500),
  requestId: requestIdSchema,
  truncated: z.boolean(),
});

export type OrganizationMembershipSummary = z.infer<typeof organizationMembershipSummarySchema>;
export type OrganizationMembershipsResponse = z.infer<typeof organizationMembershipsResponseSchema>;
