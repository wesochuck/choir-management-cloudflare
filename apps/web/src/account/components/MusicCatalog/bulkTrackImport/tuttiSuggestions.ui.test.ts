import { describe, expect, it } from "vitest";
import {
  applyTuttiSuggestions,
  getTuttiCandidates,
  undoTuttiSuggestions,
} from "./tuttiSuggestions";
import type { GroupFileAssignment, GroupReviewItem } from "./types";

function recording(id: string, patch: Partial<GroupFileAssignment> = {}): GroupFileAssignment {
  return {
    clientFileId: id,
    file: new File(["audio"], `${id}.mp3`),
    fileName: `${id}.mp3`,
    durationSeconds: null,
    partKey: null,
    ...patch,
  };
}
function group(
  files: readonly GroupFileAssignment[],
  patch: Partial<GroupReviewItem> = {},
): GroupReviewItem {
  return {
    groupId: "song",
    inferredTitle: "Song",
    averageDurationSeconds: null,
    candidates: [],
    duplicatePartKeys: [],
    evidence: [],
    hasDuplicatePart: false,
    selectedPieceId: null,
    sequenceNumber: null,
    files,
    ...patch,
  };
}

describe("Tutti suggestions", () => {
  it("only suggests untouched unlabeled files in unresolved included groups", () => {
    const untouched = recording("unlabeled");
    const groups = [
      group([
        untouched,
        recording("explicit", { partKey: "alto", detectedPartKey: "alto" }),
        recording("manual-empty", { partSelectionChanged: true }),
        recording("manual", { partProvenance: "manual" }),
        recording("ai", { partKey: "tutti", partProvenance: "ai" }),
        recording("excluded", { excluded: true }),
        recording("detected", { detectedPartKey: "S1" }),
      ]),
      group([recording("skipped")], { groupSkipped: true }),
      group([recording("reviewed")], { reviewedMappingKey: "reviewed" }),
    ];
    expect(getTuttiCandidates(groups)).toEqual([untouched]);
    const applied = applyTuttiSuggestions(
      groups,
      new Set(groups.flatMap((g) => g.files.map((f) => f.clientFileId))),
      "batch",
    );
    expect(applied[0]?.files[0]).toMatchObject({ partKey: "tutti", partSelectionChanged: true });
    expect(applied[0]?.files.slice(1)).toEqual(groups[0]?.files.slice(1));
    expect(applied.slice(1)).toEqual(groups.slice(1));
  });

  it("flags duplicate Tutti assignments and restores them on undo without changing the destination", () => {
    const files = [recording("one"), recording("two")];
    const applied = applyTuttiSuggestions(
      [group(files, { selectedPieceId: "piece" })],
      new Set(["one", "two"]),
      "batch",
    );
    expect(applied[0]).toMatchObject({
      hasDuplicatePart: true,
      duplicatePartKeys: ["tutti"],
      reviewedMappingKey: null,
    });
    const undone = undoTuttiSuggestions(
      applied,
      new Map(files.map((f) => [f.clientFileId, f])),
      "batch",
    );
    expect(undone[0]).toMatchObject({ selectedPieceId: "piece", hasDuplicatePart: false });
    expect(undone[0]?.files.map((f) => f.partKey)).toEqual([null, null]);
    expect(getTuttiCandidates(undone)).toHaveLength(2);
  });

  it("undo preserves later manual edits, exclusions, reviewed groups and skipped groups", () => {
    const original = recording("one");
    const applied = applyTuttiSuggestions([group([original])], new Set(["one"]), "batch")[0];
    if (!applied) throw new Error("Missing applied group");
    const edited = {
      ...applied,
      files: applied.files.map((f) => ({ ...f, partKey: "alto", tuttiAssignmentId: undefined })),
    };
    const excluded = { ...applied, files: applied.files.map((f) => ({ ...f, excluded: true })) };
    const protectedGroups = [
      edited,
      excluded,
      { ...applied, reviewedMappingKey: "reviewed" },
      { ...applied, groupSkipped: true },
    ];
    expect(undoTuttiSuggestions(protectedGroups, new Map([["one", original]]), "batch")).toEqual(
      protectedGroups,
    );
  });
});
