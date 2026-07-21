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
