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
const uniqueMusicLabelsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(100)
  .superRefine((labels, context) => {
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", message: "Music labels must be unique." });
    }
  });

const organizationMusicLibrarySettingsFieldsSchema = z.object({
  defaultPageSize: z.number().int().min(10).max(500).default(100),
  genres: uniqueMusicLabelsSchema.default([]),
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

export const organizationMusicBulkDeleteRequestSchema = z
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
    unlinkChildren: z.boolean().optional().default(false),
  })
  .strict();

export const organizationMusicCreditRenameRequestSchema = z
  .object({
    currentName: z.string().trim().min(1).max(300),
    newName: z.string().trim().min(1).max(300),
  })
  .strict()
  .refine(({ currentName, newName }) => currentName !== newName, {
    message: "The new credit name must differ from the current name.",
    path: ["newName"],
  });

export const organizationMusicGenreRenameRequestSchema = z
  .object({
    currentLabel: z.string().trim().min(1).max(100),
    newLabel: z.string().trim().min(1).max(100),
  })
  .strict()
  .refine(({ currentLabel, newLabel }) => currentLabel !== newLabel, {
    message: "The new genre label must differ from the current label.",
    path: ["newLabel"],
  });

export const organizationMusicGenreDeleteRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
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
  pieces: z.array(organizationMusicPieceSchema).max(5_000),
  requestId: requestIdSchema,
});

export const organizationMusicGenreMutationResponseSchema = z.object({
  pieces: z.array(organizationMusicPieceSchema).max(5_000),
  requestId: requestIdSchema,
  settings: organizationMusicLibrarySettingsFieldsSchema,
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

export const organizationMusicBulkDeleteResponseSchema = z.object({
  deletedIds: z.array(z.uuid()).max(500),
  requestId: requestIdSchema,
});

export const organizationMusicImportResponseSchema = z.object({
  errors: z
    .array(z.object({ reason: z.string().min(1).max(500), row: z.number().int().min(2) }))
    .max(500),
  imported: z.number().int().min(0).max(500),
  requestId: requestIdSchema,
  skipped: z.number().int().min(0).max(500),
});

export type OrganizationMusicPieceRequest = z.infer<typeof organizationMusicPieceRequestSchema>;
export type OrganizationMusicBulkUpdateRequest = z.infer<
  typeof organizationMusicBulkUpdateRequestSchema
>;
export type OrganizationMusicBulkDeleteRequest = z.infer<
  typeof organizationMusicBulkDeleteRequestSchema
>;
export type OrganizationMusicCreditRenameRequest = z.infer<
  typeof organizationMusicCreditRenameRequestSchema
>;
export type OrganizationMusicGenreRenameRequest = z.infer<
  typeof organizationMusicGenreRenameRequestSchema
>;
export type OrganizationMusicGenreDeleteRequest = z.infer<
  typeof organizationMusicGenreDeleteRequestSchema
>;
export type OrganizationMusicPiece = z.infer<typeof organizationMusicPieceSchema>;
export type OrganizationMusicBulkDeleteResponse = z.infer<
  typeof organizationMusicBulkDeleteResponseSchema
>;
export type OrganizationMusicImportResponse = z.infer<typeof organizationMusicImportResponseSchema>;
