import type {
  MusicTrackImportSessionDetail,
  MusicTrackImportSessionSummary,
  ProblemDetails,
} from "@choir/contracts";
import { MUSIC_TRACK_IMPORT_MAX_BYTES } from "@choir/domain";
import {
  MusicTrackImportStoreError,
  type MusicTrackImportStoreErrorCode,
  type SessionDetailView,
  type SessionSummaryView,
} from "../../organization/music/trackImportStore";

export type TrackImportUploadHeaderError = "content_type" | "file_name" | "size" | "too_large";

export type TrackImportUploadHeaders =
  | { readonly error: TrackImportUploadHeaderError }
  | {
      readonly contentType: "audio/mpeg";
      readonly fileName: string;
      readonly sizeBytes: number;
    };

export function parseTrackImportUploadHeaders(
  contentType: string | undefined,
  contentLength: string | undefined,
  fileNameHeader: string | null | undefined,
): TrackImportUploadHeaders {
  if ((contentType ?? "").split(";")[0]?.trim().toLowerCase() !== "audio/mpeg") {
    return { error: "content_type" };
  }
  const declaredSize = Number(contentLength ?? "0");
  if (!Number.isInteger(declaredSize) || declaredSize < 1) {
    return { error: "size" };
  }
  if (declaredSize > MUSIC_TRACK_IMPORT_MAX_BYTES) {
    return { error: "too_large" };
  }
  const fileName = decodeImportFileName(fileNameHeader);
  if (!fileName) {
    return { error: "file_name" };
  }
  return { contentType: "audio/mpeg", fileName, sizeBytes: declaredSize };
}

export function trackImportUploadHeaderProblem(
  error: TrackImportUploadHeaderError,
  requestId: string,
): { readonly problem: ProblemDetails; readonly status: 400 | 413 } {
  if (error === "too_large") {
    return {
      problem: {
        code: "file_too_large",
        message: `Practice tracks are capped at ${String(MUSIC_TRACK_IMPORT_MAX_BYTES)} bytes.`,
        requestId,
      },
      status: 413,
    };
  }
  const message =
    error === "content_type"
      ? "Only MP3 uploads are accepted."
      : error === "size"
        ? "A valid content length is required."
        : "A valid encoded file name is required.";
  return { problem: { code: "validation_failed", message, requestId }, status: 400 };
}

type TrackImportStoreErrorCode = MusicTrackImportStoreErrorCode;

const TRACK_IMPORT_STORE_ERROR_CODES: readonly TrackImportStoreErrorCode[] = [
  "validation_failed",
  "organization_identity_conflict",
  "forbidden",
  "session_not_found",
  "session_expired",
  "session_closed",
  "idempotency_conflict",
  "stale_revision",
  "upload_in_progress",
  "slot_conflict",
];

function matchTrackImportStoreErrorCode(value: string): TrackImportStoreErrorCode | null {
  return isTrackImportStoreErrorCode(value) ? value : null;
}

function isTrackImportStoreErrorCode(value: string): value is TrackImportStoreErrorCode {
  return (TRACK_IMPORT_STORE_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Durable Object RPC does not preserve the store error prototype, so the
 * route-side mapping reads the typed error code instead of `instanceof`.
 * The store error always prefixes its message with `${code}: `, which lets
 * the boundary preserve the code without leaking storage details.
 */
function trackImportStoreErrorCode(error: unknown): TrackImportStoreErrorCode | null {
  if (error instanceof MusicTrackImportStoreError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code: unknown = error.code;
    if (typeof code === "string") {
      const matched = matchTrackImportStoreErrorCode(code);
      if (matched !== null) return matched;
    }
  }
  if (error instanceof Error) {
    const prefix = error.message.split(":", 1)[0]?.trim() ?? "";
    const matched = matchTrackImportStoreErrorCode(prefix);
    if (matched !== null) return matched;
  }
  return null;
}

export function importSessionProblem(
  error: unknown,
  requestId: string,
): {
  readonly code: string;
  readonly problem: ProblemDetails;
  readonly status: 400 | 403 | 404 | 409 | 503;
} {
  const code = trackImportStoreErrorCode(error);
  switch (code) {
    case "validation_failed":
      return {
        code,
        problem: {
          code,
          message: "The import session request was invalid.",
          requestId,
        },
        status: 400,
      };
    case "session_not_found":
      return {
        code,
        problem: { code, message: "The import session was not found.", requestId },
        status: 404,
      };
    case "forbidden":
      return {
        code,
        problem: {
          code,
          message: "Only the session owner may change this import.",
          requestId,
        },
        status: 403,
      };
    case "idempotency_conflict":
      return {
        code,
        problem: {
          code,
          message: "This import was already recorded with different content.",
          requestId,
        },
        status: 409,
      };
    case "stale_revision":
      return {
        code,
        problem: {
          code,
          message: "Assignments changed since this revision was reviewed. Refresh and retry.",
          requestId,
        },
        status: 409,
      };
    case "upload_in_progress":
      return {
        code,
        problem: {
          code,
          message: "An upload attempt is already in progress for this file.",
          requestId,
        },
        status: 409,
      };
    case "slot_conflict":
      return {
        code,
        problem: {
          code,
          message: "The destination slot is occupied by another track.",
          requestId,
        },
        status: 409,
      };
    case "session_expired":
      return {
        code,
        problem: {
          code,
          message: "The import session has expired. Start a new import.",
          requestId,
        },
        status: 409,
      };
    case "session_closed":
      return {
        code,
        problem: {
          code,
          message: "The import session is no longer active.",
          requestId,
        },
        status: 409,
      };
    case "organization_identity_conflict":
      return {
        code,
        problem: {
          code,
          message: "The import session belongs to a different Organization.",
          requestId,
        },
        status: 409,
      };
    default:
      return {
        code: "service_unavailable",
        problem: {
          code: "service_unavailable",
          message: "The practice track import is temporarily unavailable.",
          requestId,
        },
        status: 503,
      };
  }
}

function decodeImportFileName(header: string | null | undefined): string | null {
  if (!header) return null;
  try {
    const decoded = decodeURIComponent(header);
    if (decoded.length === 0 || decoded.length > 500) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function toSessionSummary(summary: SessionSummaryView): MusicTrackImportSessionSummary {
  return {
    absoluteExpiresAt: summary.absoluteExpiresAt,
    clientBatchKey: summary.clientBatchKey,
    closedAt: summary.closedAt,
    counts: { ...summary.counts },
    expiresAt: summary.expiresAt,
    lastFailureCode: summary.lastFailureCode,
    manifestRevision: summary.manifestRevision,
    sessionId: summary.sessionId,
    state: summary.state,
  };
}

export function toSessionDetail(detail: SessionDetailView): MusicTrackImportSessionDetail {
  return {
    ...toSessionSummary(detail),
    items: detail.items.map((item) => ({
      attempts: item.attempts.map((attempt) => ({
        attemptNumber: attempt.attemptNumber,
        fileId: attempt.fileId,
        leaseExpiresAt: attempt.leaseExpiresAt,
        status: parseAttemptStatus(attempt.status),
      })),
      clientFileId: item.clientFileId,
      contentType: item.contentType,
      currentFileId: item.currentFileId,
      durationSeconds: item.durationSeconds,
      errorCode: item.errorCode,
      fileName: item.fileName,
      partKey: item.partKey,
      pieceId: item.pieceId,
      sha256Hex: item.sha256Hex,
      sizeBytes: item.sizeBytes,
      status: item.status,
    })),
  };
}

function parseAttemptStatus(
  status: string,
): MusicTrackImportSessionDetail["items"][number]["attempts"][number]["status"] {
  switch (status) {
    case "reserved":
    case "uploading":
    case "ready":
    case "failed":
    case "cleanup_pending":
    case "reclaimed":
      return status;
    default:
      throw new MusicTrackImportStoreError("validation_failed", "Unknown upload attempt status.");
  }
}
