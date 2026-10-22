import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationRosterConfiguration,
  MusicTrackImportGroupSuggestion,
} from "@choir/contracts";
import type { ParsedId3Metadata, RankedPieceCandidate } from "@choir/domain";

export type TrackImportScope = "set_list" | "entire_library";

export type TrackImportStep = "scope_files" | "review" | "upload" | "results";

export type PartProvenance = "deterministic" | "ai" | "manual";
export type DestinationProvenance = "deterministic" | "ai" | "manual";

export interface InspectedTrackFile {
  readonly clientFileId: string;
  readonly detectedPartKey: string | null;
  readonly detectedPartLabel: string | null;
  readonly durationSeconds: number | null;
  readonly file: File;
  readonly fileName: string;
  readonly inferredTitle: string;
  readonly metadata?: ParsedId3Metadata | null;
  readonly sequenceNumber: string | null;
}

export interface GroupFileAssignment {
  readonly clientFileId: string;
  readonly conflictReason?: string | null | undefined;
  readonly detectedPartKey?: string | null | undefined;
  readonly detectedPartLabel?: string | null | undefined;
  readonly durationSeconds: number | null;
  readonly excluded?: boolean | undefined;
  readonly file: File;
  readonly fileName: string;
  readonly metadata?: ParsedId3Metadata | null | undefined;
  readonly tuttiAssignmentId?: string | undefined;
  readonly partKey: string | null;
  readonly partProvenance?: PartProvenance | undefined;
  readonly partSelectionChanged?: boolean | undefined;
  readonly suggestedPartKey?: string | null | undefined;
  readonly suggestedPartProbability?: number | null | undefined;
}

export interface GroupReviewItem {
  readonly aiSuggestion?: MusicTrackImportGroupSuggestion | undefined;
  readonly averageDurationSeconds: number | null;
  readonly candidates: readonly RankedPieceCandidate[];
  readonly destinationProvenance?: DestinationProvenance | undefined;
  readonly destinationSelectionChanged?: boolean | undefined;
  readonly duplicatePartKeys: readonly string[];
  readonly evidence: readonly string[];
  readonly files: readonly GroupFileAssignment[];
  readonly groupId: string;
  readonly groupSkipped?: boolean | undefined;
  readonly hasDuplicatePart: boolean;
  readonly inferredTitle: string;
  readonly reviewedMappingKey?: string | null | undefined;
  readonly selectedPieceId: string | null;
  readonly sequenceNumber: string | null;
}

export interface UploadProgressState {
  readonly completed: number;
  readonly currentFileName: string | null;
  readonly status: "idle" | "uploading" | "attaching" | "complete" | "error";
  readonly total: number;
}

export interface BulkPracticeTrackImportDialogProps {
  readonly events: readonly OrganizationEvent[];
  readonly onClose: () => void;
  readonly onOpenPiece?: ((pieceId: string) => void) | undefined;
  readonly onTracksAttached: () => void;
  readonly open: boolean;
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly roster: OrganizationRosterConfiguration | null;
}
