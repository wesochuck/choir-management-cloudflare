import { describe, expect, it } from "vitest";
import {
  applyGroupRepairSuggestion,
  detectCrossGroupRepairCandidates,
  detectSuspiciousWithinGroupFiles,
  groupPracticeTrackFiles,
  mergeTrackImportGroups,
  moveFileBetweenTrackImportGroups,
  moveFilesBetweenTrackImportGroups,
  nextUniqueGroupId,
  parsePracticeTrackFilename,
  rankCandidatePiecesForGroup,
  resolvePracticeTrackAssignments,
  shortlistCandidatePiecesForGroup,
  splitFileToNewTrackImportGroup,
  splitFilesToNewTrackImportGroup,
  updateFileInTrackImportGroup,
  validateGroupRepairSuggestion,
  type ConfiguredPartOption,
  type GroupRepairAction,
  type LibraryPieceOption,
  type OrderedSetListItem,
} from "./practiceTrackMatching";

describe("default practice track assignments", () => {
  it("keeps undetected parts as null/unassigned even when a piece is selected", () => {
    expect(resolvePracticeTrackAssignments([{ partKey: null }], null).files[0]?.partKey).toBeNull();
    expect(
      resolvePracticeTrackAssignments([{ partKey: null }], "piece").files[0]?.partKey,
    ).toBeNull();
  });
  it("preserves detected parts and explicit skips", () => {
    const files = [{ partKey: "soprano" }, { partKey: null, partSelectionChanged: true }];
    expect(resolvePracticeTrackAssignments(files, "piece").files).toEqual(files);
  });
  it("preserves intentional tutti assignments and detects duplicate tutti files", () => {
    expect(
      resolvePracticeTrackAssignments([{ partKey: "tutti" }, { partKey: "tutti" }], "piece"),
    ).toMatchObject({ duplicatePartKeys: ["tutti"], hasDuplicatePart: true });
    expect(
      resolvePracticeTrackAssignments([{ partKey: null }, { partKey: "tutti" }], "piece"),
    ).toMatchObject({ duplicatePartKeys: [], hasDuplicatePart: false });
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
      expect(
        parsePracticeTrackFilename("Song - Bass 2.mp3", sectionParts).detectedPartKey,
      ).toBeNull();
    });

    it("leaves ambiguous generic names unresolved", () => {
      const parts = [
        { key: "tenors-a", label: "Tenors" },
        { key: "tenors-b", label: "Tenor" },
      ];
      expect(parsePracticeTrackFilename("Song - Ten.mp3", parts).detectedPartKey).toBeNull();
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

    it("uses ID3 metadata title for generic filename like Track01.mp3", () => {
      const parsed = parsePracticeTrackFilename("Track01.mp3", configuredParts, "f1", 180, {
        album: "Choral Classics",
        artist: "London Choir",
        comment: null,
        composer: "W.A. Mozart",
        title: "Ave Verum Corpus",
        trackNumber: "02/10",
      });
      expect(parsed.inferredTitle).toBe("Ave Verum Corpus");
      expect(parsed.sequenceNumber).toBe("01");
    });

    it("matches composer from ID3 metadata and does not treat artist as composer", () => {
      const parsedWithComposer = parsePracticeTrackFilename(
        "Track01.mp3",
        configuredParts,
        "f1",
        180,
        {
          album: "Sacred",
          artist: "Some Choir",
          comment: null,
          composer: "Mozart",
          title: "Ave Verum",
          trackNumber: "02",
        },
      );
      const [group] = groupPracticeTrackFiles([parsedWithComposer]);
      if (!group) throw new Error("Missing group");

      const match = rankCandidatePiecesForGroup(group, pieces);
      expect(match.suggestedPiece?.piece.title).toBe("Ave Verum Corpus");
      expect(match.suggestedPiece?.evidence.some((e) => e.includes("Composer match"))).toBe(true);

      // Now with artist only - artist must NOT match composer
      const parsedWithArtistOnly = parsePracticeTrackFilename(
        "Track01.mp3",
        configuredParts,
        "f1",
        180,
        {
          album: "Sacred",
          artist: "Mozart", // artist, not composer
          comment: null,
          composer: null,
          title: "Ave Verum",
          trackNumber: null,
        },
      );
      const [group2] = groupPracticeTrackFiles([parsedWithArtistOnly]);
      if (!group2) throw new Error("Missing group");
      const match2 = rankCandidatePiecesForGroup(group2, pieces);
      expect(match2.suggestedPiece?.evidence.some((e) => e.includes("Composer match"))).toBe(false);
    });

    it("does not merge distinct songs on duration alone", () => {
      const file1 = parsePracticeTrackFilename("Track01.mp3", configuredParts, "f1", 200, {
        album: null,
        artist: null,
        comment: null,
        composer: null,
        title: "Ave Maria",
        trackNumber: null,
      });
      const file2 = parsePracticeTrackFilename("Track02.mp3", configuredParts, "f2", 200, {
        album: null,
        artist: null,
        comment: null,
        composer: null,
        title: "Hallelujah",
        trackNumber: null,
      });
      const groups = groupPracticeTrackFiles([file1, file2]);
      expect(groups).toHaveLength(2);
      expect(groups[0]?.inferredTitle).toBe("Ave Maria");
      expect(groups[1]?.inferredTitle).toBe("Hallelujah");
    });
  });
});

it("keeps context-poor Choir_Hi unassigned with a non-SATB roster", () => {
  expect(
    parsePracticeTrackFilename("Choir_Hi.mp3", [{ key: "Low", label: "Low voices" }])
      .detectedPartKey,
  ).toBeNull();
  expect(
    parsePracticeTrackFilename("Song - Low.mp3", [{ key: "Low", label: "Low voices" }])
      .detectedPartKey,
  ).toBe("Low");
});

it("does not use an ID3 album track number as a set-list position", () => {
  const file = parsePracticeTrackFilename("Recording.mp3", [], "stable", 180, {
    title: null,
    artist: null,
    composer: null,
    album: "Album",
    trackNumber: "02/12",
    comment: null,
  });
  expect(file.sequenceNumber).toBeNull();
});

describe("shortlistCandidatePiecesForGroup", () => {
  it("bounds candidate pieces to limit even when library has 450+ pieces", () => {
    const group = {
      averageDurationSeconds: 180,
      duplicatePartKeys: [],
      files: [],
      groupId: "g-1",
      hasDuplicatePart: false,
      inferredTitle: "Shenandoah",
      sequenceNumber: "01",
    };

    const pieces: LibraryPieceOption[] = Array.from({ length: 450 }, (_, i) => ({
      id: `p-${String(i)}`,
      title: i === 42 ? "Shenandoah" : `Unrelated Song ${String(i)}`,
      durationSeconds: 180,
    }));

    const shortlisted = shortlistCandidatePiecesForGroup(group, pieces, 20);
    expect(shortlisted.length).toBeLessThanOrEqual(20);
    expect(shortlisted[0]?.id).toBe("p-42");
    expect(shortlisted[0]?.title).toBe("Shenandoah");
  });

  it("matches sequence number against OrderedSetListItem position without drifting", () => {
    const group = {
      averageDurationSeconds: 150,
      duplicatePartKeys: [],
      files: [],
      groupId: "g-1",
      hasDuplicatePart: false,
      inferredTitle: "Song 3",
      sequenceNumber: "03",
    };

    const pieces: LibraryPieceOption[] = [
      { id: "p-anthem", title: "Opening Anthem" },
      { id: "p-third", title: "Third Song" },
    ];

    // Set list has position 2 as an intermission / unlinked item
    const setList: OrderedSetListItem[] = [
      { pieceId: "p-anthem", position: 1, title: "Opening Anthem" },
      { pieceId: null, position: 2, title: "Intermission" },
      { pieceId: "p-third", position: 3, title: "Third Song" },
    ];

    const ranked = rankCandidatePiecesForGroup(group, pieces, setList);
    expect(ranked.suggestedPiece?.piece.id).toBe("p-third");
    expect(ranked.suggestedPiece?.evidence).toContain("Shared sequence number #03");
  });
});

describe("group repair domain operations", () => {
  const fileA1 = parsePracticeTrackFilename("Song_A_Soprano.mp3", [], "f-a1", 180);
  const fileA2 = parsePracticeTrackFilename("Song_A_Alto.mp3", [], "f-a2", 180);
  const fileB1 = parsePracticeTrackFilename("Song_B_Tenor.mp3", [], "f-b1", 240);
  const fileB2 = parsePracticeTrackFilename("Song_B_Bass.mp3", [], "f-b2", 240);

  it("nextUniqueGroupId returns non-colliding group ID", () => {
    expect(nextUniqueGroupId([{ groupId: "group-1" }, { groupId: "group-2" }])).toBe("group-3");
    expect(nextUniqueGroupId([{ groupId: "group-2" }, { groupId: "group-3" }])).toBe("group-1");
  });

  it("merges multiple groups cleanly and preserves clientFileIds", () => {
    const initialGroups = groupPracticeTrackFiles([fileA1, fileA2]);
    const secondGroup = groupPracticeTrackFiles([fileB1, fileB2]);
    const allGroups = [...initialGroups, ...secondGroup];
    const g0 = allGroups[0];
    const g1 = allGroups[1];
    expect(g0).toBeDefined();
    expect(g1).toBeDefined();
    if (!g0 || !g1) throw new Error("Expected at least two groups");

    const merged = mergeTrackImportGroups(allGroups, [g0.groupId, g1.groupId]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.files).toHaveLength(4);
    expect(merged[0]?.files.map((f) => f.clientFileId).sort()).toEqual([
      "f-a1",
      "f-a2",
      "f-b1",
      "f-b2",
    ]);
  });

  it("splits files into a new group and leaves source group intact", () => {
    const joinedGroups = groupPracticeTrackFiles([fileA1, fileA2, fileB1, fileB2]);
    const split = splitFilesToNewTrackImportGroup(joinedGroups, ["f-b1", "f-b2"]);
    expect(split.length).toBeGreaterThanOrEqual(2);
    const g1Files = split[0]?.files.map((f) => f.clientFileId);
    const g2Files = split[split.length - 1]?.files.map((f) => f.clientFileId);
    expect(g1Files).toEqual(["f-a1", "f-a2"]);
    expect(g2Files).toEqual(["f-b1", "f-b2"]);
  });

  it("moves files between groups", () => {
    const groups = groupPracticeTrackFiles([fileA1, fileA2, fileB1]);
    expect(groups).toHaveLength(2);
    const targetGroup = groups[1];
    expect(targetGroup).toBeDefined();
    if (!targetGroup) throw new Error("Expected target group");
    const moved = moveFilesBetweenTrackImportGroups(groups, ["f-a2"], targetGroup.groupId);
    expect(moved[0]?.files.map((f) => f.clientFileId)).toEqual(["f-a1"]);
    expect(moved[1]?.files.map((f) => f.clientFileId)).toEqual(["f-b1", "f-a2"]);
  });

  it("validates and applies GroupRepairAction proposals", () => {
    const group1 = groupPracticeTrackFiles([fileA1, fileA2]);
    const group2 = groupPracticeTrackFiles([fileB1, fileB2]);
    const groups = [...group1, ...group2];
    const g0 = groups[0];
    const g1 = groups[1];
    expect(g0).toBeDefined();
    expect(g1).toBeDefined();
    if (!g0 || !g1) throw new Error("Expected two groups");

    const mergeAction: GroupRepairAction = {
      confidence: 0.95,
      evidence: "Same song movements",
      groupIds: [g0.groupId, g1.groupId],
      kind: "merge_groups",
    };
    expect(validateGroupRepairSuggestion(mergeAction, groups)).toBe(true);

    const merged = applyGroupRepairSuggestion(groups, mergeAction);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.files).toHaveLength(4);

    // Invalid action: non-existent group
    expect(
      validateGroupRepairSuggestion(
        {
          ...mergeAction,
          groupIds: ["non-existent-1", "non-existent-2"],
        },
        groups,
      ),
    ).toBe(false);
  });

  it("detects suspicious within-group files and cross-group repair candidates", () => {
    const dup1 = parsePracticeTrackFilename(
      "Song_Soprano_Take1.mp3",
      [{ key: "S", label: "Soprano" }],
      "d1",
      180,
    );
    const dup2 = parsePracticeTrackFilename(
      "Song_Soprano_Take2.mp3",
      [{ key: "S", label: "Soprano" }],
      "d2",
      180,
    );
    const withinGroup = groupPracticeTrackFiles([dup1, dup2]);
    const wg0 = withinGroup[0];
    expect(wg0).toBeDefined();
    if (!wg0) throw new Error("Expected group");
    const suspicious = detectSuspiciousWithinGroupFiles(wg0);
    expect(suspicious.length).toBeGreaterThan(0);
    expect(suspicious[0]?.reason).toContain("Duplicate part 'S'");

    const gA = groupPracticeTrackFiles([fileA1]);
    const gB = groupPracticeTrackFiles([fileA2]);
    const ga0 = gA[0];
    const gb0 = gB[0];
    expect(ga0).toBeDefined();
    expect(gb0).toBeDefined();
    if (!ga0 || !gb0) throw new Error("Expected groups");
    const cross = detectCrossGroupRepairCandidates([...gA, ...gB]);
    expect(cross.length).toBeGreaterThan(0);
    expect(cross[0]?.groupAId).toBe(ga0.groupId);
    expect(cross[0]?.groupBId).toBe(gb0.groupId);
  });
});
