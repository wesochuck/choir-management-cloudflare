import { z } from "zod";
import { requestIdSchema } from "./primitives";

export const publicDocumentContentTypeSchema = z.enum([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export type PublicDocumentContentType = z.infer<typeof publicDocumentContentTypeSchema>;

export const publicWebsiteDocumentRequestSchema = z.object({
  fileId: z.uuid(),
  title: z.string().trim().min(1).max(300),
});

export const publicWebsiteDocumentSchema = z.object({
  contentType: publicDocumentContentTypeSchema,
  createdAt: z.iso.datetime(),
  downloadPath: z.string().min(1).max(255),
  fileId: z.uuid(),
  fileName: z.string().min(1).max(255),
  id: z.uuid(),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sortOrder: z.number().int().min(0).max(10_000),
  title: z.string().trim().min(1).max(300),
  updatedAt: z.iso.datetime(),
});

export const publicWebsiteDocumentsResponseSchema = z.object({
  documents: z.array(publicWebsiteDocumentSchema).max(50),
  requestId: requestIdSchema,
});

export const publicWebsiteDocumentResponseSchema = publicWebsiteDocumentSchema.extend({
  requestId: requestIdSchema,
});

export const publicWebsiteDocumentDeleteResponseSchema = z.object({
  documentId: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("deleted"),
});

export type PublicWebsiteDocumentRequest = z.infer<typeof publicWebsiteDocumentRequestSchema>;
export type PublicWebsiteDocument = z.infer<typeof publicWebsiteDocumentSchema>;
export type PublicWebsiteDocumentsResponse = z.infer<typeof publicWebsiteDocumentsResponseSchema>;
export type PublicWebsiteDocumentResponse = z.infer<typeof publicWebsiteDocumentResponseSchema>;
export type PublicWebsiteDocumentDeleteResponse = z.infer<
  typeof publicWebsiteDocumentDeleteResponseSchema
>;
