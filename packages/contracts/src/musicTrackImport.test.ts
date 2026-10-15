import { describe, expect, it } from "vitest";
import {
  musicTrackImportAttachRequestSchema,
  musicTrackImportAttachResponseSchema,
  musicTrackImportMatchRequestSchema,
  musicTrackImportMatchResponseSchema,
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
});
