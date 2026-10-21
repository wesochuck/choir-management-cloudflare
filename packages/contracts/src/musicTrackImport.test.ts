import { describe, expect, it } from "vitest";
import {
  musicTrackImportAttachRequestSchema,
  musicTrackImportAttachResponseSchema,
  musicTrackImportCommitRequestSchema,
  musicTrackImportCommitResponseSchema,
  musicTrackImportCreateSessionRequestSchema,
  musicTrackImportCreateSessionResponseSchema,
  musicTrackImportDiscardResponseSchema,
  musicTrackImportMatchRequestSchema,
  musicTrackImportMatchResponseSchema,
  musicTrackImportSessionDetailResponseSchema,
  musicTrackImportSessionListResponseSchema,
  musicTrackImportUpdateAssignmentsRequestSchema,
  musicTrackImportUploadResponseSchema,
} from "./musicTrackImport";

describe("musicTrackImport contracts", () => {
  const pieceId = "11111111-1111-4111-8111-111111111111";
  const fileId = "22222222-2222-4222-8222-222222222222";
  const requestId = "33333333-3333-4333-8333-333333333333";

  describe("musicTrackImportAttachRequestSchema", () => {
    it("accepts valid attach request", () => {
      const parsed = musicTrackImportAttachRequestSchema.parse({
        assignments: [
          {
            durationSeconds: 180,
            expectedEmptySlot: true,
            fileId,
            partKey: "tenor1",
            pieceId,
          },
        ],
        idempotencyKey: "import-job-1",
      });
      expect(parsed.assignments).toHaveLength(1);
      expect(parsed.assignments[0]?.partKey).toBe("tenor1");
    });

    it("rejects empty assignments array", () => {
      expect(() =>
        musicTrackImportAttachRequestSchema.parse({
          assignments: [],
          idempotencyKey: "import-job-1",
        }),
      ).toThrow();
    });

    it("rejects invalid partKey characters", () => {
      expect(() =>
        musicTrackImportAttachRequestSchema.parse({
          assignments: [
            {
              fileId,
              partKey: "invalid part key with spaces!",
              pieceId,
            },
          ],
          idempotencyKey: "import-job-1",
        }),
      ).toThrow();
    });
  });

  describe("musicTrackImportAttachResponseSchema", () => {
    it("accepts valid response", () => {
      const parsed = musicTrackImportAttachResponseSchema.parse({
        requestId,
        results: [
          {
            durationUpdated: true,
            fileId,
            partKey: "tenor1",
            pieceId,
            status: "attached",
          },
          {
            durationUpdated: false,
            fileId,
            partKey: "bass",
            pieceId,
            reason: "slot_occupied",
            status: "conflict",
          },
        ],
        summary: {
          attached: 1,
          conflict: 1,
          failed: 0,
          skipped: 0,
        },
      });
      expect(parsed.summary.attached).toBe(1);
      expect(parsed.summary.conflict).toBe(1);
    });
  });

  describe("musicTrackImportMatchRequestSchema", () => {
    it("accepts valid match request", () => {
      const parsed = musicTrackImportMatchRequestSchema.parse({
        candidates: [
          {
            durationSeconds: 220,
            pieceId,
            title: "O Shenandoah",
          },
        ],
        groups: [
          {
            detectedParts: ["tenor", "bass"],
            durationSeconds: 222,
            fileNames: ["01_Shenandoah_Tenor.mp3", "01_Shenandoah_Bass.mp3"],
            groupId: "group-1",
            inferredTitle: "Shenandoah",
            sequenceNumber: "01",
          },
        ],
        performanceTitle: "Fall Concert",
      });
      expect(parsed.groups).toHaveLength(1);
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.useAi).toBeUndefined();
      for (const useAi of [true, false, undefined]) {
        expect(musicTrackImportMatchRequestSchema.parse({ ...parsed, useAi }).useAi).toBe(useAi);
      }
      expect(musicTrackImportMatchRequestSchema.safeParse({ ...parsed, useAi: null }).success).toBe(
        false,
      );
      expect(
        musicTrackImportMatchRequestSchema.safeParse({ ...parsed, useAi: "true" }).success,
      ).toBe(false);
    });
  });

  describe("musicTrackImportMatchResponseSchema", () => {
    it("accepts valid match response", () => {
      const parsed = musicTrackImportMatchResponseSchema.parse({
        model: "@cf/cloudflare/clef-flash",
        requestId,
        suggestions: [
          {
            confidence: "high",
            groupId: "group-1",
            rationale: "Title and duration match",
            suggestedPieceId: pieceId,
          },
        ],
      });
      expect(parsed.suggestions[0]?.confidence).toBe("high");
    });
  });

  describe("session-backed import contracts", () => {
    const manifestItem = {
      clientFileId: "file-1",
      contentType: "audio/mpeg",
      durationSeconds: 215,
      fileName: "Shenandoah_Soprano1.mp3",
      lastModifiedMs: 1_700_000_000_000,
      partKey: "soprano1",
      pieceId,
      sha256Hex: "a".repeat(64),
      sizeBytes: 1024,
    } as const;

    it("accepts a valid create-session request", () => {
      const parsed = musicTrackImportCreateSessionRequestSchema.parse({
        clientBatchKey: "44444444-4444-4444-8444-444444444444",
        items: [manifestItem],
      });
      expect(parsed.items).toHaveLength(1);
    });

    it("rejects duplicate client file IDs and duplicate piece slots", () => {
      const base = {
        clientBatchKey: "44444444-4444-4444-8444-444444444444",
      };
      expect(
        musicTrackImportCreateSessionRequestSchema.safeParse({
          ...base,
          items: [manifestItem, manifestItem],
        }).success,
      ).toBe(false);
      expect(
        musicTrackImportCreateSessionRequestSchema.safeParse({
          ...base,
          items: [manifestItem, { ...manifestItem, clientFileId: "file-2" }],
        }).success,
      ).toBe(false);
      expect(
        musicTrackImportCreateSessionRequestSchema.safeParse({
          ...base,
          items: [manifestItem, { ...manifestItem, clientFileId: "file-2", partKey: "alto1" }],
        }).success,
      ).toBe(true);
    });

    it("rejects oversized files, empty manifests, and non-MP3 content", () => {
      expect(
        musicTrackImportCreateSessionRequestSchema.safeParse({
          clientBatchKey: "44444444-4444-4444-8444-444444444444",
          items: [],
        }).success,
      ).toBe(false);
      expect(
        musicTrackImportCreateSessionRequestSchema.safeParse({
          clientBatchKey: "44444444-4444-4444-8444-444444444444",
          items: [{ ...manifestItem, sizeBytes: 21 * 1024 * 1024 }],
        }).success,
      ).toBe(false);
      expect(
        musicTrackImportCreateSessionRequestSchema.safeParse({
          clientBatchKey: "44444444-4444-4444-8444-444444444444",
          items: [{ ...manifestItem, contentType: "audio/wav" }],
        }).success,
      ).toBe(false);
      expect(
        musicTrackImportCreateSessionRequestSchema.safeParse({
          clientBatchKey: "44444444-4444-4444-8444-444444444444",
          items: [{ ...manifestItem, sha256Hex: "not-hex" }],
        }).success,
      ).toBe(false);
    });

    it("accepts session lifecycle payloads", () => {
      expect(
        musicTrackImportCreateSessionResponseSchema.parse({
          counts: {
            attachFailed: 0,
            attached: 0,
            cleanupPending: 0,
            conflict: 0,
            planned: 1,
            reclaimed: 0,
            total: 1,
            uploadFailed: 0,
            uploaded: 0,
            uploading: 0,
          },
          expiresAt: "2026-10-22T00:00:00.000Z",
          items: [{ clientFileId: "file-1", status: "planned" }],
          manifestRevision: 1,
          requestId,
          sessionId: "55555555-5555-4555-8555-555555555555",
        }).sessionId,
      ).toBe("55555555-5555-4555-8555-555555555555");
      expect(
        musicTrackImportSessionListResponseSchema.parse({ requestId, sessions: [] }).sessions,
      ).toEqual([]);
      expect(
        musicTrackImportUpdateAssignmentsRequestSchema.parse({
          assignments: [
            {
              clientFileId: "file-1",
              durationSeconds: null,
              partKey: "alto1",
              pieceId,
            },
          ],
          expectedRevision: 1,
        }).expectedRevision,
      ).toBe(1);
      expect(
        musicTrackImportCommitRequestSchema.parse({
          commitKey: "66666666-6666-4666-8666-666666666666",
          expectedRevision: 2,
        }).commitKey,
      ).toBe("66666666-6666-4666-8666-666666666666");
    });

    it("accepts upload, commit, and discard payloads", () => {
      const commit = musicTrackImportCommitResponseSchema.parse({
        committedAt: "2026-10-22T00:00:00.000Z",
        commitKey: "66666666-6666-4666-8666-666666666666",
        manifestRevision: 2,
        requestId,
        results: [
          {
            clientFileId: "file-1",
            durationUpdated: true,
            fileId,
            partKey: "soprano1",
            pieceId,
            status: "attached",
          },
        ],
        sessionId: "55555555-5555-4555-8555-555555555555",
        summary: { attached: 1, conflict: 0, failed: 0, skipped: 0 },
      });
      expect(commit.summary.attached).toBe(1);
      const detail = musicTrackImportSessionDetailResponseSchema.parse({
        requestId,
        session: {
          absoluteExpiresAt: "2026-10-29T00:00:00.000Z",
          clientBatchKey: "44444444-4444-4444-8444-444444444444",
          closedAt: null,
          counts: {
            attachFailed: 0,
            attached: 1,
            cleanupPending: 0,
            conflict: 0,
            planned: 0,
            reclaimed: 0,
            total: 1,
            uploadFailed: 0,
            uploaded: 0,
            uploading: 0,
          },
          expiresAt: "2026-10-22T00:00:00.000Z",
          items: [
            {
              attempts: [{ attemptNumber: 1, fileId, leaseExpiresAt: null, status: "ready" }],
              clientFileId: "file-1",
              contentType: "audio/mpeg",
              currentFileId: fileId,
              durationSeconds: 215,
              errorCode: null,
              fileName: "Shenandoah_Soprano1.mp3",
              partKey: "soprano1",
              pieceId,
              sha256Hex: "a".repeat(64),
              sizeBytes: 1024,
              status: "attached",
            },
          ],
          lastFailureCode: null,
          manifestRevision: 2,
          sessionId: "55555555-5555-4555-8555-555555555555",
          state: "partial",
        },
      });
      expect(detail.session.items).toHaveLength(1);
      const discard = musicTrackImportDiscardResponseSchema.parse({
        requestId,
        sessionId: "55555555-5555-4555-8555-555555555555",
        state: "cleanup_pending",
        statuses: [{ clientFileId: "file-1", status: "uploaded" }],
      });
      expect(discard.state).toBe("cleanup_pending");
      const upload = musicTrackImportUploadResponseSchema.parse({
        bytesReceived: 1024,
        fileId,
        requestId,
        status: "already_uploaded",
      });
      expect(upload.status).toBe("already_uploaded");
    });
  });
});
