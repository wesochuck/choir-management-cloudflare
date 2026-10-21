import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MUSIC_TRACK_IMPORT_UPLOAD_CONCURRENCY } from "@choir/domain";
import { AuthApiError } from "../../../../api/client";
import { analyzeUploadedTrack } from "../../../loudness/client";
import {
  commitMusicTrackImportSession,
  createMusicTrackImportSession,
  discardMusicTrackImportSession,
  getMusicTrackImportSession,
  updateMusicTrackImportAssignments,
  uploadMusicTrackImportFile,
} from "../../../../api/musicTrackImport";
import {
  clearImportSessionContext,
  matchReselectedFiles,
  sha256HexOfFile,
  verifyReselectedDigests,
  writeImportSessionContext,
  type ImportSessionContext,
} from "./importSessionStorage";

export interface PlannedImportFile {
  readonly clientFileId: string;
  readonly durationSeconds: number | null;
  readonly file: File;
  readonly fileName: string;
  readonly partKey: string;
  readonly pieceId: string;
  readonly pieceTitle: string;
}

export type ImportFileStatus =
  | "pending"
  | "hashing"
  | "uploading"
  | "uploaded"
  | "upload_failed"
  | "committed"
  | "conflict"
  | "skipped";

export interface ImportFileState extends Omit<PlannedImportFile, "file"> {
  readonly attempts: number;
  readonly error: string | null;
  readonly file: File | null;
  readonly fileId: string | null;
  readonly sha256Hex: string | null;
  readonly status: ImportFileStatus;
}

export type ImportRunPhase = "idle" | "running" | "awaiting_action" | "done";

export interface ImportCommitSummary {
  readonly attached: number;
  readonly conflict: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface ImportRunResult {
  readonly commitSummary: ImportCommitSummary;
  readonly manifestRevision: number;
  readonly sessionId: string;
}

function friendlyUploadError(error: unknown): string {
  if (error instanceof AuthApiError) {
    if (error.code === "slot_conflict") {
      return "The destination slot became occupied by another track.";
    }
    if (error.code === "upload_in_progress") {
      return "An upload attempt is already in progress for this file. Wait a moment and retry.";
    }
    if (error.code === "session_expired") {
      return "The import session expired. Start a new import.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "The upload failed. Retry this file.";
}

function buildManifestRows(
  files: readonly PlannedImportFile[],
  digests: ReadonlyMap<string, string>,
) {
  return files.map((file) => ({
    clientFileId: file.clientFileId,
    contentType: "audio/mpeg" as const,
    durationSeconds: file.durationSeconds,
    fileName: file.fileName,
    lastModifiedMs: file.file.lastModified,
    partKey: file.partKey,
    pieceId: file.pieceId,
    sha256Hex: digests.get(file.clientFileId) ?? "",
    sizeBytes: file.file.size,
  }));
}

/**
 * Session-backed import controller for the bulk track wizard.
 *
 * The controller hashes reviewed files one at a time, creates exactly one
 * server session per batch key, uploads with bounded concurrency and settled
 * per-file results, then commits the reviewed revision. Every cross-tab
 * resume, retry, and conflict path goes through the server session state —
 * local state never invents file UUIDs or storage keys.
 */
export function useImportSession() {
  const [files, setFiles] = useState<readonly ImportFileState[]>([]);
  const [phase, setPhase] = useState<ImportRunPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [manifestRevision, setManifestRevision] = useState(0);
  const [commitSummary, setCommitSummary] = useState<ImportCommitSummary | null>(null);
  const batchKeyRef = useRef<string | null>(null);
  const commitKeyByRevisionRef = useRef(new Map<number, string>());
  const localFilesByClientIdRef = useRef(new Map<string, File>());
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  });

  const runningRef = useRef(false);

  const activeCount = useMemo(
    () => files.filter((file) => file.status === "uploaded").length,
    [files],
  );

  const updateFile = useCallback((clientFileId: string, patch: Partial<ImportFileState>) => {
    setFiles((current) =>
      current.map((file) => (file.clientFileId === clientFileId ? { ...file, ...patch } : file)),
    );
  }, []);

  const persistContext = useCallback(
    (
      nextSessionId: string,
      batchKey: string,
      rows: readonly PlannedImportFile[],
      digests: ReadonlyMap<string, string>,
    ) => {
      const context: ImportSessionContext = {
        clientBatchKey: batchKey,
        host: window.location.host,
        manifest: rows.map((file) => ({
          clientFileId: file.clientFileId,
          durationSeconds: file.durationSeconds,
          fileName: file.fileName,
          lastModifiedMs: file.file.lastModified,
          partKey: file.partKey,
          pieceId: file.pieceId,
          sha256Hex: digests.get(file.clientFileId) ?? "",
          sizeBytes: file.file.size,
        })),
        savedAt: new Date().toISOString(),
        sessionId: nextSessionId,
      };
      writeImportSessionContext(context);
    },
    [],
  );

  const ensureSession = useCallback(
    async (
      planned: readonly PlannedImportFile[],
    ): Promise<{
      readonly revision: number;
      readonly sessionId: string;
      readonly states: readonly ImportFileState[];
    } | null> => {
      const batchKey = batchKeyRef.current ?? crypto.randomUUID();
      batchKeyRef.current = batchKey;
      setFiles(
        planned.map((file) => ({
          ...file,
          attempts: 0,
          error: null,
          fileId: null,
          sha256Hex: null,
          status: "hashing" as const,
        })),
      );
      const digests = new Map<string, string>();
      for (const file of planned) {
        updateFile(file.clientFileId, { status: "hashing" });
        try {
          digests.set(file.clientFileId, await sha256HexOfFile(file.file));
        } catch {
          updateFile(file.clientFileId, {
            error: "The file could not be read for verification.",
            status: "upload_failed",
          });
          return null;
        }
        updateFile(file.clientFileId, { status: "pending" });
      }
      const manifest = buildManifestRows(planned, digests);
      const created = await createMusicTrackImportSession({
        clientBatchKey: batchKey,
        items: manifest,
      });
      setSessionId(created.sessionId);
      setManifestRevision(created.manifestRevision);
      persistContext(created.sessionId, batchKey, planned, digests);
      for (const file of planned) {
        localFilesByClientIdRef.current.set(file.clientFileId, file.file);
      }
      const statusById = new Map(created.items.map((item) => [item.clientFileId, item.status]));
      const states: ImportFileState[] = planned.map((file) => ({
        ...file,
        attempts: 0,
        error:
          statusById.get(file.clientFileId) === "conflict"
            ? "The destination slot is occupied by another track."
            : null,
        fileId: null,
        sha256Hex: digests.get(file.clientFileId) ?? null,
        status:
          statusById.get(file.clientFileId) === "conflict"
            ? ("conflict" as const)
            : ("pending" as const),
      }));
      setFiles(states);
      return { revision: created.manifestRevision, sessionId: created.sessionId, states };
    },
    [persistContext, updateFile],
  );

  const uploadOne = useCallback(
    async (session: string, file: ImportFileState): Promise<boolean> => {
      if (!file.file) {
        updateFile(file.clientFileId, {
          error: "The audio bytes for this file are no longer available.",
          status: "upload_failed",
        });
        return false;
      }
      const audio = file.file;
      setFiles((current) =>
        current.map((entry) =>
          entry.clientFileId === file.clientFileId
            ? { ...entry, attempts: entry.attempts + 1, error: null, status: "uploading" as const }
            : entry,
        ),
      );
      try {
        const uploaded = await uploadMusicTrackImportFile(session, file.clientFileId, audio);
        updateFile(file.clientFileId, {
          error: null,
          fileId: uploaded.fileId,
          status: "uploaded",
        });
        return true;
      } catch (error: unknown) {
        updateFile(file.clientFileId, {
          error: friendlyUploadError(error),
          status: "upload_failed",
        });
        return false;
      }
    },
    [updateFile],
  );

  const uploadAllSettled = useCallback(
    async (session: string, snapshots: readonly ImportFileState[]): Promise<boolean> => {
      // Snapshot the queue once: every entry is processed exactly once and
      // all state transitions use functional updates, so concurrent workers
      // never clobber each other.
      const queue = snapshots
        .filter((file) => file.status === "pending" || file.status === "upload_failed")
        .map((file) => ({ ...file }));
      let allOk = true;
      const workers = Array.from(
        { length: Math.min(MUSIC_TRACK_IMPORT_UPLOAD_CONCURRENCY, queue.length) },
        async () => {
          while (queue.length > 0) {
            const next = queue.shift();
            if (!next) break;
            const ok = await uploadOne(session, next);
            if (!ok) allOk = false;
          }
        },
      );
      await Promise.all(workers);
      return allOk;
    },
    [uploadOne],
  );

  const commitCurrent = useCallback(
    async (session: string, revision: number): Promise<ImportRunResult | null> => {
      let commitKey = commitKeyByRevisionRef.current.get(revision);
      if (!commitKey) {
        commitKey = crypto.randomUUID();
        commitKeyByRevisionRef.current.set(revision, commitKey);
      }
      const receipt = await commitMusicTrackImportSession(session, {
        commitKey,
        expectedRevision: revision,
      });
      setCommitSummary({ ...receipt.summary });
      const resultById = new Map(receipt.results.map((result) => [result.clientFileId, result]));
      setFiles((current) =>
        current.map((file) => {
          const result = resultById.get(file.clientFileId);
          if (!result) {
            return { ...file, error: file.error, status: "skipped" as const };
          }
          if (result.status === "attached") {
            return {
              ...file,
              error: null,
              fileId: result.fileId ?? file.fileId,
              status: "committed" as const,
            };
          }
          if (result.status === "conflict") {
            return {
              ...file,
              error: result.reason ?? "The destination slot is occupied by another track.",
              status: "conflict" as const,
            };
          }
          if (result.status === "failed") {
            return {
              ...file,
              error: result.reason ?? "The attachment failed.",
              status: "upload_failed" as const,
            };
          }
          return { ...file, error: null, status: "skipped" as const };
        }),
      );
      for (const result of receipt.results) {
        if (result.status === "attached" && result.fileId) {
          const file = localFilesByClientIdRef.current.get(result.clientFileId);
          if (file) {
            analyzeUploadedTrack(result.fileId, file);
          }
        }
      }
      return {
        commitSummary: { ...receipt.summary },
        manifestRevision: receipt.manifestRevision,
        sessionId: receipt.sessionId,
      };
    },
    [],
  );

  const startRun = useCallback(
    async (planned: readonly PlannedImportFile[]): Promise<ImportRunResult | null> => {
      if (runningRef.current) return null;
      runningRef.current = true;
      setPhase("running");
      setErrorMessage(null);
      setCommitSummary(null);
      try {
        const ensured = await ensureSession(planned);
        if (!ensured) {
          setPhase("awaiting_action");
          return null;
        }
        const allUploaded = await uploadAllSettled(ensured.sessionId, ensured.states);
        if (!allUploaded) {
          setPhase("awaiting_action");
          return null;
        }
        const receipt = await commitCurrent(ensured.sessionId, ensured.revision);
        setPhase("done");
        clearImportSessionContext();
        return receipt;
      } catch (error: unknown) {
        setErrorMessage(friendlyUploadError(error));
        setPhase("awaiting_action");
        return null;
      } finally {
        runningRef.current = false;
      }
    },
    [commitCurrent, ensureSession, uploadAllSettled],
  );

  const retryUploads = useCallback(
    async (snapshots?: readonly ImportFileState[]): Promise<boolean> => {
      if (!sessionId || runningRef.current) return false;
      runningRef.current = true;
      setPhase("running");
      setErrorMessage(null);
      try {
        const allUploaded = await uploadAllSettled(sessionId, snapshots ?? files);
        setPhase(allUploaded ? "running" : "awaiting_action");
        return allUploaded;
      } catch (error: unknown) {
        setErrorMessage(friendlyUploadError(error));
        setPhase("awaiting_action");
        return false;
      } finally {
        runningRef.current = false;
      }
    },
    [files, sessionId, uploadAllSettled],
  );

  const retryCommit = useCallback(async (): Promise<ImportRunResult | null> => {
    if (!sessionId || runningRef.current) return null;
    runningRef.current = true;
    setPhase("running");
    setErrorMessage(null);
    try {
      const detail = await getMusicTrackImportSession(sessionId);
      setManifestRevision(detail.manifestRevision);
      const receipt = await commitCurrent(sessionId, detail.manifestRevision);
      setPhase("done");
      clearImportSessionContext();
      return receipt;
    } catch (error: unknown) {
      setErrorMessage(friendlyUploadError(error));
      setPhase("awaiting_action");
      return null;
    } finally {
      runningRef.current = false;
    }
  }, [commitCurrent, sessionId]);

  const discardSession = useCallback(async (): Promise<void> => {
    if (!sessionId) {
      clearImportSessionContext();
      return;
    }
    try {
      await discardMusicTrackImportSession(sessionId);
    } finally {
      clearImportSessionContext();
      batchKeyRef.current = null;
      commitKeyByRevisionRef.current.clear();
      localFilesByClientIdRef.current.clear();
      setSessionId(null);
      setFiles([]);
      setPhase("idle");
      setCommitSummary(null);
      setManifestRevision(0);
      setErrorMessage(null);
    }
  }, [sessionId]);

  const reconfirmAssignments = useCallback(
    async (planned: readonly PlannedImportFile[]): Promise<boolean> => {
      if (!sessionId) return false;
      const detail = await getMusicTrackImportSession(sessionId);
      const serverTargets = new Map(
        detail.items.map((item) => [
          item.clientFileId,
          `${item.pieceId}::${item.partKey}::${String(item.durationSeconds)}`,
        ]),
      );
      const changed = planned.filter(
        (file) =>
          serverTargets.get(file.clientFileId) !==
          `${file.pieceId}::${file.partKey}::${String(file.durationSeconds)}`,
      );
      if (changed.length === 0) {
        setManifestRevision(detail.manifestRevision);
        const statusById = new Map(detail.items.map((item) => [item.clientFileId, item.status]));
        setFiles((current) =>
          current.map((file) => ({
            ...file,
            error:
              statusById.get(file.clientFileId) === "conflict"
                ? "The destination slot is occupied by another track."
                : file.error,
            status:
              statusById.get(file.clientFileId) === "conflict"
                ? ("conflict" as const)
                : file.status,
          })),
        );
        return true;
      }
      const updated = await updateMusicTrackImportAssignments(sessionId, {
        assignments: changed.map((file) => ({
          clientFileId: file.clientFileId,
          durationSeconds: file.durationSeconds,
          partKey: file.partKey,
          pieceId: file.pieceId,
        })),
        expectedRevision: detail.manifestRevision,
      });
      setManifestRevision(updated.manifestRevision);
      persistContext(
        sessionId,
        batchKeyRef.current ?? crypto.randomUUID(),
        planned,
        new Map(
          planned.map((file) => [
            file.clientFileId,
            files.find((current) => current.clientFileId === file.clientFileId)?.sha256Hex ?? "",
          ]),
        ),
      );
      for (const file of planned) {
        localFilesByClientIdRef.current.set(file.clientFileId, file.file);
      }
      const statusById = new Map(updated.items.map((item) => [item.clientFileId, item.status]));
      setFiles((current) =>
        current.map((file) => ({
          ...file,
          error:
            statusById.get(file.clientFileId) === "conflict"
              ? "The destination slot is occupied by another track."
              : null,
          status:
            statusById.get(file.clientFileId) === "conflict"
              ? ("conflict" as const)
              : file.status === "conflict"
                ? ("pending" as const)
                : file.status,
        })),
      );
      return true;
    },
    [files, persistContext, sessionId],
  );

  /**
   * Runs one confirmation pass: creates or reconfirms the session, uploads
   * all pending files with settled results, then commits the reviewed
   * revision. Membership changes discard the stale session first so removed
   * rows can never attach.
   */
  const confirmPlanned = useCallback(
    async (planned: readonly PlannedImportFile[]): Promise<ImportRunResult | null> => {
      if (runningRef.current) return null;
      const plannedIds = new Set(planned.map((file) => file.clientFileId));
      const current = filesRef.current;
      const sessionIds = new Set(current.map((file) => file.clientFileId));
      const sameMembership =
        sessionId !== null &&
        plannedIds.size === sessionIds.size &&
        [...plannedIds].every((id) => sessionIds.has(id));
      if (sessionId && !sameMembership) {
        await discardSession();
      }
      if (sessionId !== null && sameMembership) {
        const reconciled = await reconfirmAssignments(planned);
        if (!reconciled) return null;
        const allUploaded = await retryUploads();
        if (!allUploaded) return null;
        return retryCommit();
      }
      return startRun(planned);
    },
    [discardSession, reconfirmAssignments, retryCommit, retryUploads, sessionId, startRun],
  );

  /**
   * Adopts a recoverable server session after fingerprint-verified
   * reselection. Uploaded rows keep their server file IDs and are never
   * re-uploaded; rows still needing bytes carry their reselected File.
   */
  const adoptResumedSession = useCallback(
    (
      session: {
        readonly items: readonly {
          readonly clientFileId: string;
          readonly currentFileId: string | null;
          readonly durationSeconds: number | null;
          readonly errorCode: string | null;
          readonly fileName: string;
          readonly partKey: string;
          readonly pieceId: string;
          readonly sha256Hex: string;
          readonly status: string;
        }[];
        readonly manifestRevision: number;
        readonly sessionId: string;
      },
      filesByClientId: ReadonlyMap<string, File>,
      pieceTitles: ReadonlyMap<string, string>,
    ): void => {
      batchKeyRef.current = null;
      for (const [id, file] of filesByClientId) {
        localFilesByClientIdRef.current.set(id, file);
      }
      setSessionId(session.sessionId);
      setManifestRevision(session.manifestRevision);
      setCommitSummary(null);
      setErrorMessage(null);
      setPhase("awaiting_action");
      setFiles(
        session.items.map((item) => {
          const file = filesByClientId.get(item.clientFileId) ?? null;
          const status: ImportFileStatus =
            item.status === "attached"
              ? "committed"
              : item.status === "uploaded"
                ? "uploaded"
                : item.status === "conflict"
                  ? "conflict"
                  : item.status === "upload_failed" || item.status === "attach_failed"
                    ? "upload_failed"
                    : item.status === "planned" || item.status === "uploading"
                      ? "pending"
                      : "skipped";
          return {
            attempts: 0,
            clientFileId: item.clientFileId,
            durationSeconds: item.durationSeconds,
            error:
              item.status === "conflict"
                ? "The destination slot is occupied by another track."
                : (item.errorCode ?? null),
            file,
            fileName: item.fileName,
            fileId: item.currentFileId,
            partKey: item.partKey,
            pieceId: item.pieceId,
            pieceTitle: pieceTitles.get(item.pieceId) ?? "Unknown Piece",
            sha256Hex: item.sha256Hex,
            status,
          };
        }),
      );
    },
    [],
  );

  /**
   * Clears in-memory run state without touching the server session. Used when
   * the wizard closes or the batch membership changes; the saved session
   * context (if any) still allows a later resume.
   */
  const resetLocal = useCallback((): void => {
    batchKeyRef.current = null;
    commitKeyByRevisionRef.current.clear();
    setSessionId(null);
    setFiles([]);
    setPhase("idle");
    setCommitSummary(null);
    setManifestRevision(0);
    setErrorMessage(null);
  }, []);

  return {
    activeCount,
    adoptResumedSession,
    commitSummary,
    confirmPlanned,
    discardSession,
    ensureSession,
    errorMessage,
    files,
    manifestRevision,
    phase,
    reconfirmAssignments,
    resetLocal,
    retryCommit,
    retryUploads,
    sessionId,
    startRun,
  };
}

export interface ResumeOffer {
  readonly context: ImportSessionContext;
  readonly detail: {
    readonly manifestRevision: number;
    readonly state: string;
  };
}

export function matchResumptionFiles(
  context: ImportSessionContext,
  files: readonly File[],
): ReturnType<typeof matchReselectedFiles> {
  return matchReselectedFiles(context.manifest, files);
}

export { verifyReselectedDigests };
