import { z } from "zod";
import { requestIdSchema } from "./primitives";

export const musicTrackAttachmentAssignmentSchema = z.object({
  durationSeconds: z.number().int().min(1).max(86_400).nullable().optional(),
  expectedEmptySlot: z.boolean().default(true),
  fileId: z.uuid(),
  partKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  pieceId: z.uuid(),
});

export const musicTrackImportAttachRequestSchema = z.object({
  assignments: z.array(musicTrackAttachmentAssignmentSchema).min(1).max(200),
  idempotencyKey: z.string().trim().min(1).max(128),
});

export const musicTrackAttachmentResultSchema = z.object({
  durationUpdated: z.boolean().default(false),
  fileId: z.uuid(),
  partKey: z.string(),
  pieceId: z.uuid(),
  reason: z.string().optional(),
  status: z.enum(["attached", "conflict", "skipped", "failed"]),
});

export const musicTrackImportAttachResponseSchema = z.object({
  requestId: requestIdSchema,
  results: z.array(musicTrackAttachmentResultSchema),
  summary: z.object({
    attached: z.number().int().nonnegative(),
    conflict: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
});

export type MusicTrackAttachmentAssignment = z.infer<typeof musicTrackAttachmentAssignmentSchema>;
export type MusicTrackImportAttachRequest = z.infer<typeof musicTrackImportAttachRequestSchema>;
export type MusicTrackAttachmentResult = z.infer<typeof musicTrackAttachmentResultSchema>;
export type MusicTrackImportAttachResponse = z.infer<typeof musicTrackImportAttachResponseSchema>;

export const musicTrackImportMatchCandidateSchema = z.object({
  arranger: z.string().optional(),
  composer: z.string().optional(),
  durationSeconds: z.number().int().nullable().optional(),
  occupiedPartKeys: z.array(z.string()).default([]),
  pieceId: z.uuid(),
  title: z.string().min(1).max(500),
});

export const musicTrackImportGroupMetadataSchema = z.object({
  detectedParts: z.array(z.string()).default([]),
  durationSeconds: z.number().int().nullable().optional(),
  fileNames: z.array(z.string().min(1).max(500)).min(1).max(50),
  groupId: z.string().min(1).max(100),
  inferredTitle: z.string().optional(),
  sequenceNumber: z.string().optional(),
});

export const musicTrackImportMatchRequestSchema = z.object({
  candidates: z.array(musicTrackImportMatchCandidateSchema).min(1).max(200),
  groups: z.array(musicTrackImportGroupMetadataSchema).min(1).max(50),
  performanceTitle: z.string().optional(),
});

export const musicTrackImportGroupSuggestionSchema = z.object({
  confidence: z.enum(["high", "medium", "low", "none"]),
  groupId: z.string(),
  rationale: z.string().max(500).optional(),
  suggestedPieceId: z.uuid().nullable(),
});

export const musicTrackImportMatchResponseSchema = z.object({
  model: z.string(),
  requestId: requestIdSchema,
  suggestions: z.array(musicTrackImportGroupSuggestionSchema),
});

export type MusicTrackImportMatchCandidate = z.infer<typeof musicTrackImportMatchCandidateSchema>;
export type MusicTrackImportGroupMetadata = z.infer<typeof musicTrackImportGroupMetadataSchema>;
export type MusicTrackImportMatchRequest = z.infer<typeof musicTrackImportMatchRequestSchema>;
export type MusicTrackImportGroupSuggestion = z.infer<typeof musicTrackImportGroupSuggestionSchema>;
export type MusicTrackImportMatchResponse = z.infer<typeof musicTrackImportMatchResponseSchema>;
