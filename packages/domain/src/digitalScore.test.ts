import { describe, expect, it } from "vitest";
import { defaultRosterConfiguration } from "./rosterConfiguration";
import { digitalScoreFileName, resolveMemberScoreFile, scoreDescription } from "./digitalScore";

describe("digitalScore", () => {
  const configuration = {
    ...defaultRosterConfiguration,
    voiceParts: [
      { fullName: "Soprano 1", label: "S1", sectionCode: "S" },
      { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
    ],
  };

  describe("scoreDescription", () => {
    it("returns standard role descriptions", () => {
      expect(scoreDescription("primary")).toBe("Choral Score");
      expect(scoreDescription("full_score")).toBe("Full Score");
      expect(scoreDescription("accompaniment")).toBe("Accompaniment");
      expect(scoreDescription("vocal_score")).toBe("Vocal Score");
    });

    it("resolves voice parts and sections from configuration", () => {
      expect(scoreDescription("S1", configuration)).toBe("Soprano 1");
      expect(scoreDescription("T1", configuration)).toBe("Tenor 1");
      expect(scoreDescription("S", configuration)).toBe("Sopranos");
    });

    it("formats unrecognized keys cleanly", () => {
      expect(scoreDescription("custom_lead_sheet")).toBe("Custom Lead Sheet");
    });
  });

  describe("digitalScoreFileName", () => {
    it("formats standard piece score filenames", () => {
      expect(digitalScoreFileName("Ave Verum Corpus", null, "primary", configuration)).toBe(
        "Ave Verum Corpus - Choral Score.pdf",
      );
      expect(digitalScoreFileName("Ave Verum Corpus", null, "T1", configuration)).toBe(
        "Ave Verum Corpus - Tenor 1.pdf",
      );
      expect(digitalScoreFileName("Ave Verum Corpus", null, "full_score", configuration)).toBe(
        "Ave Verum Corpus - Full Score.pdf",
      );
    });

    it("prefixes movement with parent work title", () => {
      expect(digitalScoreFileName("4. Pie Jesu", "Fauré Requiem", "primary", configuration)).toBe(
        "Fauré Requiem - 4. Pie Jesu - Choral Score.pdf",
      );
      expect(digitalScoreFileName("4. Pie Jesu", "Fauré Requiem", "S1", configuration)).toBe(
        "Fauré Requiem - 4. Pie Jesu - Soprano 1.pdf",
      );
    });

    it("sanitizes unsafe characters and slashes", () => {
      expect(digitalScoreFileName("Messiah / Part 1", null, "primary", configuration)).toBe(
        "Messiah - Part 1 - Choral Score.pdf",
      );
    });

    it("bounds filename to 255 characters", () => {
      const fileName = digitalScoreFileName("x".repeat(500), null, "primary", configuration);
      expect(fileName).toHaveLength(255);
      expect(fileName.endsWith(".pdf")).toBe(true);
    });
  });

  describe("resolveMemberScoreFile", () => {
    it("matches exact voice part score when present", () => {
      const piece = {
        scoreFileIds: {
          primary: "file-primary",
          T1: "file-tenor-1",
        },
      };
      const result = resolveMemberScoreFile(piece, "T1");
      expect(result).toEqual({
        fileId: "file-tenor-1",
        isParentFallback: false,
        key: "T1",
      });
    });

    it("falls back to primary score when member part is missing", () => {
      const piece = {
        scoreFileIds: {
          primary: "file-primary",
          S1: "file-soprano-1",
        },
      };
      const result = resolveMemberScoreFile(piece, "T1");
      expect(result).toEqual({
        fileId: "file-primary",
        isParentFallback: false,
        key: "primary",
      });
    });

    it("falls back to parent work score for multi-work movements", () => {
      const movement = {
        scoreFileIds: {},
      };
      const parentPiece = {
        scoreFileIds: {
          primary: "file-parent-primary",
          T1: "file-parent-tenor-1",
        },
      };
      const result = resolveMemberScoreFile(movement, "T1", parentPiece);
      expect(result).toEqual({
        fileId: "file-parent-tenor-1",
        isParentFallback: true,
        key: "T1",
      });
    });

    it("falls back to parent primary score if movement has no scores and parent lacks part score", () => {
      const movement = {
        scoreFileIds: {},
      };
      const parentPiece = {
        scoreFileIds: {
          primary: "file-parent-primary",
        },
      };
      const result = resolveMemberScoreFile(movement, "T1", parentPiece);
      expect(result).toEqual({
        fileId: "file-parent-primary",
        isParentFallback: true,
        key: "primary",
      });
    });

    it("returns null if no scores exist anywhere", () => {
      const movement = { scoreFileIds: {} };
      const parentPiece = { scoreFileIds: {} };
      expect(resolveMemberScoreFile(movement, "T1", parentPiece)).toBeNull();
    });
  });
});
