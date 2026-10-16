import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationRosterConfiguration,
  MusicTrackImportGroupSuggestion,
} from "@choir/contracts";
import type { RankedPieceCandidate } from "@choir/domain";

export type TrackImportScope = "set_list" | "entire_library";

export type TrackImportStep = "scope_files" | "review" | "upload" | "results";

export interface InspectedTrackFile {
  readonly clientFileId: string;
  readonly detectedPartKey: string | null;
  readonly detectedPartLabel: string | null;
  readonly durationSeconds: number | null;
  readonly file: File;
  readonly fileName: string;
  readonly inferredTitle: string;
  readonly sequenceNumber: string | null;
}

export interface GroupFileAssignment {
  readonly clientFileId: string;
  readonly durationSeconds: number | null;
  readonly file: File;
  readonly fileName: string;
  readonly excluded?: boolean;
  readonly partKey: string | null;
  readonly partSelectionChanged?: boolean;
}

export interface GroupReviewItem {
  readonly aiSuggestion?: MusicTrackImportGroupSuggestion | undefined;
  readonly averageDurationSeconds: number | null;
  readonly candidates: readonly RankedPieceCandidate[];
  readonly duplicatePartKeys: readonly string[];
  readonly evidence: readonly string[];
  readonly files: readonly GroupFileAssignment[];
  readonly groupId: string;
  readonly hasDuplicatePart: boolean;
  readonly inferredTitle: string;
  readonly groupSkipped?: boolean;
  readonly selectedPieceId: string | null;
  readonly sequenceNumber: string | null;
  readonly reviewedMappingKey?: string | null;
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
