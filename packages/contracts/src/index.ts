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

export const organizationMfaPolicyRequestSchema = z.object({
  mfaRequired: z.boolean(),
});

export const organizationMfaVerificationRequestSchema = z.discriminatedUnion("method", [
  z.object({ code: z.string().regex(/^\d{6}$/), method: z.literal("totp") }),
  z.object({ code: z.string().min(8).max(128), method: z.literal("recovery_code") }),
]);

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

export const problemDetailsSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: requestIdSchema,
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
