import { z } from "zod";
import { requestIdSchema } from "./primitives";
import type {
  organizationRosterConfigurationRequestSchema,
  organizationRosterAutomationPreviewRequestSchema,
  organizationRosterAutomationPreviewResponseSchema,
  organizationEventRsvpExportDataSchema,
} from "./events";
import type {
  seatingFormationSchema,
  seatingConfigurationRequestSchema,
  organizationSeatingChartRequestSchema,
  organizationSeatingChartSchema,
  organizationSeatingChartOrderRequestSchema,
  singerSeatingProfileSchema,
  singerSeatingResponseSchema,
} from "./seating";
const organizationMusicLibrarySettingsFieldsSchema = z.object({
  practicePlayerLinkLifetimeDays: z.number().int().min(1).max(3_650).default(180),
  publisherSearchTemplate: z.string().trim().max(2_000).default(""),
});

function validateMusicLibrarySettings(
  settings: z.infer<typeof organizationMusicLibrarySettingsFieldsSchema>,
  context: z.RefinementCtx,
): void {
  if (!settings.publisherSearchTemplate) return;
  if (!settings.publisherSearchTemplate.includes("{catalogId}")) {
    context.addIssue({
      code: "custom",
      message: "The publisher search URL must include the {catalogId} placeholder.",
      path: ["publisherSearchTemplate"],
    });
    return;
  }
  try {
    const resolved = new URL(
      settings.publisherSearchTemplate.replaceAll("{catalogId}", "catalog-id"),
    );
    if (resolved.protocol !== "https:") throw new Error("https_required");
  } catch {
    context.addIssue({
      code: "custom",
      message: "The publisher search URL must be a valid HTTPS URL.",
      path: ["publisherSearchTemplate"],
    });
  }
}

export const organizationMusicLibrarySettingsRequestSchema =
  organizationMusicLibrarySettingsFieldsSchema.superRefine(validateMusicLibrarySettings);

export const organizationMusicLibrarySettingsResponseSchema =
  organizationMusicLibrarySettingsFieldsSchema
    .extend({ requestId: requestIdSchema })
    .superRefine(validateMusicLibrarySettings);

export type OrganizationMusicLibrarySettings = z.infer<
  typeof organizationMusicLibrarySettingsRequestSchema
>;
export type OrganizationRosterConfiguration = z.infer<
  typeof organizationRosterConfigurationRequestSchema
>;
export type OrganizationRosterAutomationPreviewRequest = z.infer<
  typeof organizationRosterAutomationPreviewRequestSchema
>;
export type OrganizationRosterAutomationPreviewResponse = z.infer<
  typeof organizationRosterAutomationPreviewResponseSchema
>;
export type OrganizationEventRsvpExportData = z.infer<typeof organizationEventRsvpExportDataSchema>;
export type SeatingFormation = z.infer<typeof seatingFormationSchema>;
export type SeatingConfiguration = z.infer<typeof seatingConfigurationRequestSchema>;
export type OrganizationSeatingChartRequest = z.infer<typeof organizationSeatingChartRequestSchema>;
export type OrganizationSeatingChart = z.infer<typeof organizationSeatingChartSchema>;
export type OrganizationSeatingChartOrderRequest = z.infer<
  typeof organizationSeatingChartOrderRequestSchema
>;
export type SingerSeatingProfile = z.infer<typeof singerSeatingProfileSchema>;
export type SingerSeatingResponse = z.infer<typeof singerSeatingResponseSchema>;

const uniqueMusicLabelsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(100)
  .superRefine((labels, context) => {
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", message: "Music labels must be unique." });
    }
  });

export const musicTrackFileIdsSchema = z
  .record(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), z.uuid())
  .refine((mapping) => new Set(Object.values(mapping)).size === Object.keys(mapping).length, {
    message: "Each private audio file may be assigned to only one track.",
  });

export const organizationMusicPieceRequestSchema = z.object({
  arranger: z.string().trim().max(300).default(""),
  catalogId: z.string().trim().max(200).default(""),
  composer: z.string().trim().max(300).default(""),
  copies: z.number().int().min(0).max(1_000_000).nullable().default(null),
  durationSeconds: z.number().int().min(0).max(86_400).nullable().default(null),
  genres: uniqueMusicLabelsSchema.default([]),
  notes: z.string().trim().max(100_000).default(""),
  parentId: z.uuid().nullable().default(null),
  purchaseDate: z.iso.date().nullable().default(null),
  sectionBuckets: uniqueMusicLabelsSchema.default([]),
  title: z.string().trim().min(1).max(500),
  trackFileIds: musicTrackFileIdsSchema.default({}),
});

export const organizationMusicBulkUpdateRequestSchema = z
  .object({
    pieceIds: z
      .array(z.uuid())
      .min(1)
      .max(500)
      .superRefine((ids, context) => {
        if (new Set(ids).size !== ids.length) {
          context.addIssue({ code: "custom", message: "Music piece IDs must be unique." });
        }
      }),
    changes: z
      .object({
        arranger: z.string().trim().max(300).optional(),
        composer: z.string().trim().max(300).optional(),
        genres: uniqueMusicLabelsSchema.optional(),
        sectionBuckets: uniqueMusicLabelsSchema.optional(),
      })
      .refine((changes) => Object.keys(changes).length > 0, {
        message: "At least one music field must be selected for bulk update.",
      }),
  })
  .strict();

export const organizationMusicPieceSchema = organizationMusicPieceRequestSchema.extend({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  lastPerformedAt: z.iso.datetime().nullable().default(null),
  performanceCount: z.number().int().nonnegative().default(0),
  updatedAt: z.iso.datetime(),
});

export const organizationMusicPieceResponseSchema = organizationMusicPieceSchema.extend({
  requestId: requestIdSchema,
});

export const organizationMusicPiecesResponseSchema = z.object({
  pieces: z.array(organizationMusicPieceSchema).max(2_000),
  requestId: requestIdSchema,
});

export const singerLearningTrackPieceSchema = organizationMusicPieceSchema.pick({
  arranger: true,
  composer: true,
  durationSeconds: true,
  id: true,
  parentId: true,
  title: true,
  trackFileIds: true,
});

export const singerLearningTrackPiecesResponseSchema = z.object({
  pieces: z.array(singerLearningTrackPieceSchema).max(2_000),
  requestId: requestIdSchema,
});

export const organizationMusicPieceDeleteResponseSchema = z.object({
  pieceId: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("deleted"),
});

export const organizationMusicImportResponseSchema = z.object({
  imported: z.number().int().min(0).max(500),
  requestId: requestIdSchema,
});

export type OrganizationMusicPieceRequest = z.infer<typeof organizationMusicPieceRequestSchema>;
export type OrganizationMusicBulkUpdateRequest = z.infer<
  typeof organizationMusicBulkUpdateRequestSchema
>;
export type OrganizationMusicPiece = z.infer<typeof organizationMusicPieceSchema>;
export type OrganizationMusicImportResponse = z.infer<typeof organizationMusicImportResponseSchema>;
