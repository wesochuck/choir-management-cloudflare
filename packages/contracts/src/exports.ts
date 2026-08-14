import { z } from "zod";
import { organizationIdSchema, requestIdSchema } from "./primitives";
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

export const publicDomainValidationRecordSchema = z.object({
  name: z.string().min(1).max(2048),
  type: z.enum(["http", "txt"]),
  value: z.string().min(1).max(2048),
});

export const publicDomainProviderStatusSchema = z.enum([
  "active",
  "error",
  "not_configured",
  "pending",
  "disabled",
]);

export const publicDomainResponseSchema = z.object({
  domainId: z.uuid(),
  hostname: publicWebsiteHostnameSchema,
  organizationId: organizationIdSchema,
  providerError: z.string().max(500).nullable(),
  providerHostnameId: z.string().max(128).nullable(),
  providerSslStatus: z.string().max(64).nullable(),
  providerStatus: publicDomainProviderStatusSchema,
  routingVersion: z.number().int().positive(),
  status: z.enum(["active", "disabled", "pending"]),
  validationRecords: z.array(publicDomainValidationRecordSchema).max(10),
});

export type PublicDomainValidationRecord = z.infer<typeof publicDomainValidationRecordSchema>;
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
    .max(20 * 1024 * 1024),
  uploadedAt: z.iso.datetime(),
});

export type PrivateFileResponse = z.infer<typeof privateFileResponseSchema>;

export const organizationExportRequestSchema = z.object({
  format: z.literal("json").default("json"),
});

export const organizationExportStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const organizationExportStartResponseSchema = z.object({
  exportId: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("queued"),
});

export const organizationExportStatusResponseSchema = z.object({
  byteCount: z.number().int().nonnegative().nullable(),
  checksumSha256: z.string().max(128).nullable(),
  downloadUrl: z.string().nullable(),
  errorCode: z.string().max(128).nullable(),
  exportId: z.uuid(),
  requestId: requestIdSchema,
  status: organizationExportStatusSchema,
});

export const organizationExportManifestSchema = z.object({
  byteCount: z.number().int().nonnegative(),
  checksumSha256: z.string().min(1).max(128),
  exportedAt: z.iso.datetime(),
  exportVersion: z.literal(1),
  fileCount: z.number().int().nonnegative(),
  organizationId: organizationIdSchema,
  recordCounts: z.record(z.string().min(1).max(128), z.number().int().nonnegative()),
});

export const organizationExportResponseSchema = z.object({
  downloadName: z.string().min(1).max(255),
  manifest: organizationExportManifestSchema,
  requestId: requestIdSchema,
});

export type OrganizationExportRequest = z.infer<typeof organizationExportRequestSchema>;
export type OrganizationExportStatus = z.infer<typeof organizationExportStatusSchema>;
export type OrganizationExportStartResponse = z.infer<typeof organizationExportStartResponseSchema>;
export type OrganizationExportStatusResponse = z.infer<
  typeof organizationExportStatusResponseSchema
>;
export type OrganizationExportManifest = z.infer<typeof organizationExportManifestSchema>;
export type OrganizationExportResponse = z.infer<typeof organizationExportResponseSchema>;
