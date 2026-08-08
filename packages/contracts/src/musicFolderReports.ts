import { z } from "zod";

import { requestIdSchema } from "./primitives";

export const MUSIC_FOLDER_REPORT_MAX_PERFORMANCES = 500;
export const MUSIC_FOLDER_REPORT_MAX_UPDATES = 500;
export const MUSIC_FOLDER_REPORT_MAX_EXPORT_ROWS = 100_000;
export const MUSIC_FOLDER_REPORT_MAX_EXPORT_BYTES = 10 * 1024 * 1024;

const profileStatusSchema = z.enum(["Active", "Idle", "Inactive"]);

export const musicFolderReportPerformanceOptionSchema = z.object({
  assignedFolderCount: z.number().int().nonnegative(),
  id: z.uuid(),
  isArchived: z.boolean(),
  isCanceled: z.boolean(),
  startsAt: z.iso.datetime(),
  title: z.string().min(1).max(500),
});

export const musicFolderReportSelectionSchema = z.object({
  eventIds: z
    .array(z.uuid())
    .max(MUSIC_FOLDER_REPORT_MAX_PERFORMANCES)
    .refine((eventIds) => new Set(eventIds).size === eventIds.length, {
      message: "Performance IDs must be unique.",
    }),
});

export const musicFolderReportTotalsSchema = z.object({
  assigned: z.number().int().nonnegative(),
  notAssigned: z.number().int().nonnegative(),
  outstanding: z.number().int().nonnegative(),
  returnRate: z.number().min(0).max(1),
  returned: z.number().int().nonnegative(),
});

export const musicFolderReportSummarySchema = z.object({
  assigned: z.number().int().nonnegative(),
  displayName: z.string().min(1).max(200),
  globalStatus: profileStatusSchema,
  notAssigned: z.number().int().nonnegative(),
  outstanding: z.number().int().nonnegative(),
  profileId: z.uuid(),
  returnRate: z.number().min(0).max(1),
  returned: z.number().int().nonnegative(),
});

export const musicFolderReportQueryResponseSchema = z.object({
  performanceOptions: z.array(musicFolderReportPerformanceOptionSchema).max(500),
  requestId: requestIdSchema,
  selectedEventIds: z.array(z.uuid()).max(MUSIC_FOLDER_REPORT_MAX_PERFORMANCES),
  summaries: z.array(musicFolderReportSummarySchema).max(500),
  totals: musicFolderReportTotalsSchema,
});

export const musicFolderReturnStatusSchema = z.enum([
  "returned",
  "outstanding",
  "not_assigned",
  "not_applicable",
]);

export const musicFolderReportDetailRowSchema = z.object({
  eventId: z.uuid(),
  eventTitle: z.string().min(1).max(500),
  folderNumber: z.string().max(50),
  folderReturned: z.boolean(),
  isArchived: z.boolean(),
  isCanceled: z.boolean(),
  profileId: z.uuid(),
  returnedAt: z.iso.datetime().nullable(),
  startsAt: z.iso.datetime(),
  status: musicFolderReturnStatusSchema,
  updatedAt: z.iso.datetime().nullable(),
});

export const musicFolderReportProfileDetailResponseSchema = z.object({
  displayName: z.string().min(1).max(200),
  globalStatus: profileStatusSchema,
  profileId: z.uuid(),
  requestId: requestIdSchema,
  rows: z.array(musicFolderReportDetailRowSchema).max(MUSIC_FOLDER_REPORT_MAX_PERFORMANCES),
  selectedEventIds: z.array(z.uuid()).max(MUSIC_FOLDER_REPORT_MAX_PERFORMANCES),
});

export const musicFolderNumberEditSchema = z.object({
  eventId: z.uuid(),
  folderNumber: z.string().trim().max(50),
  expectedUpdatedAt: z.iso.datetime().nullable(),
  profileId: z.uuid(),
});

export const musicFolderNumberBatchRequestSchema = z.object({
  updates: z
    .array(musicFolderNumberEditSchema)
    .min(1)
    .max(MUSIC_FOLDER_REPORT_MAX_UPDATES)
    .refine(
      (updates) =>
        new Set(updates.map((update) => `${update.eventId}:${update.profileId}`)).size ===
        updates.length,
      { message: "Folder updates must target unique Profile and Performance pairs." },
    ),
});

export const musicFolderNumberMutationResultSchema = z.object({
  code: z.string().min(1).max(100).nullable(),
  eventId: z.uuid(),
  message: z.string().min(1).max(500),
  profileId: z.uuid(),
  result: z.enum(["applied", "conflict", "invalid", "stale"]),
  row: musicFolderReportDetailRowSchema.nullable(),
});

export const musicFolderNumberBatchResponseSchema = z.object({
  requestId: requestIdSchema,
  results: z.array(musicFolderNumberMutationResultSchema).max(MUSIC_FOLDER_REPORT_MAX_UPDATES),
});

export const musicFolderReturnStatusRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime().nullable(),
  folderReturned: z.boolean(),
});

export const musicFolderReturnStatusResponseSchema = z.object({
  requestId: requestIdSchema,
  row: musicFolderReportDetailRowSchema,
});

export type MusicFolderReportDetailRow = z.infer<typeof musicFolderReportDetailRowSchema>;
export type MusicFolderReportProfileDetailResponse = z.infer<
  typeof musicFolderReportProfileDetailResponseSchema
>;
export type MusicFolderReportPerformanceOption = z.infer<
  typeof musicFolderReportPerformanceOptionSchema
>;
export type MusicFolderReportQueryResponse = z.infer<typeof musicFolderReportQueryResponseSchema>;
export type MusicFolderReportSummary = z.infer<typeof musicFolderReportSummarySchema>;
export type MusicFolderReportTotals = z.infer<typeof musicFolderReportTotalsSchema>;
export type MusicFolderNumberBatchResponse = z.infer<typeof musicFolderNumberBatchResponseSchema>;
export type MusicFolderNumberEdit = z.infer<typeof musicFolderNumberEditSchema>;
export type MusicFolderReportStatus = z.infer<typeof musicFolderReturnStatusSchema>;
export type MusicFolderReturnStatusResponse = z.infer<typeof musicFolderReturnStatusResponseSchema>;
