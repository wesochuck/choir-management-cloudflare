import { z } from "zod";

import { requestIdSchema } from "./primitives";

/**
 * Phase 5 CSV contact-import transport contracts.
 *
 * Lifecycle: upload (staged) → mapping draft → preview → confirm (starts the
 * async job) → processing → completed/failed; cancelled only before terminal
 * processing begins. Only confirmation starts mutations; every earlier step
 * is side-effect free apart from the staged draft itself.
 */

/** Maximum columns accepted in one import mapping. */
export const CONTACT_IMPORT_MAPPING_MAX = 64;
/** Maximum contact lists one import may target. */
export const CONTACT_IMPORT_LISTS_MAX = 50;
/** Maximum staged rows accepted in one import (mirrors the domain limit). */
export const CONTACT_IMPORT_ROWS_MAX = 10_000;
/** Maximum sample rows returned by upload analysis. */
export const CONTACT_IMPORT_SAMPLE_MAX = 5;

export const contactImportTargetSchema = z.enum([
  "firstName",
  "lastName",
  "displayName",
  "email",
  "phone",
  "emailStatus",
  "smsStatus",
  "consentSource",
  "source",
  "ignore",
]);

export const contactImportStatusSchema = z.enum([
  "staged",
  "confirmed",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

const contactImportSampleCellSchema = z.string().max(2_000);
const contactImportSampleRowSchema = z.array(contactImportSampleCellSchema).max(64);
const contactImportHeadersSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(64);

const contactImportListIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(CONTACT_IMPORT_LISTS_MAX)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Target lists must be unique." });
    }
  });

const contactImportMappingSchema = z
  .array(contactImportTargetSchema)
  .min(1)
  .max(CONTACT_IMPORT_MAPPING_MAX);

export const contactImportUploadResponseSchema = z.object({
  headers: contactImportHeadersSchema,
  importId: z.uuid(),
  invalidRowCount: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
  probableDuplicateCount: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
  requestId: requestIdSchema,
  rowCount: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
  sampleRows: z.array(contactImportSampleRowSchema).max(CONTACT_IMPORT_SAMPLE_MAX),
  status: z.literal("staged"),
});

export const contactImportMappingRequestSchema = z.object({
  listIds: contactImportListIdsSchema,
  mapping: contactImportMappingSchema,
});

export const contactImportMappingResponseSchema = z.object({
  importId: z.uuid(),
  listIds: z.array(z.uuid()).max(CONTACT_IMPORT_LISTS_MAX),
  mapping: z.array(contactImportTargetSchema).max(CONTACT_IMPORT_MAPPING_MAX),
  requestId: requestIdSchema,
  status: z.literal("staged"),
});

const contactImportCountsSchema = z.object({
  contactsCreated: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
  contactsUpdated: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
  existingMatches: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
  inFileDuplicates: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
  invalidRows: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
  membershipsAdded: z
    .number()
    .int()
    .nonnegative()
    .max(CONTACT_IMPORT_ROWS_MAX * 50),
  newContacts: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
  rowsRead: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
  suppressedPreserved: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
});

export const contactImportPreviewResponseSchema = contactImportCountsSchema.extend({
  importId: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("staged"),
});

export const contactImportConfirmResponseSchema = z.object({
  idempotencyKey: z.string().min(1).max(256),
  importId: z.uuid(),
  requestId: requestIdSchema,
  status: z.enum(["confirmed", "processing", "completed"]),
});

export const contactImportJobStatusResponseSchema = contactImportCountsSchema.extend({
  errorCode: z.string().max(128).nullable(),
  hasErrorCsv: z.boolean(),
  importId: z.uuid(),
  processedRows: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
  requestId: requestIdSchema,
  status: contactImportStatusSchema,
});

export const contactImportErrorCsvResponseSchema = z.object({
  csv: z.string().max(20_000_000),
  downloadName: z.string().trim().min(1).max(255).default("contact-import-errors.csv"),
  importId: z.uuid(),
  requestId: requestIdSchema,
  rowCount: z.number().int().nonnegative().max(CONTACT_IMPORT_ROWS_MAX),
});

export type ContactImportTarget = z.infer<typeof contactImportTargetSchema>;
export type ContactImportStatus = z.infer<typeof contactImportStatusSchema>;
export type ContactImportUploadResponse = z.infer<typeof contactImportUploadResponseSchema>;
export type ContactImportMappingRequest = z.infer<typeof contactImportMappingRequestSchema>;
export type ContactImportMappingResponse = z.infer<typeof contactImportMappingResponseSchema>;
export type ContactImportPreviewResponse = z.infer<typeof contactImportPreviewResponseSchema>;
export type ContactImportConfirmResponse = z.infer<typeof contactImportConfirmResponseSchema>;
export type ContactImportJobStatusResponse = z.infer<typeof contactImportJobStatusResponseSchema>;
export type ContactImportErrorCsvResponse = z.infer<typeof contactImportErrorCsvResponseSchema>;
