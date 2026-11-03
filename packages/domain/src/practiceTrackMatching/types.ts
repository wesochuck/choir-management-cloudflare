import type { ParsedId3Metadata } from "../id3Metadata";

export interface ConfiguredPartOption {
  readonly key: string;
  readonly label: string;
}

/** Resolves duplicate parts across files without coercing unassigned tracks to Tutti. */
export function resolvePracticeTrackAssignments<
  T extends {
    readonly partKey: string | null;
    readonly partSelectionChanged?: boolean | undefined;
  },
>(
  files: readonly T[],
  _selectedPieceId?: string | null,
): {
  duplicatePartKeys: string[];
  files: T[];
  hasDuplicatePart: boolean;
} {
  void _selectedPieceId;
  const resolvedFiles = [...files];
  const counts = new Map<string, number>();
  for (const file of resolvedFiles) {
    if (file.partKey) counts.set(file.partKey, (counts.get(file.partKey) ?? 0) + 1);
  }
  const duplicatePartKeys = [...counts].filter(([, count]) => count > 1).map(([key]) => key);
  return {
    duplicatePartKeys,
    files: resolvedFiles,
    hasDuplicatePart: duplicatePartKeys.length > 0,
  };
}

export interface ParsedTrackFile {
  readonly clientFileId: string;
  readonly detectedPartKey: string | null;
  readonly detectedPartLabel: string | null;
  readonly durationSeconds: number | null;
  readonly fileName: string;
  readonly inferredTitle: string;
  readonly metadata?: ParsedId3Metadata | null | undefined;
  readonly sequenceNumber: string | null;
}

export interface TrackImportGroup {
  readonly averageDurationSeconds: number | null;
  readonly duplicatePartKeys: readonly string[];
  readonly files: readonly ParsedTrackFile[];
  readonly groupId: string;
  readonly hasDuplicatePart: boolean;
  readonly inferredTitle: string;
  readonly sequenceNumber: string | null;
}

export interface LibraryPieceOption {
  readonly arranger?: string | null | undefined;
  readonly composer?: string | null | undefined;
  readonly durationSeconds?: number | null | undefined;
  readonly id: string;
  readonly parentId?: string | null | undefined;
  readonly title: string;
  readonly trackFileIds?: Record<string, string> | undefined;
}

export interface RankedPieceCandidate {
  readonly confidence: "high" | "medium" | "low" | "none";
  readonly conflicts: readonly string[];
  readonly evidence: readonly string[];
  readonly piece: LibraryPieceOption;
  readonly score: number;
}

export interface GroupCandidateMatch {
  readonly candidatePieces: readonly RankedPieceCandidate[];
  readonly groupId: string;
  readonly suggestedPiece: RankedPieceCandidate | null;
}

export type GroupRepairAction =
  | {
      readonly confidence: number;
      readonly evidence: string;
      readonly groupIds: readonly string[];
      readonly kind: "merge_groups";
      readonly targetGroupId?: string | undefined;
    }
  | {
      readonly confidence: number;
      readonly evidence: string;
      readonly fileSubsets: readonly {
        readonly clientFileIds: readonly string[];
        readonly suggestedTitle?: string | undefined;
      }[];
      readonly kind: "split_group";
      readonly sourceGroupId: string;
    }
  | {
      readonly clientFileIds: readonly string[];
      readonly confidence: number;
      readonly evidence: string;
      readonly kind: "move_files";
      readonly sourceGroupId: string;
      readonly targetGroupId: string;
    };

export interface OrderedSetListItem {
  readonly pieceId?: string | null | undefined;
  readonly position: number;
  readonly title?: string | undefined;
}
