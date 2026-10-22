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
  arranger: z.string().max(500).optional(),
  composer: z.string().max(500).optional(),
  durationSeconds: z.number().int().nullable().optional(),
  occupiedPartKeys: z.array(z.string().max(100)).max(102).default([]),
  pieceId: z.uuid(),
  title: z.string().min(1).max(500),
});

export const rankedPieceSuggestionSchema = z.object({
  pieceId: z.uuid(),
  probability: z.number().min(0).max(1),
});

export const filePartAlternativeSchema = z.object({
  partKey: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,100}$/)
    .nullable(),
  probability: z.number().min(0).max(1),
});

export const filePartSuggestionSchema = z.object({
  alternatives: z.array(filePartAlternativeSchema).max(5).optional(),
  clientFileId: z.string().min(1).max(100),
  evidence: z.string().max(500).optional(),
  probability: z.number().min(0).max(1),
  reason: z.enum(["missing", "conflict", "correction"]).optional(),
  suggestedPartKey: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,100}$/)
    .nullable(),
});

export const musicTrackImportFileMetadataSchema = z.object({
  album: z.string().max(500).optional(),
  artist: z.string().max(500).optional(),
  clientFileId: z.string().min(1).max(100),
  composer: z.string().max(500).optional(),
  currentPartKey: z.string().max(100).optional(),
  detectedPartKey: z.string().max(100).optional(),
  detectedPartLabel: z.string().max(100).optional(),
  durationSeconds: z.number().int().min(1).max(86_400).nullable().optional(),
  excluded: z.boolean().optional(),
  fileName: z.string().min(1).max(500),
  inferredTitle: z.string().max(500).optional(),
  manualPart: z.boolean().optional(),
  reviewed: z.boolean().optional(),
  sequenceNumber: z.string().max(50).optional(),
  title: z.string().max(500).optional(),
  trackNumber: z.string().max(50).optional(),
});

export const musicTrackImportGroupMetadataSchema = z.object({
  detectedParts: z.array(z.string().max(100)).max(50).default([]),
  durationSeconds: z.number().int().nullable().optional(),
  fileMetadata: z.array(musicTrackImportFileMetadataSchema).max(50).optional(),
  fileNames: z.array(z.string().min(1).max(500)).min(1).max(50),
  groupId: z.string().min(1).max(100),
  inferredTitle: z.string().max(500).optional(),
  sequenceNumber: z.string().max(50).optional(),
});

export const musicTrackImportSetListItemSchema = z.object({
  pieceId: z.uuid().nullable().optional(),
  position: z.number().int().min(1),
  title: z.string().min(1).max(500),
  type: z.string().max(100).optional(),
});

export const musicTrackImportPerformanceContextSchema = z.object({
  eventTitle: z.string().min(1).max(500),
  setList: z.array(musicTrackImportSetListItemSchema).max(200),
});

export const musicTrackImportConfiguredPartOptionSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  kind: z.enum(["section", "voice_part", "special"]).optional(),
  label: z.string().min(1).max(300),
});

export const musicTrackImportGroupRepairSuggestionSchema = z.discriminatedUnion("kind", [
  z.object({
    confidence: z.number().min(0).max(1),
    evidence: z.string().max(500),
    groupIds: z.array(z.string().min(1).max(100)).min(2).max(50),
    kind: z.literal("merge_groups"),
    targetGroupId: z.string().min(1).max(100).optional(),
  }),
  z.object({
    confidence: z.number().min(0).max(1),
    evidence: z.string().max(500),
    fileSubsets: z
      .array(
        z.object({
          clientFileIds: z.array(z.string().min(1).max(100)).min(1),
          suggestedTitle: z.string().max(500).optional(),
        }),
      )
      .min(2),
    kind: z.literal("split_group"),
    sourceGroupId: z.string().min(1).max(100),
  }),
  z.object({
    clientFileIds: z.array(z.string().min(1).max(100)).min(1),
    confidence: z.number().min(0).max(1),
    evidence: z.string().max(500),
    kind: z.literal("move_files"),
    sourceGroupId: z.string().min(1).max(100),
    targetGroupId: z.string().min(1).max(100),
  }),
]);

export const musicTrackImportStageSchema = z.enum([
  "group_repair",
  "piece_matching",
  "part_review",
]);

export const musicTrackImportStageStatusSchema = z.enum(["complete", "partial", "unavailable"]);

const musicTrackImportMatchRequestObjectSchema = z.object({
  candidates: z.array(musicTrackImportMatchCandidateSchema).min(1).max(1000),
  configuredParts: z.array(musicTrackImportConfiguredPartOptionSchema).max(100).optional(),
  configuredPartKeys: z
    .array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/))
    .max(100)
    .optional(),
  groups: z.array(musicTrackImportGroupMetadataSchema).min(1).max(200),
  performanceContext: musicTrackImportPerformanceContextSchema.optional(),
  performanceTitle: z.string().max(500).optional(),
  stage: musicTrackImportStageSchema.optional(),
  useAi: z.boolean().optional(),
});

export const musicTrackImportMatchRequestSchema =
  musicTrackImportMatchRequestObjectSchema.superRefine((request, ctx) => {
    const keys = request.configuredPartKeys ?? [];
    if (new Set(keys).size !== keys.length || keys.includes("none"))
      ctx.addIssue({
        code: "custom",
        message: "Configured keys must be unique; none is reserved.",
      });
    const groups = new Set<string>();
    const files = new Set<string>();
    const pieces = new Set<string>();
    for (const candidate of request.candidates) {
      if (pieces.has(candidate.pieceId))
        ctx.addIssue({ code: "custom", message: "Duplicate candidate." });
      pieces.add(candidate.pieceId);
    }
    for (const group of request.groups) {
      if (groups.has(group.groupId)) ctx.addIssue({ code: "custom", message: "Duplicate group." });
      groups.add(group.groupId);
      if (group.fileMetadata && group.fileMetadata.length !== group.fileNames.length)
        ctx.addIssue({ code: "custom", message: "Metadata must identify each source file." });
      for (const file of group.fileMetadata ?? []) {
        if (files.has(file.clientFileId))
          ctx.addIssue({ code: "custom", message: "Duplicate source file." });
        files.add(file.clientFileId);
      }
    }
  });

export const musicTrackImportGroupSuggestionSchema = z.object({
  confidence: z.enum(["high", "medium", "low", "none"]),
  filePartSuggestions: z.array(filePartSuggestionSchema).max(50).optional(),
  groupId: z.string(),
  noneProbability: z.number().min(0).max(1).optional(),
  rationale: z.string().max(500).optional(),
  suggestedPieceId: z.uuid().nullable(),
  topCandidates: z.array(rankedPieceSuggestionSchema).max(3).optional(),
});

export const musicTrackImportMatchResponseSchema = z.object({
  completedFileIds: z.array(z.string()).optional(),
  completedGroupIds: z.array(z.string()).optional(),
  diagnostics: z
    .object({
      estimatedInputTokens: z.number().int().nonnegative(),
      inputBytes: z.number().int().nonnegative(),
      latencyMs: z.number().nonnegative(),
      providerCalls: z.number().int().nonnegative(),
      questions: z.number().int().nonnegative(),
    })
    .optional(),
  failedCount: z.number().int().nonnegative().optional(),
  groupRepairSuggestions: z.array(musicTrackImportGroupRepairSuggestionSchema).optional(),
  model: z.string(),
  reason: z.string().max(500).optional(),
  requestId: requestIdSchema,
  stage: musicTrackImportStageSchema.optional(),
  stageStatus: musicTrackImportStageStatusSchema.optional(),
  suggestions: z.array(musicTrackImportGroupSuggestionSchema),
  unansweredCount: z.number().int().nonnegative().optional(),
});

export type RankedPieceSuggestion = z.infer<typeof rankedPieceSuggestionSchema>;
export type FilePartAlternative = z.infer<typeof filePartAlternativeSchema>;
export type FilePartSuggestion = z.infer<typeof filePartSuggestionSchema>;
export type MusicTrackImportConfiguredPartOption = z.infer<
  typeof musicTrackImportConfiguredPartOptionSchema
>;
export type MusicTrackImportFileMetadata = z.infer<typeof musicTrackImportFileMetadataSchema>;
export type MusicTrackImportGroupMetadata = z.infer<typeof musicTrackImportGroupMetadataSchema>;
export type MusicTrackImportGroupRepairSuggestion = z.infer<
  typeof musicTrackImportGroupRepairSuggestionSchema
>;
export type MusicTrackImportGroupSuggestion = z.infer<typeof musicTrackImportGroupSuggestionSchema>;
export type MusicTrackImportMatchCandidate = z.infer<typeof musicTrackImportMatchCandidateSchema>;
export type MusicTrackImportMatchRequest = z.infer<typeof musicTrackImportMatchRequestSchema>;
export type MusicTrackImportMatchResponse = z.infer<typeof musicTrackImportMatchResponseSchema>;
export type MusicTrackImportPerformanceContext = z.infer<
  typeof musicTrackImportPerformanceContextSchema
>;
export type MusicTrackImportSetListItem = z.infer<typeof musicTrackImportSetListItemSchema>;
export type MusicTrackImportStage = z.infer<typeof musicTrackImportStageSchema>;
export type MusicTrackImportStageStatus = z.infer<typeof musicTrackImportStageStatusSchema>;

// Session-backed durable import (issue #278). The browser wizard stages
// reviewed manifest rows in a server-owned session; uploads, assignments,
// and commits all reference that session. Every state transition is
// transactional in the Organization Durable Object.

export const musicTrackImportSessionStateSchema = z.enum([
  "active",
  "partial",
  "completed",
  "cancel_requested",
  "cleanup_pending",
  "discarded",
  "expired",
]);

export type MusicTrackImportSessionState = z.infer<typeof musicTrackImportSessionStateSchema>;

export const musicTrackImportItemStatusSchema = z.enum([
  "planned",
  "uploading",
  "uploaded",
  "attached",
  "upload_failed",
  "attach_failed",
  "conflict",
  "cleanup_pending",
  "reclaimed",
]);

export type MusicTrackImportItemStatus = z.infer<typeof musicTrackImportItemStatusSchema>;

export const musicTrackImportAttemptStatusSchema = z.enum([
  "reserved",
  "uploading",
  "ready",
  "failed",
  "cleanup_pending",
  "reclaimed",
]);

export type MusicTrackImportAttemptStatus = z.infer<typeof musicTrackImportAttemptStatusSchema>;

export const musicTrackImportManifestItemSchema = z.object({
  clientFileId: z.string().min(1).max(100),
  contentType: z.literal("audio/mpeg"),
  durationSeconds: z.number().int().min(1).max(86_400).nullable(),
  fileName: z.string().min(1).max(500),
  lastModifiedMs: z.number().int().min(0),
  partKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  pieceId: z.uuid(),
  sha256Hex: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(20 * 1024 * 1024),
});

export type MusicTrackImportManifestItem = z.infer<typeof musicTrackImportManifestItemSchema>;

export const musicTrackImportCreateSessionRequestSchema = z
  .object({
    clientBatchKey: z.uuid(),
    items: z.array(musicTrackImportManifestItemSchema).min(1).max(100),
  })
  .superRefine((request, context) => {
    const clientFileIds = new Set<string>();
    for (const item of request.items) {
      if (clientFileIds.has(item.clientFileId)) {
        context.addIssue({
          code: "custom",
          message: "Each manifest row must have a distinct client file ID.",
          path: ["items"],
        });
        return;
      }
      clientFileIds.add(item.clientFileId);
    }
    const targets = new Set<string>();
    for (const item of request.items) {
      const target = `${item.pieceId}::${item.partKey}`;
      if (targets.has(target)) {
        context.addIssue({
          code: "custom",
          message: "Each manifest row must target a distinct piece slot.",
          path: ["items"],
        });
        return;
      }
      targets.add(target);
    }
  });

export type MusicTrackImportCreateSessionRequest = z.infer<
  typeof musicTrackImportCreateSessionRequestSchema
>;

export const musicTrackImportSessionCountsSchema = z.object({
  attachFailed: z.number().int().nonnegative(),
  attached: z.number().int().nonnegative(),
  cleanupPending: z.number().int().nonnegative(),
  conflict: z.number().int().nonnegative(),
  planned: z.number().int().nonnegative(),
  reclaimed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  uploadFailed: z.number().int().nonnegative(),
  uploaded: z.number().int().nonnegative(),
  uploading: z.number().int().nonnegative(),
});

export type MusicTrackImportSessionCounts = z.infer<typeof musicTrackImportSessionCountsSchema>;

export const musicTrackImportSessionSummarySchema = z.object({
  absoluteExpiresAt: z.string(),
  clientBatchKey: z.uuid(),
  closedAt: z.string().nullable(),
  counts: musicTrackImportSessionCountsSchema,
  expiresAt: z.string(),
  lastFailureCode: z.string().nullable(),
  manifestRevision: z.number().int().nonnegative(),
  sessionId: z.uuid(),
  state: musicTrackImportSessionStateSchema,
});

export type MusicTrackImportSessionSummary = z.infer<typeof musicTrackImportSessionSummarySchema>;

export const musicTrackImportCreateSessionResponseSchema = z.object({
  counts: musicTrackImportSessionCountsSchema,
  expiresAt: z.string(),
  items: z.array(
    z.object({
      clientFileId: z.string(),
      status: musicTrackImportItemStatusSchema,
    }),
  ),
  manifestRevision: z.number().int().nonnegative(),
  requestId: requestIdSchema,
  sessionId: z.uuid(),
});

export type MusicTrackImportCreateSessionResponse = z.infer<
  typeof musicTrackImportCreateSessionResponseSchema
>;

export const musicTrackImportUploadResponseSchema = z.object({
  bytesReceived: z.number().int().nonnegative(),
  fileId: z.uuid(),
  requestId: z.string(),
  status: z.enum(["uploaded", "already_uploaded"]),
});

export const musicTrackImportSessionListResponseSchema = z.object({
  requestId: requestIdSchema,
  sessions: z.array(musicTrackImportSessionSummarySchema),
});

export type MusicTrackImportSessionListResponse = z.infer<
  typeof musicTrackImportSessionListResponseSchema
>;

export const musicTrackImportSessionAttemptSchema = z.object({
  attemptNumber: z.number().int().min(1),
  fileId: z.uuid(),
  leaseExpiresAt: z.string().nullable(),
  status: musicTrackImportAttemptStatusSchema,
});

export type MusicTrackImportSessionAttempt = z.infer<typeof musicTrackImportSessionAttemptSchema>;

export const musicTrackImportSessionItemSchema = z.object({
  attempts: z.array(musicTrackImportSessionAttemptSchema),
  clientFileId: z.string(),
  contentType: z.string(),
  currentFileId: z.uuid().nullable(),
  durationSeconds: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  fileName: z.string(),
  partKey: z.string(),
  pieceId: z.uuid(),
  sha256Hex: z.string(),
  sizeBytes: z.number().int(),
  status: musicTrackImportItemStatusSchema,
});

export type MusicTrackImportSessionItem = z.infer<typeof musicTrackImportSessionItemSchema>;

export const musicTrackImportSessionDetailSchema = musicTrackImportSessionSummarySchema.extend({
  items: z.array(musicTrackImportSessionItemSchema),
});

export type MusicTrackImportSessionDetail = z.infer<typeof musicTrackImportSessionDetailSchema>;

export const musicTrackImportSessionDetailResponseSchema = z.object({
  requestId: requestIdSchema,
  session: musicTrackImportSessionDetailSchema,
});

export type MusicTrackImportSessionDetailResponse = z.infer<
  typeof musicTrackImportSessionDetailResponseSchema
>;

export const musicTrackImportAssignmentUpdateSchema = z.object({
  clientFileId: z.string().min(1).max(100),
  durationSeconds: z.number().int().min(1).max(86_400).nullable(),
  partKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  pieceId: z.uuid(),
});

export type MusicTrackImportAssignmentUpdate = z.infer<
  typeof musicTrackImportAssignmentUpdateSchema
>;

export const musicTrackImportUpdateAssignmentsRequestSchema = z.object({
  assignments: z.array(musicTrackImportAssignmentUpdateSchema).min(1).max(100),
  expectedRevision: z.number().int().nonnegative(),
});

export type MusicTrackImportUpdateAssignmentsRequest = z.infer<
  typeof musicTrackImportUpdateAssignmentsRequestSchema
>;

export const musicTrackImportCommitRequestSchema = z.object({
  commitKey: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
});

export type MusicTrackImportCommitRequest = z.infer<typeof musicTrackImportCommitRequestSchema>;

export const musicTrackImportCommitResultSchema = z.object({
  clientFileId: z.string(),
  durationUpdated: z.boolean().default(false),
  fileId: z.uuid().nullable(),
  partKey: z.string(),
  pieceId: z.uuid(),
  reason: z.string().optional(),
  status: z.enum(["attached", "conflict", "skipped", "failed"]),
});

export type MusicTrackImportCommitResult = z.infer<typeof musicTrackImportCommitResultSchema>;

export const musicTrackImportCommitResponseSchema = z.object({
  committedAt: z.string(),
  commitKey: z.uuid(),
  manifestRevision: z.number().int().nonnegative(),
  requestId: requestIdSchema,
  results: z.array(musicTrackImportCommitResultSchema),
  sessionId: z.uuid(),
  summary: z.object({
    attached: z.number().int().nonnegative(),
    conflict: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
});

export type MusicTrackImportCommitResponse = z.infer<typeof musicTrackImportCommitResponseSchema>;

export const musicTrackImportDiscardResponseSchema = z.object({
  requestId: z.string(),
  sessionId: z.uuid(),
  state: musicTrackImportSessionStateSchema,
  statuses: z.array(
    z.object({
      clientFileId: z.string(),
      status: musicTrackImportItemStatusSchema,
    }),
  ),
});

export type MusicTrackImportDiscardResponse = z.infer<typeof musicTrackImportDiscardResponseSchema>;
