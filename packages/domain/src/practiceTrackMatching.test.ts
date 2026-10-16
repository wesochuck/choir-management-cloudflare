import { describe, expect, it } from "vitest";
import {
  groupPracticeTrackFiles,
  moveFileBetweenTrackImportGroups,
  parsePracticeTrackFilename,
  rankCandidatePiecesForGroup,
  resolvePracticeTrackAssignments,
  splitFileToNewTrackImportGroup,
  updateFileInTrackImportGroup,
  type ConfiguredPartOption,
  type LibraryPieceOption,
} from "./practiceTrackMatching";

describe("default practice track assignments", () => {
  it("defaults undetected parts only when a piece is selected", () => {
    expect(resolvePracticeTrackAssignments([{ partKey: null }], null).files[0]?.partKey).toBeNull();
    expect(resolvePracticeTrackAssignments([{ partKey: null }], "piece").files[0]?.partKey).toBe(
      "tutti",
    );
  });
  it("preserves detected parts and explicit skips", () => {
    const files = [{ partKey: "soprano" }, { partKey: null, partSelectionChanged: true }];
    expect(resolvePracticeTrackAssignments(files, "piece").files).toEqual(files);
  });
  it("reports duplicate Tutti assignments instead of silently attaching competing recordings", () => {
    expect(
      resolvePracticeTrackAssignments([{ partKey: null }, { partKey: "tutti" }], "piece"),
    ).toMatchObject({ duplicatePartKeys: ["tutti"], hasDuplicatePart: true });
  });
});

describe("practiceTrackMatching", () => {
  const configuredParts: ConfiguredPartOption[] = [
    { key: "soprano1", label: "Soprano 1" },
    { key: "soprano2", label: "Soprano 2" },
    { key: "alto1", label: "Alto 1" },
    { key: "alto2", label: "Alto 2" },
    { key: "tenor1", label: "Tenor 1" },
    { key: "tenor2", label: "Tenor 2" },
    { key: "baritone", label: "Baritone" },
    { key: "bass", label: "Bass" },
    { key: "tutti", label: "Tutti" },
  ];

  describe("parsePracticeTrackFilename", () => {
    const sectionParts: ConfiguredPartOption[] = [
      { key: "S", label: "Sopranos" },
      { key: "A", label: "Altos" },
      { key: "T", label: "Tenors" },
      { key: "B", label: "Basses" },
      { key: "S1", label: "Soprano 1" },
      { key: "T1", label: "Tenor 1" },
      { key: "T2", label: "Tenor 2" },
    ];

    it.each([
      ["03 Tenor 3. A Song in the Air.mp3", "T", "Tenors"],
      ["10 Bass 10. A Song in the Air.mp3", "B", "Basses"],
      ["Song - Sop.mp3", "S", "Sopranos"],
      ["Song - Contralto.mp3", "A", "Altos"],
      ["Song - Tenors.mp3", "T", "Tenors"],
      ["Song - Basses.mp3", "B", "Basses"],
      ["Song - Tenor 1.mp3", "T1", "Tenor 1"],
      ["Song - t2.mp3", "T2", "Tenor 2"],
      ["Song - Soprano1.mp3", "S1", "Soprano 1"],
    ])("maps %s to its configured slot", (fileName, key, label) => {
      expect(parsePracticeTrackFilename(fileName, sectionParts)).toMatchObject({
        detectedPartKey: key,
        detectedPartLabel: label,
      });
    });

    it("preserves title words when matching section codes", () => {
      expect(
        parsePracticeTrackFilename("A Song in the Air.mp3", sectionParts).detectedPartKey,
      ).toBeNull();
      expect(parsePracticeTrackFilename("A Song in the Air - T.mp3", sectionParts)).toMatchObject({
        detectedPartKey: "T",
        inferredTitle: "A Song in the Air",
      });
    });

    it("does not collapse an unconfigured numbered part into a section", () => {
      expect(parsePracticeTrackFilename("Song - Bass 2.mp3", sectionParts).detectedPartKey).toBe(
        "bass2",
      );
    });

    it("leaves ambiguous generic names unresolved", () => {
      const parts = [
        { key: "tenors-a", label: "Tenors" },
        { key: "tenors-b", label: "Tenor" },
      ];
      expect(parsePracticeTrackFilename("Song - Ten.mp3", parts).detectedPartKey).toBe("tenor");
    });

    it("parses standard title, number, and part", () => {
      const parsed = parsePracticeTrackFilename("01 O Shenandoah - Soprano 1.mp3", configuredParts);
      expect(parsed.detectedPartKey).toBe("soprano1");
      expect(parsed.detectedPartLabel).toBe("Soprano 1");
      expect(parsed.sequenceNumber).toBe("01");
      expect(parsed.inferredTitle).toBe("O Shenandoah");
    });

    it("parses abbreviated and underscore naming conventions", () => {
      const parsed = parsePracticeTrackFilename("Concert04_T1.mp3", configuredParts);
      expect(parsed.detectedPartKey).toBe("tenor1");
      expect(parsed.sequenceNumber).toBe("04");

      const parsed2 = parsePracticeTrackFilename("04_tenor2.mp3", configuredParts);
      expect(parsed2.detectedPartKey).toBe("tenor2");
      expect(parsed2.sequenceNumber).toBe("04");

      const parsed3 = parsePracticeTrackFilename("Xmas04_Bar.mp3", configuredParts);
      expect(parsed3.detectedPartKey).toBe("baritone");
      expect(parsed3.sequenceNumber).toBe("04");
    });

    it("parses Tutti / Full mix aliases", () => {
      const parsed1 = parsePracticeTrackFilename("Concert_04_Full.mp3", configuredParts);
      expect(parsed1.detectedPartKey).toBe("tutti");

      const parsed2 = parsePracticeTrackFilename("Song_Tutti_final.mp3", configuredParts);
      expect(parsed2.detectedPartKey).toBe("tutti");

      const parsed3 = parsePracticeTrackFilename("Piece_Mix.mp3", configuredParts);
      expect(parsed3.detectedPartKey).toBe("tutti");
    });

    it("parses Accompaniment aliases", () => {
      const parsed = parsePracticeTrackFilename("Hallelujah_Piano.mp3", configuredParts);
      expect(parsed.detectedPartKey).toBe("accompaniment");
    });

    it("handles files without detected voice part gracefully", () => {
      const parsed = parsePracticeTrackFilename("MysterySong.mp3", configuredParts);
      expect(parsed.detectedPartKey).toBeNull();
      expect(parsed.inferredTitle).toBe("MysterySong");
    });
  });

  describe("groupPracticeTrackFiles", () => {
    it("groups tracks with matching sequence number and close duration", () => {
      const files = [
        parsePracticeTrackFilename("Concert04_T1.mp3", configuredParts, "f1", 222),
        parsePracticeTrackFilename("04_tenor2.mp3", configuredParts, "f2", 222),
        parsePracticeTrackFilename("Xmas04_Bar.mp3", configuredParts, "f3", 223),
        parsePracticeTrackFilename("Concert_04_Full.mp3", configuredParts, "f4", 222),
      ];

      const groups = groupPracticeTrackFiles(files);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.files).toHaveLength(4);
      expect(groups[0]?.hasDuplicatePart).toBe(false);
      expect(groups[0]?.averageDurationSeconds).toBe(222);
    });

    it("CRITICAL: does NOT group unrelated songs that happen to have equal duration", () => {
      const files = [
        // Song A (3:42 = 222s)
        parsePracticeTrackFilename("01_Shenandoah_Tenor.mp3", configuredParts, "f1", 222),
        parsePracticeTrackFilename("01_Shenandoah_Bass.mp3", configuredParts, "f2", 222),

        // Song B (also 3:42 = 222s, but completely unrelated!)
        parsePracticeTrackFilename("09_Ave_Verum_Soprano.mp3", configuredParts, "f3", 222),
        parsePracticeTrackFilename("09_Ave_Verum_Alto.mp3", configuredParts, "f4", 222),
      ];

      const groups = groupPracticeTrackFiles(files);
      expect(groups).toHaveLength(2);
      expect(groups[0]?.files.map((f) => f.clientFileId)).toEqual(["f1", "f2"]);
      expect(groups[1]?.files.map((f) => f.clientFileId)).toEqual(["f3", "f4"]);
    });

    it("detects duplicate voice parts within a group", () => {
      const files = [
        parsePracticeTrackFilename("Christmas09_T2.mp3", configuredParts, "f1", 236),
        parsePracticeTrackFilename("Christmas09_Tenor2_v2.mp3", configuredParts, "f2", 236),
        parsePracticeTrackFilename("Christmas09_Bass.mp3", configuredParts, "f3", 235),
      ];

      const groups = groupPracticeTrackFiles(files);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.hasDuplicatePart).toBe(true);
      expect(groups[0]?.duplicatePartKeys).toEqual(["tenor2"]);
    });

    it("allows moving files between groups and updating detected parts", () => {
      const files = [
        parsePracticeTrackFilename("Christmas09_T2.mp3", configuredParts, "f1", 236),
        parsePracticeTrackFilename("Christmas09_Tenor2_v2.mp3", configuredParts, "f2", 236),
        parsePracticeTrackFilename("Christmas09_Bass.mp3", configuredParts, "f3", 235),
      ];
      const groups = groupPracticeTrackFiles(files);
      expect(groups[0]?.hasDuplicatePart).toBe(true);

      // Split duplicate into a new group
      const split = splitFileToNewTrackImportGroup(groups, "f2", "group-custom");
      expect(split).toHaveLength(2);
      expect(split[0]?.hasDuplicatePart).toBe(false);
      expect(split[1]?.files[0]?.clientFileId).toBe("f2");

      // Or update part of f2 to tenor1 in place
      const updated = updateFileInTrackImportGroup(groups, "f2", {
        detectedPartKey: "tenor1",
        detectedPartLabel: "Tenor 1",
      });
      expect(updated[0]?.hasDuplicatePart).toBe(false);
      expect(updated[0]?.duplicatePartKeys).toHaveLength(0);

      // Move f2 back to group-1 from split
      const moved = moveFileBetweenTrackImportGroups(split, "f2", "group-1");
      expect(moved).toHaveLength(1);
      expect(moved[0]?.files).toHaveLength(3);
    });
  });

  describe("rankCandidatePiecesForGroup", () => {
    const pieces: LibraryPieceOption[] = [
      {
        composer: "Traditional",
        durationSeconds: 222,
        id: "11111111-1111-4111-8111-111111111111",
        title: "O Shenandoah",
        trackFileIds: {},
      },
      {
        composer: "Mozart",
        durationSeconds: 180,
        id: "22222222-2222-4222-8222-222222222222",
        title: "Ave Verum Corpus",
        trackFileIds: { soprano1: "existing-uuid" },
      },
      {
        composer: "Anonymous",
        durationSeconds: 222,
        id: "33333333-3333-4333-8333-333333333333",
        title: "Unrelated Folk Song",
        trackFileIds: {},
      },
    ];

    it("ranks exact title and duration match with high confidence", () => {
      const [group] = groupPracticeTrackFiles([
        parsePracticeTrackFilename("01_Shenandoah_Tenor1.mp3", configuredParts, "f1", 222),
        parsePracticeTrackFilename("01_Shenandoah_Bass.mp3", configuredParts, "f2", 222),
      ]);
      expect(group).toBeDefined();
      if (!group) return;

      const match = rankCandidatePiecesForGroup(group, pieces);
      expect(match.suggestedPiece).not.toBeNull();
      expect(match.suggestedPiece?.piece.id).toBe("11111111-1111-4111-8111-111111111111");
      expect(match.suggestedPiece?.confidence).toBe("high");
      expect(match.suggestedPiece?.conflicts).toHaveLength(0);
    });

    it("does not suggest unrelated pieces from timing, set-list membership, or empty slots", () => {
      for (const duration of [222, null]) {
        const [group] = groupPracticeTrackFiles([
          parsePracticeTrackFilename("Applause.mp3", configuredParts, "f1", duration),
        ]);
        if (!group) throw new Error("Missing group");
        const match = rankCandidatePiecesForGroup(
          group,
          pieces,
          pieces.map((piece) => piece.id),
        );
        expect(match.suggestedPiece).toBeNull();
        expect(match.candidatePieces).toEqual([]);
      }
    });

    it("leaves equally supported arrangements unselected", () => {
      const [group] = groupPracticeTrackFiles([
        parsePracticeTrackFilename("O Shenandoah Tenor.mp3", configuredParts, "f1", 222),
      ]);
      if (!group) throw new Error("Missing group");
      const original = pieces[0];
      if (!original) throw new Error("Missing piece");
      const match = rankCandidatePiecesForGroup(group, [
        original,
        { ...original, id: "another-arrangement" },
      ]);
      expect(match.candidatePieces).toHaveLength(2);
      expect(match.suggestedPiece).toBeNull();
    });

    it("can suggest a numbered track using its selected set-list position", () => {
      const [group] = groupPracticeTrackFiles([
        parsePracticeTrackFilename("Track02_Tenor.mp3", configuredParts, "f1", 180),
      ]);
      if (!group) throw new Error("Missing group");
      const match = rankCandidatePiecesForGroup(
        group,
        pieces,
        pieces.map((piece) => piece.id),
      );
      expect(match.suggestedPiece?.piece.title).toBe("Ave Verum Corpus");
      expect(match.suggestedPiece?.evidence).toContain("Shared sequence number #02");
    });

    it("gives priority and evidence to pieces in selected performance set list", () => {
      const [group] = groupPracticeTrackFiles([
        parsePracticeTrackFilename("Track02_Ave_Verum_Soprano1.mp3", configuredParts, "f1", 180),
      ]);
      expect(group).toBeDefined();
      if (!group) return;

      const match = rankCandidatePiecesForGroup(group, pieces, [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ]);
      expect(match.suggestedPiece?.piece.id).toBe("22222222-2222-4222-8222-222222222222");
      expect(match.suggestedPiece?.evidence).toContain("Linked to selected set list");
      expect(match.suggestedPiece?.conflicts).toContain("soprano1");
    });
  });
});
